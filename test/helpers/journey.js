/**
 * Journey-tests draaien het echte proces (`node src/main.js`) in een tijdelijke map. Wat de test
 * niet zelf test (bv. dat er een secret bestaat), zet `seedVault` klaar via dezelfde kluiscode; wat getest wordt (de
 * request, de beslissing, het invullen) loopt door het echte proces. Alle uitvoer van het proces wordt bewaard, zodat elke
 * journey kan eindigen met `findLeaks`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createVault } from '../../src/vault/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose, createApp } from '../../src/composition.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAIN = path.join(ROOT, 'src', 'main.js');
export const FAKE_TRAY = path.join(ROOT, 'test', 'fixtures', 'fakeTray.mjs');
export const PASSPHRASE = 'journey passphrase';

let counter = 0;
export function tempHome() {
    const dir = path.join(process.env.VAULTGATE_HOME, `journey-${process.pid}-${counter++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Maakt een kluis in `home` (minimale KDF voor snelheid) en laat `fill` er secrets/tools/toekenningen in zetten. */
export async function seedVault(home, fill = async () => {}) {
    const crypto = createCrypto();
    const clock = { now: () => Date.now() };
    const vault = createVault({ store: choose('store', 'local', { dir: path.join(home, 'vault') }), crypto, clock, kdf: MIN_KDF });
    await vault.create({ passphrase: PASSPHRASE });
    const registry = createRegistry({ vault, clock, crypto });
    const result = await fill({ vault, registry });
    vault.lock();
    return result;
}

/**
 * Start het echte proces. Opties: unlock (passphrase via stdin, standaard aan), tray ('none' | 'fake'), env, args,
 * main (een kopie van de installatie, test/helpers/install.js; in-process heet dat codeRoot).
 * Geeft { proxy, portal, output(), stop(), child } terug zodra het proces "ready" meldt.
 */
export async function startProcess(home, { unlock = true, tray = 'none', env = {}, args = [], deviceIntervalSeconds = 1, main = MAIN } = {}) {
    const trayArgs = tray === 'fake' ? ['--tray-command', FAKE_TRAY] : ['--tray', tray];
    const child = spawn(process.execPath, [main, '--home', home, '--proxy-port', '0', '--portal-port', '0', ...(unlock ? ['--unlock-stdin'] : []), ...trayArgs, '--device-interval-seconds', String(deviceIntervalSeconds), '--window', 'none', ...args], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const events = [];
    let buffer = '';
    child.stdout.on('data', d => {
        output += d;
        buffer += d;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            try { events.push(JSON.parse(line)); } catch { /* geen JSON */ }
        }
    });
    child.stderr.on('data', d => { output += d; });
    if (unlock) child.stdin.write(`${PASSPHRASE}\n`);
    const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
    const ready = await Promise.race([
        (async () => { while (!events.some(e => e.event === 'ready')) await new Promise(r => setTimeout(r, 20)); return events.find(e => e.event === 'ready'); })(),
        exited.then(code => { throw new Error(`process exited with ${code} before ready:\n${output}`); }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`process not ready after 20 s:\n${output}`)), 20_000)),
    ]);
    return {
        child,
        events,
        proxy: `http://127.0.0.1:${ready.proxyPort}`,
        portal: `http://localhost:${ready.portalPort}`,
        ready,
        output: () => output,
        exited,
        async stop() {
            if (child.exitCode === null) { child.kill(); await exited; }
            return output;
        },
    };
}

/** Wacht tot het proces een gebeurtenis met deze naam logt. */
export async function waitForEvent(proc, name, ms = 10_000) {
    const t0 = Date.now();
    for (;;) {
        const found = proc.events.find(e => e.event === name);
        if (found) return found;
        if (Date.now() - t0 > ms) throw new Error(`no event ${name}:\n${proc.output()}`);
        await new Promise(r => setTimeout(r, 20));
    }
}

/**
 * Hetzelfde als startProcess, maar in dit proces via createApp (echte HTTP-servers, echte tray-link met een nep-tray als
 * kindproces). Bestaat voor de coverage: wat in een subproces draait, ziet vitest niet. Elke journey draait in beide modi.
 */
