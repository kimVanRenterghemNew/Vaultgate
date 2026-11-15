// De uitwisseling op de proxy-poort (`POST /device/exchange`): lange sleutel in, token van 10 minuten en nieuwe sleutel
// uit. Elke uitwisseling staat in de audit (`key-rotated`, beheer, herkomst device); de tray-melding daarvan volgt de weg
// van elke beheerwijziging (gecoalesceerd, test/audit/adminNotify.test.js). Hergebruik meldt altijd, rechtstreeks. Een
// gesloten kluis wacht en antwoordt zoals een uitgebleven goedkeuring.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createProxy, createKeyExchange } from '../../src/proxy/index.js';
import fc from 'fast-check';
import { newVault, fakeClock, crypto } from '../vault/fixtures.js';
import { createRegistry } from '../../src/registry/index.js';
import { createAudit } from '../../src/audit/index.js';

const servers = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

async function serve(proxy) {
    const server = http.createServer((req, res) => proxy.handle(req, res));
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${server.address().port}`;
}

const TOKEN = 'ks_tokentokentokentokentokentokentoken0';
const NEXT = 'ks_00112233445566778899aabbccddeeff_nieuwnieuwnieuwnieuwnieuw';

function setup({ unlocked = true, result, settings = {}, auditFails = false } = {}) {
    let now = Date.parse('2026-10-22T12:00:00Z');
    const clock = { now: () => now, advance: ms => { now += ms; } };
    const audited = [];
    const notices = [];
    const logged = [];
    let generation = 0;
    const registry = {
        exchangeToolKey: async () => result ?? ({ allow: true, rule: 'key-exchanged', status: 200, tool: { id: 't1', name: 'agent' }, token: TOKEN, key: NEXT, expiresIn: 600, generation: (generation += 1), grace: false }),
        setGeneration: g => { generation = g; },
    };
    const vault = { isUnlocked: () => unlocked };
    const audit = { append: async e => { if (auditFails) throw Object.assign(new Error('disk'), { code: 'EIO' }); audited.push(e); } };
    const keyExchange = createKeyExchange({ vault, registry, audit, notify: n => notices.push(n), translate: (k, p) => `${k} ${JSON.stringify(p ?? {})}`, clock, policyState: () => settings, closedWaitMs: () => 200, log: e => logged.push(e) });
    const proxy = createProxy({ vault, registry, audit, approval: {}, keyExchange, newRequestId: () => 'r', log: e => logged.push(e) });
    return { proxy, clock, audited, notices, logged, registry };
}

const post = (base, body, headers = {}) => fetch(`${base}/device/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('proxy: /device/exchange, nooit een sleutel of token in de uitvoer', () => {
    it('property: na willekeurige uitwisselingen (huidig, oud, verzonnen, Rotate, Revoke) staat geen sleutel of token in audit, log, melding of foutmelding', async () => {
        await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom('current', 'old', 'garbage', 'rotate', 'revoke'), { minLength: 1, maxLength: 6 }), async ops => {
            const clock = fakeClock();
            const { vault, store } = newVault({ clock });
            await vault.create({ passphrase: 'p' });
            const registry = createRegistry({ vault, clock, crypto });
            const audit = createAudit({ vault, store, clock });
            const out = [];
            const exchange = createKeyExchange({ vault, registry, audit, notify: n => out.push(n), translate: (k, p) => `${k} ${JSON.stringify(p ?? {})}`, clock, policyState: () => ({}), closedWaitMs: () => 0, log: e => out.push(e) });
            const { id, key } = await registry.addTool({ name: 'agent' });
            const keys = [key];
            for (const op of ops) {
                if (op === 'rotate') keys.push((await registry.rotateToolKey(id)).key);
                else if (op === 'revoke') await registry.revokeTool(id);
                else {
                    const offered = { current: keys.at(-1), old: keys[0], garbage: `ks_${'0'.repeat(32)}_verzonnen` }[op];
                    const r = await exchange({ key: offered, client: '127.0.0.1' });
                    if (r.status === 200) keys.push(r.body.key, r.body.token);
                    else out.push(r.body);
                }
            }
            out.push(await audit.read());
            const text = JSON.stringify(out);
            for (const k of keys) expect(text).not.toContain(k);
        }), { numRuns: 15 });
    }, 60_000);
});

