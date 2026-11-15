// De aanvalsbank. Zet een tijdelijke kluis klaar (nep-secrets, een tool met toekenningen, een ingetrokken
// tool), start een nep-doelhost (HTTP en HTTPS met test-CA's) en het echte proces (`src/main.js`, nep-tray die eerst
// "eenmalig" en daarna "weigeren" antwoordt), voert elke aanval uit en beoordeelt ze. Een aanval die geblokkeerd hoort te
// zijn maar doorkomt, is FAIL; een open aanval wordt eerlijk gemeld met de reden. Inrichten via de portaal-API van
// datzelfde proces, zoals een gebruiker: de bank gebruikt geen interne modules.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKS } from './attacks.mjs';
import { createSoftAuthenticator } from './soft-passkey.mjs';
import { tamperCode } from './tamper.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TLS = path.join(ROOT, 'test', 'fixtures', 'tls');
const tlsFile = f => fs.readFileSync(path.join(TLS, f), 'utf8');

/** Beoordeelt één aanval. Geeft { verdict: 'blocked' | 'open' | 'FAIL', detail }. */
export function judge(attack, result, { upstreamDelta = 0, containsSecret = () => false } = {}) {
    if (attack.open) return { verdict: 'open', detail: attack.open };
    if (!attack.reaches && upstreamDelta > 0) return { verdict: 'FAIL', detail: `de doelhost ontving ${upstreamDelta} request(s)` };
    if (containsSecret(result.body ?? '')) return { verdict: 'FAIL', detail: 'een secret stond in het antwoord' };
    const ok = attack.check ? attack.check(result, { upstreamDelta, containsSecret }) : result.rule === attack.rule;
    return ok ? { verdict: 'blocked', detail: result.rule || `status ${result.status}` } : { verdict: 'FAIL', detail: `status ${result.status}, regel ${result.rule || '-'}` };
}

function server(lib, options) {
    const requests = [];
    const handler = (req, res) => {
        requests.push(req.url);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.url.startsWith('/echo') ? JSON.stringify({ headers: req.headers }) : '{"ok":true}');
    };
    const s = options ? lib.createServer(options, handler) : lib.createServer(handler);
    return new Promise(r => s.listen(0, '127.0.0.1', () => r({ s, requests, port: s.address().port })));
}

/**
 * Richt de kluis in via de portaal-API van het draaiende proces, zoals een gebruiker (eerste opzet, secrets, tools). Een
 * wijziging die meer toelaat vraagt een aanraking van een passkey: de bank zet een software-passkey als eerste passkey en
 * raakt die aan wanneer het portaal erom vraagt.
 */
