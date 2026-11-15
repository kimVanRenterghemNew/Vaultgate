// De device flow (RFC 8628-vorm). Een tool vraagt een key, een mens keurt goed (tray of portaal),
// Sinds 9.17 vraagt goedkeuren een aanraking van de passkey; hier een aanraakpoort die "ok" zegt (dat gedrag staat in touch.test.js).
// de tool haalt zijn key één keer op. Standaard dicht: onbekend, verlopen, geweigerd of te snel pollen geeft een foutcode,
// nooit een key. Klok ingespoten.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDeviceFlow, POLL_RULES } from '../../src/device/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { newVault, crypto } from '../vault/fixtures.js';
import { fakeTimers, touchOk } from '../approval/fixtures.js';
import { createThrottle } from '../../src/throttle/index.js';

let clock;
let vault;
let registry;
let audited;
let flow;
beforeEach(async () => {
    clock = fakeTimers();
    ({ vault } = newVault({ clock }));
    await vault.create({ passphrase: 'p' });
    registry = createRegistry({ vault, clock, crypto });
    audited = [];
    flow = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async e => { audited.push(e); } }, intervalSeconds: 5, touch: touchOk, throttle: createThrottle({ clock, threshold: 2, blockMs: 1000 }) });
});

const poll = (code, client = '127.0.0.1') => flow.poll({ deviceCode: code, client });

describe('device flow', () => {
    it('aanvraag: device_code (geheim, 256 bit), user_code ABCD-EFGH, verloopt na 10 min, interval 5 s', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        expect(r.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(r.user_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        expect(r).toMatchObject({ expires_in: 600, interval: 5 });
        expect((await flow.pending())).toMatchObject([{ clientName: 'mytool', client: '127.0.0.1' }]);
        expect((await flow.pending())[0]).not.toHaveProperty('userCode');
        expect(JSON.stringify((await flow.pending()))).not.toContain(r.device_code);
        expect(audited.at(-1)).toMatchObject({ mode: 'device', tool: 'mytool', rule: 'device-requested' });
    });

    it('MOET eerst de terminalcode controleren; verkeerde codes tellen mee voor de client-throttle', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const { id } = (await flow.pending())[0];
        await expect(flow.approve(id, { requireCode: true })).rejects.toMatchObject({ code: 'DEVICE_CODE_INVALID', rule: 'device-code-required' });
        expect(() => flow.verifyCode(id, null)).toThrow(expect.objectContaining({ code: 'DEVICE_CODE_INVALID', rule: 'device-code-invalid' }));
        expect(() => flow.verifyCode(id, '0000-0000')).toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS', rule: 'device-code-throttled' }));
        expect(() => flow.verifyCode(id, '1111-1111')).toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS', rule: 'device-code-throttled' }));
        await clock.advance(1001);
        expect(flow.verifyCode(id, r.user_code)).toEqual({ verified: true });
        await flow.approve(id, { requireCode: true });
        expect(await flow.pending()).toEqual([]);
    });

    it('Given een tool zonder key When goedgekeurd Then haalt ze haar key één keer op; een tweede keer is de aanvraag weg', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        expect(await poll(r.device_code)).toMatchObject({ status: 400, body: { error: 'authorization_pending' }, rule: 'device-pending' });
        const { id } = (await flow.pending())[0];
        await flow.approve(id);
        clock.advance(5_000);
        const ready = await poll(r.device_code);
        expect(ready).toMatchObject({ status: 200, rule: 'device-ready', body: { tool_name: 'mytool' } });
        expect(ready.body.tool_key).toMatch(/^ks_/);
        expect(await registry.findToolByKey(ready.body.tool_key)).toMatchObject({ name: 'mytool', revoked: false });
        expect(await poll(r.device_code)).toMatchObject({ status: 400, body: { error: 'invalid_grant' }, rule: 'device-unknown' });
        expect((await flow.pending())).toEqual([]);
        expect(audited.map(e => e.rule)).toEqual(['device-requested', 'device-approved', 'device-delivered']);
        expect(JSON.stringify(audited)).not.toContain(ready.body.tool_key);
        expect(JSON.stringify(audited)).not.toContain(r.device_code);
    });

    it('weigeren: access_denied en er komt geen tool', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        await flow.deny((await flow.pending())[0].id);
        expect(await poll(r.device_code)).toMatchObject({ status: 400, body: { error: 'access_denied' }, rule: 'device-denied' });
        expect(await registry.listTools()).toEqual([]);
    });

    it('Given een aanvraag When 10 minuten niemand reageert Then expired_token', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        await clock.advance(600_001);
        expect(await poll(r.device_code)).toMatchObject({ status: 400, body: { error: 'expired_token' }, rule: 'device-expired' });
        expect((await flow.pending())).toEqual([]);
        expect(audited.at(-1)).toMatchObject({ rule: 'device-expired', allow: false, tool: 'mytool' });
    });

    it('sneller pollen dan het interval: slow_down', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        await poll(r.device_code);
        clock.advance(1_000);
        expect(await poll(r.device_code)).toMatchObject({ status: 400, body: { error: 'slow_down' }, rule: 'device-slow-down' });
    });

    it('een VM-adres wordt de client-allowlist (een bestaande naam overnemen kan niet meer: test/device/hardening.test.js, 9.5)', async () => {
        const r2 = await flow.request({ clientName: 'agent-vm', client: '192.168.56.11' });
        await flow.approve((await flow.pending())[0].id);
        clock.advance(5_000);
        const { body: vm } = await poll(r2.device_code, '192.168.56.11');
        expect((await registry.findToolByKey(vm.tool_key)).clients.map(c => c.text)).toEqual(['192.168.56.11/32']);
    });

    it('MOET weigeren: een onbekende device_code, een ongeldige naam, een 6e wachtende aanvraag van hetzelfde adres', async () => {
        expect(await poll('bestaat-niet')).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
        await expect(flow.request({ clientName: 'met spatie', client: '127.0.0.1' })).rejects.toMatchObject({ code: 'INVALID_NAME' });
        for (let i = 0; i < 5; i++) await flow.request({ clientName: `t${i}`, client: '10.0.0.1' });
        await expect(flow.request({ clientName: 't5', client: '10.0.0.1' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        await flow.request({ clientName: 'ander', client: '10.0.0.2' }); // een ander adres mag nog
    });

    it('MOET weigeren: goedkeuren met een vergrendelde kluis; een onbekende of al beslist id', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const { id } = (await flow.pending())[0];
        vault.lock();
        await expect(flow.approve(id)).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
        expect(await poll(r.device_code)).toMatchObject({ rule: 'device-pending' });
        await expect(flow.approve('onbekend')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await flow.deny(id);
        await expect(flow.deny(id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // al beslist: niet meer wachtend
    });

    it('elke regel van de poll-tabel heeft een scenario en de tabel eindigt met een standaard die niets uitlevert', () => {
        expect(POLL_RULES.map(r => r.name)).toEqual(['device-unknown', 'device-expired', 'device-denied', 'device-ready', 'device-slow-down', 'device-pending']);
        expect(POLL_RULES.at(-1).then.status).toBe(400);
    });

    it('een tray-klik vervangt de portalcode niet; de gebruiker typt de code in en keurt daar goed', async () => {
        const asked = [];
        const withTray = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async () => {} }, intervalSeconds: 5, touch: touchOk,
            notifier: { ask: async q => { asked.push(q); return 'once'; } } });
        const r = await withTray.request({ clientName: 'claude-code', client: '127.0.0.1' });
        await new Promise(res => setImmediate(res));
        expect(asked[0]).toMatchObject({ variant: 'device', tool: 'claude-code', client: '127.0.0.1' });
        // De code staat alleen in de terminal: wie de koppeling niet zelf startte, kan ze niet uit de pop-up overtypen.
        expect(JSON.stringify(asked[0])).not.toContain(r.user_code);
        expect(JSON.stringify(asked[0])).not.toContain(r.user_code.replace('-', ''));
        expect((await withTray.poll({ deviceCode: r.device_code })).rule).toBe('device-pending');
        const { id } = (await withTray.pending())[0];
        withTray.verifyCode(id, r.user_code);
        await withTray.approve(id, { requireCode: true });
        clock.advance(5_000);
        expect((await withTray.poll({ deviceCode: r.device_code, client: '127.0.0.1' })).rule).toBe('device-ready');
    });
});