describe('proxy: /device/exchange', () => {
    it('Given een geldige sleutel When uitgewisseld Then token, nieuwe sleutel en regel; de audit heeft key-rotated zonder sleutel', async () => {
        const s = setup();
        const res = await post(await serve(s.proxy), { tool_key: 'ks_oud' });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('key-exchanged');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({ rule: 'key-exchanged', tool_name: 'agent', token: TOKEN, key: NEXT, expires_in: 600 });
        expect(s.audited).toEqual([expect.objectContaining({ mode: 'admin', origin: 'device', allow: true, rule: 'key-rotated', tool: 'agent', detail: 'generation 1' })]);
        expect(JSON.stringify([s.audited, s.logged, s.notices])).not.toMatch(/ks_/);
    });

    it('de melding "key geroteerd" loopt via de beheerregel in de audit (gecoalesceerd daar), niet rechtstreeks: elke uitwisseling een auditregel', async () => {
        const s = setup();
        const base = await serve(s.proxy);
        for (let i = 0; i < 3; i++) await post(base, { tool_key: 'ks_a' });
        expect(s.notices).toEqual([]);
        expect(s.audited.filter(e => e.rule === 'key-rotated' && e.mode === 'admin')).toHaveLength(3);
    });

    it('MOET weigeren: hergebruik: 401 key-reuse-detected in de response en de audit, en een melding, ook tijdens sluimeren', async () => {
        const s = setup({ result: { allow: false, rule: 'key-reuse-detected', status: 401, tool: { id: 't1', name: 'agent' } }, settings: { notificationSnooze: { globalUntil: Date.parse('2026-10-23T00:00:00Z'), grants: [] } } });
        const res = await post(await serve(s.proxy), { tool_key: 'ks_oud' });
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('key-reuse-detected');
        expect(await res.json()).toEqual({ error: 'key-reuse-detected', rule: 'key-reuse-detected' });
        expect(s.audited).toEqual([expect.objectContaining({ mode: 'device', allow: false, rule: 'key-reuse-detected', tool: 'agent', status: 401 })]);
        expect(s.notices.map(n => n.title)).toEqual([expect.stringContaining('tray.notify.reuse.title')]);
    });

    it('MOET weigeren: een onbekende sleutel: 401 no-tool-key, geen melding', async () => {
        const s = setup({ result: { allow: false, rule: 'no-tool-key', status: 401 } });
        const res = await post(await serve(s.proxy), { tool_key: 'ks_verzonnen' });
        expect(res.status).toBe(401);
        expect((await res.json()).rule).toBe('no-tool-key');
        expect(s.notices).toEqual([]);
    });

    it('MOET wachten: met een gesloten kluis pas na de time-out 401 approval-timeout; de log houdt vault-locked', async () => {
        const s = setup({ unlocked: false });
        const t0 = Date.now();
        const res = await post(await serve(s.proxy), { tool_key: 'ks_a' });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(await res.json()).toEqual({ error: 'approval-timeout', rule: 'approval-timeout' });
        expect(s.logged).toContainEqual(expect.objectContaining({ event: 'key-exchange', rule: 'vault-locked' }));
    });

    it('MOET weigeren: lukt de audit niet, dan geen token (fail-closed); de helper probeert later met de vorige sleutel', async () => {
        const s = setup({ auditFails: true });
        const res = await post(await serve(s.proxy), { tool_key: 'ks_a' });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: 'audit-unavailable', rule: 'audit-unavailable' });
    });

    it('MOET weigeren: dezelfde ingangscontrole als /device/*: geen JSON of een vreemde Host', async () => {
        const s = setup();
        const base = await serve(s.proxy);
        expect((await fetch(`${base}/device/exchange`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
        const port = new URL(base).port;
        const status = await new Promise(resolve => {
            const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/device/exchange', headers: { host: `evil.example:${port}`, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
            req.end('{}');
        });
        expect(status).toBe(421);
    });

    it('registry gooit VAULT_LOCKED tijdens exchange: wacht en geeft approval-timeout', async () => {
        const s = setup();
        s.registry.exchangeToolKey = async () => { throw Object.assign(new Error('locked'), { code: 'VAULT_LOCKED' }); };
        const res = await post(await serve(s.proxy), { tool_key: 'ks_a' });
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
    });

    it('registry gooit onverwachte fout: logt proxy-error en geeft 500', async () => {
        const s = setup();
        s.registry.exchangeToolKey = async () => { throw new Error('database kapot'); };
        const res = await post(await serve(s.proxy), { tool_key: 'ks_a' });
        expect(res.status).toBe(500);
    });
});
