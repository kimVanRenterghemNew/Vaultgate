// Keys die vanzelf roteren, met het echte proces: een tool koppelt (`login`), haalt daarna bij elke `key --name` een token
// van 10 minuten en laat haar lange sleutel vervangen. Een gekopieerd key-bestand dat later nog eens gebruikt wordt, valt
// op: de tool wordt ingetrokken, de tray meldt het, de audit heeft `key-reuse-detected`. Een handmatige key blijft werken
// en het portaal zegt bij elke key of ze roteert. Nergens staat een sleutel of token in de uitvoer, de audit of de kluis.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, MAIN, runLogin, PASSPHRASE, approveDeviceWithSoftKey } from '../helpers/journey.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';
import { createVault } from '../../src/vault/index.js';
import { createAudit } from '../../src/audit/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';

const value = fakeSecret('rotation');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

/** `node src/main.js key --name <name>` zoals Claude Code het als apiKeyHelper start. */
function runKey(home, name) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [MAIN, 'key', '--name', name, '--home', home], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('exit', code => resolve({ code, token: stdout.trim(), stderr }));
    });
}

async function terminalCode(login) {
    const deadline = Date.now() + 10_000;
    while (!/(Your code|Jouw code): [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    return login.stderr.match(/(?:Your code|Jouw code): ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
}

async function portalTools(proc, auth) {
    const post = (p, body, headers = {}) => fetch(`${proc.portal}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: proc.portal, ...headers }, body: JSON.stringify(body ?? {}) });
    const { options } = await (await post('/api/webauthn/login/options')).json();
    const login = await post('/api/webauthn/login/verify', { response: auth.assert({ challenge: options.challenge, origin: proc.portal }) });
    const { csrf } = await login.json();
    const res = await fetch(`${proc.portal}/api/tools`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': csrf } });
    return { text: await res.clone().text(), tools: await res.json() };
}

async function readAudit(home) {
    const crypto = createCrypto();
    const clock = { now: () => Date.now() };
    const store = choose('store', 'local', { dir: path.join(home, 'vault') });
    const vault = createVault({ store, crypto, clock, kdf: MIN_KDF });
    await vault.load();
    await vault.unlockWithPassphrase(PASSPHRASE);
    return createAudit({ vault, store, clock }).read();
}

describe.each(MODES)('keys roteren vanzelf, %s', (mode, start) => {
    it('Given een gekoppelde tool When ze 3 keer uitwisselt Then telkens een nieuw token en een nieuwe sleutel en werkt elke call; een oude kopie trekt de tool in', async () => {
        const upstream = await startUpstream();
        cleanup.push(() => upstream.close());
        const home = tempHome();
        const auth = createSoftAuthenticator();
        const manual = await seedVault(home, async ({ vault, registry }) => {
            await vault.addCredential(auth.credential);
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            return registry.addTool({ name: 'manual' }); // een key die iemand zelf in een configbestand zette
        });
        const trayLog = path.join(home, 'tray.log');
        const proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: 'once', FAKE_TRAY_LOG: trayLog } });
        cleanup.push(() => proc.stop());
        const clientHome = tempHome();
        const login = runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome });
        expect(await approveDeviceWithSoftKey(proc, auth, await terminalCode(login))).toBe(200);
        expect((await login).code).toBe(0);
        const keyFile = path.join(clientHome, 'clients', 'mytool.key');
        const call = token => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': token, authorization: 'Bearer {{secret:demo}}' } });

        const stolen = fs.readFileSync(keyFile); // een kopie van het bestand, vóór de eerste uitwisseling
        const tokens = [];
        const files = [stolen.toString('utf8')];
        for (let i = 0; i < 3; i++) {
            const r = await runKey(clientHome, 'mytool');
            expect(r.code, r.stderr).toBe(0);
            expect(r.token).toMatch(/^ks_/);
            tokens.push(r.token);
            files.push(fs.readFileSync(keyFile, 'utf8'));
            const res = await call(r.token);
            expect(res.status).toBe(200);
            expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
        }
        expect(new Set(tokens).size).toBe(3);
        expect(new Set(files).size).toBe(4); // elke uitwisseling schreef een nieuwe sleutel

        // Een handmatige key blijft werken (optie B); het portaal zegt per key of ze roteert.
        expect((await call(manual.key)).status).toBe(200);
        const portal = await portalTools(proc, auth);
        expect(portal.tools.find(t => t.name === 'mytool')).toMatchObject({ rotating: true });
        expect(portal.tools.find(t => t.name === 'manual')).toMatchObject({ rotating: false });

        // De kopie wordt teruggezet en gebruikt: de familie is al verder, dus dit is een gestolen sleutel.
        fs.writeFileSync(keyFile, stolen);
        const reused = await runKey(clientHome, 'mytool');
        expect(reused.code).toBe(1);
        expect(reused.stderr).toContain('key-reuse-detected');
        const after = await call(tokens.at(-1));
        expect(after.status).toBe(401);
        expect(after.headers.get('x-vault-gate-rule')).toBe('no-tool-key'); // de tokens van de tool zijn weg
        fs.writeFileSync(keyFile, files.at(-1)); // ook de echte, nieuwste sleutel werkt niet meer
        expect((await runKey(clientHome, 'mytool')).code).toBe(1);

        const deadline = Date.now() + 5_000;
        while (!(fs.existsSync(trayLog) && /copied|kopie/i.test(fs.readFileSync(trayLog, 'utf8'))) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        const notices = fs.readFileSync(trayLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.type === 'notify');
        expect(notices.filter(n => /automatically|automatisch/i.test(n.text))).toHaveLength(1); // één melding per 8 uur
        expect(notices.some(n => /copied|kopie/i.test(`${n.title} ${n.text}`))).toBe(true);

        const output = await proc.stop();
        const audit = await readAudit(home);
        const rules = audit.map(e => e.rule);
        expect(rules.filter(r => r === 'key-rotated')).toHaveLength(3);
        expect(audit.find(e => e.rule === 'key-rotated')).toMatchObject({ mode: 'admin', origin: 'device', tool: 'mytool' });
        expect(audit.find(e => e.rule === 'key-reuse-detected')).toMatchObject({ allow: false, tool: 'mytool' });
        const keysSeen = [...tokens, manual.key];
        expect(findLeaks({ out: output, portal: portal.text, audit: JSON.stringify(audit), tray: fs.readFileSync(trayLog, 'utf8'), ...readTree(path.join(home, 'vault')) }, [value, ...keysSeen])).toEqual([]);
    }, 90_000);
});