export async function startInProcess(home, { unlock = true, tray = 'none', env = {}, deviceIntervalSeconds = 1, trayConnectTimeoutMs, throttle, codeRoot } = {}) {
    const events = [];
    let output = '';
    const log = event => { events.push(event); output += `${JSON.stringify(event)}
`; };
    const app = createApp({ home, proxyPort: 0, portalPort: 0, tray: tray === 'fake' ? { script: FAKE_TRAY } : tray, trayEnv: { ...process.env, ...env }, log, deviceIntervalSeconds, window: 'none', ...(throttle ? { throttle } : {}), ...(trayConnectTimeoutMs ? { trayConnectTimeoutMs } : {}), codeRoot });
    const ports = await app.start();
    if (unlock) await app.unlockWithPassphrase(PASSPHRASE);
    events.push({ event: 'ready', ...ports });
    let stopped = false;
    return {
        app,
        events,
        proxy: `http://127.0.0.1:${ports.proxyPort}`,
        portal: `http://localhost:${ports.portalPort}`,
        output: () => output,
        async stop() { if (!stopped) { stopped = true; await app.stop(); } return output; },
    };
}

/** De twee modi waarin elke journey draait. */
export const MODES = [['proces', startProcess], ['in-process', startInProcess]];

/** De CLI `node src/main.js login` als apart proces (zoals een gebruiker of een tool hem start). */
export function runLogin({ proxy, name, home, print = false }) {
    let stderr = '';
    const result = new Promise(resolve => {
        const child = spawn(process.execPath, [MAIN, 'login', '--name', name, '--proxy', proxy, '--home', home, ...(print ? ['--print'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
    Object.defineProperty(result, 'stderr', { get: () => stderr });
    return result;
}

/**
 * De opgeslagen key van `name`, zoals een tool hem krijgt: via het echte `key --name` (op Windows ontsleutelt dat met
 * DPAPI; het bestand zelf bevat dan geen bruikbare key).
 */
export function readToolKey(home, name) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [MAIN, 'key', '--name', name, '--home', home], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('exit', code => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`key --name ${name}: ${stderr}`))));
    });
}

/** De inhoud van het key-bestand: op Windows `dpapi:...`, elders de key zelf. */
export const keyFileText = (home, name) => fs.readFileSync(path.join(home, 'clients', `${name}.key`), 'utf8').trim();

/**
 * Beantwoord de n-de aanraakvraag (`touch-requested` in de log) met een software-passkey, zonder browser:
 * options ophalen, een assertion maken, verify. Geeft de status van verify terug.
 */
export async function touchWithSoftKey(proc, auth, n, { origin = proc.portal } = {}) {
    const touches = () => proc.events.filter(e => e.event === 'touch-requested');
    const deadline = Date.now() + 20_000;
    while (touches().length < n && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    const entry = touches()[n - 1];
    if (!entry) throw new Error(`no touch-requested #${n} within 20 s`);
    const post = (p, body) => fetch(`${proc.portal}/api/touch/${entry.id}/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: proc.portal }, body: JSON.stringify(body ?? {}) });
    const { options } = await (await post('options')).json();
    return (await post('verify', { response: auth.assert({ challenge: options.challenge, origin }) })).status;
}

/** Log in with a software passkey, type the CLI code through the device API, approve, then touch or deny it. */
export async function approveDeviceWithSoftKey(proc, auth, userCode, { deny = false, origin = proc.portal } = {}) {
    const post = (path, body, headers = {}) => fetch(`${proc.portal}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body ?? {}),
    });
    const optionsResponse = await post('/api/webauthn/login/options');
    const { options } = await optionsResponse.json();
    const loginResponse = await post('/api/webauthn/login/verify', { response: auth.assert({ challenge: options.challenge, origin }) });
    const loginBody = await loginResponse.json();
    if (!loginResponse.ok) throw new Error(`portal passkey login failed: ${JSON.stringify(loginBody)}`);
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, 'x-csrf-token': loginBody.csrf };
    const pendingResponse = await fetch(`${proc.portal}/api/device`, { headers });
    const pending = await pendingResponse.json();
    const request = pending.find(entry => entry.clientName);
    if (!request) throw new Error('no device request waiting in the portal');
    const verifyResponse = await post(`/api/device/${request.id}/verify`, { code: userCode }, headers);
    if (!verifyResponse.ok) throw new Error(`portal code verification failed: ${await verifyResponse.text()}`);
    const approveResponse = await post(`/api/device/${request.id}/approve`, {}, headers);
    const approval = await approveResponse.json();
    if (!approveResponse.ok || !approval.touch) throw new Error(`portal device approval failed: ${JSON.stringify(approval)}`);
    if (deny) return (await post(`/api/touch/${approval.touch}/deny`)).status;
    const touchOptionsResponse = await post(`/api/touch/${approval.touch}/options`);
    const { options: touchOptions } = await touchOptionsResponse.json();
    return (await post(`/api/touch/${approval.touch}/verify`, { response: auth.assert({ challenge: touchOptions.challenge, origin }) })).status;
}