describe('device flow: de client (runDeviceLogin)', () => {
    const fakeFetch = responses => {
        const calls = [];
        const impl = async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body) });
            const [status, body] = responses.shift();
            return { status, json: async () => body };
        };
        return { impl, calls };
    };
    const START = [200, { device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'http://localhost:1/#device', interval: 5 }];

    it('wacht het interval, verhoogt het bij slow_down, en geeft de key bij succes', async () => {
        const { runDeviceLogin } = await import('../../src/device/index.js');
        const { impl, calls } = fakeFetch([START, [400, { error: 'authorization_pending' }], [400, { error: 'slow_down' }], [200, { tool_key: 'ks_x', tool_name: 'mytool' }]]);
        const waits = [];
        const out = [];
        const result = await runDeviceLogin({ proxy: 'http://127.0.0.1:8484/', name: 'mytool', fetchImpl: impl, sleep: async ms => { waits.push(ms); }, out: t => out.push(t) });
        expect(result).toEqual({ toolKey: 'ks_x', toolName: 'mytool' });
        expect(waits).toEqual([5000, 5000, 10000]);
        expect(calls[0]).toEqual({ url: 'http://127.0.0.1:8484/device/code', body: { client_name: 'mytool' } });
        expect(calls[1]).toEqual({ url: 'http://127.0.0.1:8484/device/token', body: { device_code: 'dc' } });
        expect(out.join('\n')).toContain('ABCD-EFGH');
        expect(out.join('\n')).not.toContain('dc"');
    });

    it('MOET weigeren: een geweigerde of mislukte aanvraag stopt met een getagde fout', async () => {
        const { runDeviceLogin } = await import('../../src/device/index.js');
        const denied = fakeFetch([START, [400, { error: 'access_denied' }]]);
        await expect(runDeviceLogin({ proxy: 'http://x', name: 'mytool', fetchImpl: denied.impl, sleep: async () => {} })).rejects.toMatchObject({ code: 'DEVICE_ACCESS_DENIED' });
        const refused = fakeFetch([[429, { error: 'too_many_requests' }]]);
        await expect(runDeviceLogin({ proxy: 'http://x', name: 'mytool', fetchImpl: refused.impl, sleep: async () => {} })).rejects.toMatchObject({ code: 'DEVICE_REQUEST_FAILED' });
        const noUri = fakeFetch([[200, { device_code: 'dc', user_code: 'ABCD-EFGH', interval: 1 }], [400, { error: 'expired_token' }]]);
        await expect(runDeviceLogin({ proxy: 'http://x', name: 'mytool', fetchImpl: noUri.impl, sleep: async () => {} })).rejects.toMatchObject({ code: 'DEVICE_EXPIRED_TOKEN' });
    });
});

