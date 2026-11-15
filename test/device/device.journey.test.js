// Een tool koppelt zich met de device flow. De CLI `node src/main.js login` draait als apart proces
// tegen het echte Vaultgate-proces; de tray (nep-tray over het echte tray-protocol) keurt goed of weigert. Daarna werkt
// de key op de proxy. Nergens staat de key of de device_code in de uitvoer, de audit of de kluisbestanden.
// Sinds 9.17 volgt op "toestaan" een aanraking van de passkey; hier met een software-passkey in de kluis
// (test/helpers/softAuthenticator.js), via dezelfde endpoints als het portaalvenster.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, runLogin, PASSPHRASE, approveDeviceWithSoftKey, readToolKey, keyFileText } from '../helpers/journey.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';
import { createVault } from '../../src/vault/index.js';
import { createAudit } from '../../src/audit/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';

const value = fakeSecret('device');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

async function terminalCode(login) {
    const deadline = Date.now() + 10_000;
    while (!/(Your code|Jouw code): [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    return login.stderr.match(/(?:Your code|Jouw code): ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
}


describe.each(MODES)('tools koppelen met de device flow, %s', (mode, start) => {
    async function scenario(trayAnswer) {
        const upstream = await startUpstream();
        cleanup.push(() => upstream.close());
        const home = tempHome();
        const auth = createSoftAuthenticator();
        await seedVault(home, async ({ vault, registry }) => {
            await vault.addCredential(auth.credential);
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
        });
        const proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: trayAnswer } });
        cleanup.push(() => proc.stop());
        const clientHome = tempHome();
        return { upstream, home, proc, clientHome, auth };
    }

    it('Given een tool zonder key When `login --name mytool`, de portalcode en passkey zijn bevestigd Then krijgt de tool haar key en werkt een proxy-call', async () => {
        const { upstream, home, proc, clientHome, auth } = await scenario('once');
        const pending = runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome });
        const code = await terminalCode(pending);
        expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(await approveDeviceWithSoftKey(proc, auth, code)).toBe(200);
        const login = await pending;
        expect(login.code, login.stderr).toBe(0);
        expect(login.stderr).toMatch(/(Your code|Jouw code): [0-9A-Z]{4}-[0-9A-Z]{4}/);
        expect(login.stdout).toBe('');
        // De tool krijgt haar key via `key --name`; op Windows is het bestand met DPAPI versleuteld en dus zelf onbruikbaar.
        const key = await readToolKey(clientHome, 'mytool');
        expect(key).toMatch(/^ks_/);
        expect(login.stderr).not.toContain(key);
        // Het bestand: de (nieuwe, geroteerde) lange sleutel en het adres van de proxy; `key --name` gaf een token.
        const [fileKey, proxyLine] = keyFileText(clientHome, 'mytool').split('\n');
        expect(proxyLine).toBe(`proxy ${proc.proxy}`);
        expect(fileKey).not.toContain(key);
        if (process.platform === 'win32') expect(fileKey).toMatch(/^dpapi:/);
        else expect(fileKey).toMatch(/^ks_/);
        const asKey = await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': fileKey, authorization: 'Bearer {{secret:demo}}' } });
        expect(asKey.status).toBe(401); // DPAPI-tekst: geen key; een lange sleutel van een roterende tool: token-required

        // De nieuwe tool heeft nog geen toekenning: de tray keurt de eerste call goed ("once").
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approved-once');
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);

        await proc.stop();
        const crypto = createCrypto();
        const clock = { now: () => Date.now() };
        const store = choose('store', 'local', { dir: path.join(home, 'vault') });
        const vault = createVault({ store, crypto, clock, kdf: MIN_KDF });
        await vault.load();
        await vault.unlockWithPassphrase(PASSPHRASE);
        const entries = await createAudit({ vault, store, clock }).read();
        const rules = entries.filter(e => e.mode !== 'admin').map(e => e.rule).reverse();
        expect(rules.slice(0, 3)).toEqual(['device-requested', 'device-approved', 'device-delivered']);
        // de nieuwe tool is beheer met herkomst device
        expect(entries.find(e => e.rule === 'tool-added')).toMatchObject({ mode: 'admin', origin: 'device', tool: 'mytool' });
        expect(findLeaks({ out: proc.output(), cli: login.stderr, ...readTree(home) }, [key, value])).toEqual([]);
    }, 60_000);

    it('de tray weigert: de CLI stopt met access_denied en er is geen key', async () => {
        const { proc, clientHome } = await scenario('deny');
        const login = await runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome });
        expect(login.code).toBe(1);
        expect(login.stderr).toContain('access_denied');
        expect(fs.existsSync(path.join(clientHome, 'clients', 'mytool.key'))).toBe(false);
    }, 60_000);

    it('opnieuw koppelen met dezelfde naam wordt geweigerd (name_taken; 9.5) en de bestaande key blijft werken; --print zet een nieuwe key op stdout', async () => {
        const { upstream, proc, clientHome, auth } = await scenario('once');
        const firstLogin = runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome });
        await approveDeviceWithSoftKey(proc, auth, await terminalCode(firstLogin));
        await firstLogin;
        const first = await readToolKey(clientHome, 'mytool');
        const firstFile = keyFileText(clientHome, 'mytool');
        // Vroeger kreeg de tweede aanvraag een nieuwe key voor dezelfde tool (met al haar toekenningen): een overname.
        const second = await runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome, print: true });
        expect(second.code).toBe(1);
        expect(second.stderr).toContain('name_taken');
        expect(keyFileText(clientHome, 'mytool')).toBe(firstFile);
        const call = k => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': k, authorization: 'Bearer {{secret:demo}}' } });
        expect((await call(first)).status).toBe(200);
        const otherLogin = runLogin({ proxy: proc.proxy, name: 'mytool-2', home: clientHome, print: true });
        await approveDeviceWithSoftKey(proc, auth, await terminalCode(otherLogin));
        const other = await otherLogin;
        expect(other.code).toBe(0);
        expect(other.stdout.trim()).toMatch(/^ks_/);
    }, 60_000);

    it('MOET weigeren: na de juiste code wordt de passkey-aanraking geweigerd: access_denied, geen key', async () => {
        const { proc, clientHome, auth } = await scenario('once');
        const pending = runLogin({ proxy: proc.proxy, name: 'mytool', home: clientHome });
        expect(await approveDeviceWithSoftKey(proc, auth, await terminalCode(pending), { deny: true })).toBe(200);
        const login = await pending;
        expect(login.code).toBe(1);
        expect(login.stderr).toContain('access_denied');
        expect(fs.existsSync(path.join(clientHome, 'clients', 'mytool.key'))).toBe(false);
    }, 60_000);

    it('MOET weigeren: een poll met een verzonnen device_code, en een ongeldige toolnaam', async () => {
        const { proc } = await scenario('never');
        const poll = await fetch(`${proc.proxy}/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: 'verzonnen' }) });
        expect(poll.status).toBe(400);
        expect(await poll.json()).toEqual({ error: 'invalid_grant' });
        const bad = await fetch(`${proc.proxy}/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'met spatie' }) });
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: 'invalid_request' });
    }, 60_000);
});
