// Audit fail-closed. Lukt de audit-regel van een toestemming niet, dan
// vertrekt er niets en wordt er zelfs niets ontsleuteld: 503 audit-unavailable. Na herhaalde auditfouten vergrendelt de
// kluis zich. Module (poorten als dubbel) en journey (echt proces, het auditsegment alleen-lezen gemaakt).
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createProxy, AUDIT_LOCKDOWN_AFTER } from '../../src/proxy/index.js';
import { parseHostRules } from '../../src/policy/index.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const servers = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

async function serve(proxy) {
    const server = http.createServer((req, res) => proxy.handle(req, res));
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${server.address().port}`;
}

function deps({ failing = () => true } = {}) {
    const state = { decrypted: 0, locked: false, logged: [] };
    return {
        state,
        vault: { isUnlocked: () => !state.locked, lock: () => { state.locked = true; } },
        registry: {
            findToolByKey: async () => ({ id: 't', name: 'mytool', revoked: false, clients: [] }),
            findSecret: async name => ({ id: `id-${name}`, name, hosts: parseHostRules(['http://127.0.0.1:1']) }),
            findGrant: async () => ({ id: 'g1', mode: 'silent', expiresAt: null, expired: false }), // 3.4: findGrant i.p.v. hasGrant
            secretValue: async () => { state.decrypted += 1; return 'v'; },
        },
        audit: { append: async () => { if (failing()) throw Object.assign(new Error('schijf vol'), { code: 'ENOSPC' }); } },
        approval: { request: async () => ({ allow: false, status: 503, rule: 'approval-unavailable' }) },
        newRequestId: () => 'r1',
        log: e => state.logged.push(e),
        closedWaitMs: () => 10, // een gesloten kluis wacht de goedkeurings-time-out af
    };
}
const call = base => fetch(`${base}/forward/http://127.0.0.1:1/x`, { headers: { 'x-vault-gate-tool-key': 'ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', authorization: 'Bearer {{secret:s}}' } });

describe('audit fail-closed, module', () => {
    it('Given een audit die faalt When een toegestane request Then 503 audit-unavailable en niets ontsleuteld', async () => {
        const d = deps();
        const res = await call(await serve(createProxy(d)));
        expect(res.status).toBe(503);
        expect(res.headers.get('x-vault-gate-rule')).toBe('audit-unavailable');
        expect(d.state.decrypted).toBe(0);
    });

    it(`na ${AUDIT_LOCKDOWN_AFTER} opeenvolgende auditfouten vergrendelt de kluis zich (en dat wordt gemeld)`, async () => {
        const d = deps();
        const base = await serve(createProxy(d));
        for (let i = 0; i < AUDIT_LOCKDOWN_AFTER - 1; i++) await call(base);
        expect(d.state.locked).toBe(false);
        await call(base);
        expect(d.state.locked).toBe(true);
        expect(d.state.logged).toContainEqual({ event: 'audit-lockdown', failures: AUDIT_LOCKDOWN_AFTER });
        expect((await call(base)).headers.get('x-vault-gate-rule')).toBe('approval-timeout'); // gesloten kluis = uitgebleven goedkeuring
        expect(d.state.logged).toContainEqual(expect.objectContaining({ event: 'request', rule: 'vault-locked' })); // de log houdt de echte reden
    });

    it('een geslaagde audit zet de teller terug: losse fouten vergrendelen niet', async () => {
        let n = 0;
        const d = deps({ failing: () => (n++ % 2) === 0 });
        const base = await serve(createProxy(d));
        for (let i = 0; i < AUDIT_LOCKDOWN_AFTER * 2; i++) await call(base);
        expect(d.state.locked).toBe(false);
    });
});

describe.each(MODES)('audit fail-closed, journey %s', (mode, start) => {
    const value = fakeSecret('audit');
    let upstream;
    let proc;
    let key;
    let home;

    beforeAll(async () => {
        upstream = await startUpstream();
        home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            await registry.updateSettings({ approvalTimeoutMs: 1000 }); // de gesloten kluis wacht zo lang
            return tool.key;
        });
        proc = await start(home);
    }, 60_000);

    afterAll(async () => {
        const dir = path.join(home, 'vault', 'audit');
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) fs.chmodSync(path.join(dir, f), 0o600);
        await proc?.stop();
        await upstream?.close();
    });

    const fwd = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });

    it('Given een auditsegment dat niet meer beschrijfbaar is When een toegestane call Then 503, de doelhost ontvangt niets, en na herhaling is de kluis vergrendeld', async () => {
        expect((await fwd()).status).toBe(200);
        const dir = path.join(home, 'vault', 'audit');
        for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o444);
        const before = upstream.requests.length;
        const res = await fwd();
        expect(res.status).toBe(503);
        expect(res.headers.get('x-vault-gate-rule')).toBe('audit-unavailable');
        for (let i = 1; i < AUDIT_LOCKDOWN_AFTER; i++) await fwd();
        expect(upstream.requests.length).toBe(before);
        expect((await fwd()).headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(findLeaks({ out: proc.output() }, [value, key])).toEqual([]);
    });
});