async function seed(portalPort, proxyPort, upstream, httpsOrigin) {
    const base = `http://localhost:${portalPort}`;
    const passphrase = crypto.randomBytes(16).toString('hex');
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase }) });
    if (setup.status !== 200) throw new Error(`setup faalde: ${setup.status}`);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const { csrf } = await setup.json();
    const passkey = createSoftAuthenticator();
    const send = (method, urlPath, body) => fetch(`${base}${urlPath}`, { method, headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const api = async (method, urlPath, body) => {
        let res = await send(method, urlPath, body);
        if (res.status === 403) {
            const { error } = await res.json();
            if (error?.code !== 'STEP_UP_REQUIRED') throw new Error(`${method} ${urlPath}: 403`);
            res = await send(method, urlPath, { ...body, stepUp: passkey.assert({ challenge: error.stepUp.challenge, origin: base }) });
        }
        if (res.status !== 200) throw new Error(`${method} ${urlPath}: ${res.status}`);
        return res.json();
    };
    const { options } = await api('POST', '/api/webauthn/register/options');
    await api('POST', '/api/webauthn/register/verify', { response: passkey.register({ challenge: options.challenge, origin: base }) });
    const values = { api: `FAKE-api-${crypto.randomBytes(12).toString('hex')}`, nogrant: `FAKE-ng-${crypto.randomBytes(12).toString('hex')}`, tls: `FAKE-tls-${crypto.randomBytes(12).toString('hex')}` };
    await api('POST', '/api/secrets', { name: 'api', value: values.api, hosts: [upstream] });
    await api('POST', '/api/secrets', { name: 'nogrant', value: values.nogrant, hosts: [upstream] });
    await api('POST', '/api/secrets', { name: 'tls', value: values.tls, hosts: [httpsOrigin] });
    await api('POST', '/api/secrets', { name: 'scoped', value: values.api, hosts: [`${upstream}/scoped/`] });
    const tool = await api('POST', '/api/tools', { name: 'mytool' });
    await api('POST', '/api/grants', { toolId: tool.id, secretName: 'api', host: upstream });
    await api('POST', '/api/grants', { toolId: tool.id, secretName: 'tls', host: httpsOrigin });
    await api('POST', '/api/grants', { toolId: tool.id, secretName: 'scoped', host: `${upstream}/scoped/` });
    const old = await api('POST', '/api/tools', { name: 'oud' });
    await api('POST', `/api/tools/${old.id}/revoke`);

    const rot = await api('POST', '/api/tools', { name: 'rottool' });
    const ex1 = await raw(proxyPort, 'POST', '/device/exchange', { 'content-type': 'application/json' }, JSON.stringify({ tool_key: rot.key }));
    const k2 = JSON.parse(ex1.body).key;
    await raw(proxyPort, 'POST', '/device/exchange', { 'content-type': 'application/json' }, JSON.stringify({ tool_key: k2 }));
    const retiredKey = rot.key;

    // De software-passkey mag daarna geen aanraking meer geven (alleen externe sleutels): zoals een kluis zonder passkey
    // voor de tray, waar "altijd" hoogstens eenmalig is. Minder toelaten vraagt geen aanraking.
    await api('PUT', '/api/settings', { touchAuthenticator: 'external', approvalTimeoutMs: 1000 });
    return { values, key: tool.key, revokedKey: old.key, retiredKey, passphrase, cookie, csrf };
}

function start(home) {
    const caFile = path.join(home, 'test-cas.pem');
    fs.writeFileSync(caFile, `${tlsFile('ca-a.pem')}\n${tlsFile('ca-b.pem')}`);
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'main.js'), '--home', home, '--proxy-port', '0', '--portal-port', '0',
        '--tray-command', path.join(ROOT, 'test', 'fixtures', 'fakeTray.mjs')], { env: { ...process.env, NODE_EXTRA_CA_CERTS: caFile, FAKE_TRAY_ANSWER: 'once,always,once,once,deny' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', d => { output += d; });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Vaultgate niet klaar na 20 s:\n${output}`)), 20_000);
        child.stdout.on('data', d => {
            output += d;
            const ready = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.event === 'ready');
            if (ready) { clearTimeout(timer); resolve({ child, ready, output: () => output }); }
        });
        child.on('exit', code => reject(new Error(`Vaultgate stopte (${code}):\n${output}`)));
    });
}

function raw(port, method, urlPath, headers, body, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
        // timeoutMs: geen antwoord binnen die tijd = { status: 0, rule: 'no-answer' } (bv. de tarpit van 9.13).
        const timer = timeoutMs ? setTimeout(() => { req.destroy(); resolve({ status: 0, rule: 'no-answer', body: '' }); }, timeoutMs) : null;
        const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, res => {
            if (timer) clearTimeout(timer);
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, rule: res.headers['x-vault-gate-rule'] ?? '', body: data }));
        });
        req.on('error', reject); // na een time-out al opgelost: dan doet reject niets
        req.end(body);
    });
}