describe('device flow: randen', () => {
    it('een tray die faalt of zwijgt, laat de aanvraag wachten (het portaal kan nog beslissen); "weigeren" in de tray weigert', async () => {
        const logged = [];
        const failing = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async () => {} }, log: e => logged.push(e), notifier: { ask: async () => { throw Object.assign(new Error('pipe'), { code: 'EPIPE' }); } } });
        await failing.request({ clientName: 'a', client: '127.0.0.1' });
        await new Promise(r => setImmediate(r));
        expect(logged).toContainEqual({ event: 'device-tray-failed', code: 'EPIPE' });
        expect(await failing.pending()).toHaveLength(1);
        const silent = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async () => {} }, notifier: { ask: async () => 'timeout' } });
        await silent.request({ clientName: 'b', client: '127.0.0.1' });
        await new Promise(r => setImmediate(r));
        expect(await silent.pending()).toHaveLength(1);
        const denying = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async () => {} }, notifier: { ask: async () => 'deny' } });
        const r = await denying.request({ clientName: 'c', client: '127.0.0.1' });
        await new Promise(res => setImmediate(res));
        expect((await denying.poll({ deviceCode: r.device_code })).rule).toBe('device-denied');
    });

    it('een audit die faalt, stopt de flow niet; een verlopen aanvraag wordt ook zonder poll opgeruimd en geaudit; pending zonder open kluis kent geen bestaande namen', async () => {
        const logged = [];
        const entries = [];
        let fail = true;
        const f = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async e => { if (fail) throw Object.assign(new Error('vol'), { code: 'ENOSPC' }); entries.push(e); } }, log: e => logged.push(e) });
        await f.request({ clientName: 'mytool', client: '127.0.0.1' });
        await new Promise(r => setImmediate(r));
        expect(logged).toContainEqual({ event: 'audit-failed', code: 'ENOSPC' });
        fail = false;
        vault.lock();
        expect((await f.pending())[0]).toMatchObject({ existing: false });
        await clock.advance(600_001);
        expect(await f.pending()).toEqual([]);
        expect(entries.at(-1)).toMatchObject({ rule: 'device-expired' });
        expect((await f.poll({ deviceCode: undefined })).rule).toBe('device-unknown');
    });
});

describe('clienthelpers voor Claude Code en git', () => {
    it('readSavedKey leest alleen een Vaultgate tool-key; anders een duidelijke fout', async () => {
        const { readSavedKey, savedKeyPath } = await import('../../src/device/index.js');
        const files = { [savedKeyPath('/h', 'claude-code')]: 'ks_abc\n', [savedKeyPath('/h', 'vreemd')]: 'sk-ant-echte-sleutel' };
        const readFile = p => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
        expect(readSavedKey({ home: '/h', name: 'claude-code', readFile })).toBe('ks_abc');
        expect(() => readSavedKey({ home: '/h', name: 'vreemd', readFile })).toThrow(expect.objectContaining({ code: 'NO_SAVED_KEY' }));
        expect(() => readSavedKey({ home: '/h', name: 'nog-niet', readFile })).toThrow(/login --name nog-niet/);
        expect(() => readSavedKey({ home: '/h', name: '../x', readFile })).toThrow(expect.objectContaining({ code: 'INVALID_NAME' }));
    });

    it('gitCredential: op get alleen de tool-key; store en erase doen niets', async () => {
        const { gitCredential } = await import('../../src/device/index.js');
        expect(gitCredential({ operation: 'get', key: 'ks_abc' })).toBe('username=x-access-token\npassword=ks_abc\n');
        expect(gitCredential({ operation: 'store', key: 'ks_abc' })).toBe('');
        expect(gitCredential({ operation: 'erase', key: 'ks_abc' })).toBe('');
    });
});

describe('savedKeyPath', () => {
    it('een home met een schuine streep of backslash op het einde geeft geen dubbele scheiding', async () => {
        const { savedKeyPath } = await import('../../src/device/index.js');
        expect(savedKeyPath('C:\\ks\\', 'mytool')).toBe('C:\\ks/clients/mytool.key');
        expect(savedKeyPath('/home/k/', 'mytool')).toBe('/home/k/clients/mytool.key');
    });
});