/** Draait de hele bank. Geeft { results: [{ id, name, verdict, detail }], leaks: [...] }. */
export async function runBench({ attacks = ATTACKS } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultgate-attack-'));
    const plain = await server(http);
    const secure = await server(https, { key: tlsFile('blad-a.key'), cert: tlsFile('blad-a.pem') });
    const elsewhere = await server(http);
    const upstream = `http://127.0.0.1:${plain.port}`;
    const proc = await start(home);
    // Wachten tot de (nep-)tray verbonden is: aanvallen A2b, A3 en A11 hebben haar antwoorden nodig (in die volgorde).
    for (const t0 = Date.now(); !proc.output().includes('"event":"tray-connected"'); await new Promise(r => setTimeout(r, 50))) {
        if (Date.now() - t0 > 60_000) throw new Error('de tray verbond niet binnen 60 s');
    }
    const seeded = await seed(proc.ready.portalPort, proc.ready.proxyPort, upstream, `https://localhost:${secure.port}`);
    const bodies = [];
    const secrets = [...Object.values(seeded.values), seeded.key, seeded.revokedKey, seeded.retiredKey];
    const containsSecret = text => secrets.some(s => [s, Buffer.from(s).toString('base64'), Buffer.from(s).toString('hex'), encodeURIComponent(s)].some(e => String(text).includes(e)));
    const ctx = {
        upstream, https: `https://localhost:${secure.port}`, elsewhere: `http://127.0.0.1:${elsewhere.port}`,
        revokedKey: seeded.revokedKey, retiredKey: seeded.retiredKey, portalPort: proc.ready.portalPort, containsSecret,
        proxy: (urlPath, { key = seeded.key, headers = {} } = {}) => raw(proc.ready.proxyPort, 'GET', urlPath, { 'x-vault-gate-tool-key': key, ...headers }),
        proxyWithin: (ms, urlPath, { key = seeded.key, headers = {} } = {}) => raw(proc.ready.proxyPort, 'GET', urlPath, { 'x-vault-gate-tool-key': key, ...headers }, undefined, ms),
        raw: (which, method, urlPath, headers, body) => raw(which === 'portal' ? proc.ready.portalPort : proc.ready.proxyPort, method, urlPath, headers, body),
        swapCertificate: () => secure.s.setSecureContext({ key: tlsFile('blad-c.key'), cert: tlsFile('blad-c.pem') }), // CA c staat niet in de lijst
        sabotageAudit: () => { const dir = path.join(home, 'vault', 'audit'); for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o444); },
        tamperCode,
        testAutoLock: async () => {
            const portalUrl = `http://localhost:${proc.ready.portalPort}`;
            const putRes = await fetch(`${portalUrl}/api/settings`, {
                method: 'PUT',
                headers: { cookie: seeded.cookie, 'x-csrf-token': seeded.csrf, 'content-type': 'application/json' },
                body: JSON.stringify({ autoLockMs: 10_000 }),
            });
            if (putRes.status !== 200) throw new Error(`expected PUT /api/settings 200, got ${putRes.status}`);
            const before = await fetch(`${portalUrl}/api/secrets`, {
                headers: { cookie: seeded.cookie, 'x-csrf-token': seeded.csrf },
            });
            if (before.status !== 200) throw new Error(`expected active session before autolock test, got ${before.status}`);
            const started = Date.now();
            while (Date.now() - started < 11_500) {
                await raw(proc.ready.proxyPort, 'GET', `/forward/${upstream}/x`, { 'x-vault-gate-tool-key': 'ks_onzinonzinonzinonzinonzin12' });
                await new Promise(r => setTimeout(r, 2000));
            }
            const check = await fetch(`${portalUrl}/api/secrets`, {
                headers: { cookie: seeded.cookie, 'x-csrf-token': seeded.csrf },
            });
            return { status: check.status, locked: check.status === 401 };
        },
    };
    const results = [];
    try {
        for (const attack of attacks) {
            if (attack.open) { results.push({ id: attack.id, name: attack.name, ...judge(attack, {}) }); continue; }
            const before = plain.requests.length + elsewhere.requests.length;
            const result = await attack.run(ctx);
            bodies.push(result.body ?? '');
            const upstreamDelta = plain.requests.length + elsewhere.requests.length - before;
            results.push({ id: attack.id, name: attack.name, ...judge(attack, result, { upstreamDelta, containsSecret }) });
        }
    } finally {
        proc.child.kill();
        await new Promise(r => proc.child.once('exit', r));
        for (const s of [plain, secure, elsewhere]) { s.s.closeAllConnections?.(); s.s.close(); }
        const dir = path.join(home, 'vault', 'audit');
        if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o600);
        try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows lock */ }
    }
    const leaks = [['proceslog', proc.output()], ['antwoorden', bodies.join('\n')]].filter(([, text]) => containsSecret(text)).map(([where]) => where);
    return { results, leaks };
}
