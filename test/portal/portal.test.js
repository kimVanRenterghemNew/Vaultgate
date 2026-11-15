// Het portaal op moduleniveau (poorten als dubbel): een onverwachte fout lekt geen interne melding, een POST zonder body is
// een lege JSON, afmelden zonder sessie sluit de kluis, een falende audit houdt sluiten of een request niet tegen.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createPortal } from '../../src/portal/index.js';
import { createCrypto } from '../../src/crypto/index.js';

const servers = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

async function serve(overrides = {}) {
    const logged = [];
    const vault = { status: () => ({ exists: true, credentialCount: 0, passkeyCount: 0 }), listCredentials: () => [], isUnlocked: () => true, lock: () => {}, create: async () => ({ recoveryCode: 'X' }), ...overrides.vault };
    const portal = createPortal({
        vault,
        registry: { listSecrets: async () => { throw new Error('kapot met geheim FAKE-intern-123'); }, ...overrides.registry },
        audit: overrides.audit ?? {}, approval: { pending: () => [] }, crypto: createCrypto(), clock: overrides.clock ?? { now: () => Date.now() },
        log: e => logged.push(e),
        ...(overrides.device ? { device: overrides.device } : {}),
    });
    const server = http.createServer((req, res) => portal.handle(req, res));
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    portal.setPort(server.address().port);
    return { base: `http://localhost:${server.address().port}`, logged };
}

describe('portaal: modulegrenzen', () => {
    it('een onverwachte fout: 500 "internal error", nooit de oorspronkelijke melding, wel een gebeurtenis zonder inhoud', async () => {
        const { base, logged } = await serve({ vault: { status: () => ({ exists: false, credentialCount: 0 }), create: async () => { throw new Error('kapot met geheim FAKE-intern-123'); } } });
        const res = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(JSON.parse(text).error).toEqual({ code: 'INTERNAL', message: 'internal error' });
        expect(text).not.toContain('FAKE-intern');
        expect(logged).toContainEqual({ event: 'portal-error', code: 'unknown' });
    });

    it('een POST zonder body is een lege JSON; afmelden zonder sessie sluit toch de kluis', async () => {
        let locks = 0;
        const { base } = await serve({ vault: { lock: () => { locks += 1; } }, audit: { append: async () => {} } });
        const res = await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'content-type': 'application/json' } });
        expect(res.status).toBe(200);
        expect(locks).toBe(1);
    });

    it('MOET weigeren: afmelden zonder sessie van een andere origin of zonder JSON sluit de kluis niet', async () => {
        let locks = 0;
        const { base } = await serve({ vault: { lock: () => { locks += 1; } }, audit: { append: async () => {} } });
        expect((await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' } })).status).toBe(403);
        expect((await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(403);
        expect(locks).toBe(0);
    });
});

// Review 2026-10-21: sluiten en sessies mogen nooit van een werkende audit afhangen.
describe('portaal: een falende audit', () => {
    const failingAudit = { append: async () => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); } };

    async function loggedIn(extra = {}) {
        let unlocked = true;
        const vault = { status: () => ({ exists: false, credentialCount: 0 }), create: async () => ({ recoveryCode: 'X' }), isUnlocked: () => unlocked, lock: () => { unlocked = false; } };
        const served = await serve({ vault, audit: failingAudit, ...extra });
        const setup = await fetch(`${served.base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        const cookie = setup.headers.get('set-cookie').split(';')[0];
        const { csrf } = await setup.json();
        const post = path => fetch(`${served.base}${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' });
        return { ...served, cookie, csrf, post, isUnlocked: () => unlocked };
    }

    it('Given een falende audit When Log out Then is de kluis dicht, de sessie weg en staat de fout in de log', async () => {
        const s = await loggedIn();
        expect((await s.post('/api/logout')).status).toBe(200);
        expect(s.isUnlocked()).toBe(false);
        expect((await fetch(`${s.base}/api/device`, { headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } })).status).toBe(401);
        await new Promise(r => setTimeout(r, 10));
        expect(s.logged).toContainEqual({ event: 'audit-failed', code: 'EROFS' });
    });

    it('Given een falende audit When Lock Then is de sessie weg en blijft de kluis open', async () => {
        const s = await loggedIn();
        expect((await s.post('/api/lock')).status).toBe(200);
        expect(s.isUnlocked()).toBe(true);
        expect((await fetch(`${s.base}/api/device`, { headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } })).status).toBe(401);
    });

    it('Given een verlopen sessie en een falende audit When een request met het oude cookie Then geen fout, gewoon niet ingelogd; Log out sluit de kluis', async () => {
        let now = Date.now();
        const s = await loggedIn({ clock: { now: () => now } });
        now += 16 * 60_000;
        const state = await fetch(`${s.base}/api/state`, { headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } });
        expect(state.status).toBe(200);
        expect((await state.json()).loggedIn).toBe(false);
        const logout = await fetch(`${s.base}/api/logout`, { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json' }, body: '{}' });
        expect(logout.status).toBe(200);
        expect(s.isUnlocked()).toBe(false);
    });
});

describe('portaal zonder device-module', () => {
    it('GET /api/device met sessie geeft een lege lijst', async () => {
        const { base } = await serve({ vault: { status: () => ({ exists: false, credentialCount: 0 }), create: async () => ({ recoveryCode: 'X' }) } });
        const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        const cookie = setup.headers.get('set-cookie').split(';')[0];
        const { csrf } = await setup.json();
        const res = await fetch(`${base}/api/device`, { headers: { cookie, 'x-csrf-token': csrf } });
        expect(await res.json()).toEqual([]);
    });
});

describe('portaal: koppelen met aanraking', () => {
    async function session(device) {
        const { base, logged } = await serve({ vault: { status: () => ({ exists: false, credentialCount: 0 }), create: async () => ({ recoveryCode: 'X' }) }, device });
        const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        const cookie = setup.headers.get('set-cookie').split(';')[0];
        const { csrf } = await setup.json();
        const approve = async () => (await fetch(`${base}/api/device/abc123/approve`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' })).json();
        return { base, logged, approve };
    }

    it('zonder passkey: meteen geweigerd, zonder aanraakvraag', async () => {
        const { approve } = await session({ approve: async () => ({ denied: 'touch-unavailable' }) });
        expect(await approve()).toEqual({ denied: 'touch-unavailable' });
    });

    it('met passkey: het id van de aanraking komt terug; de uitkomst daarna komt in de log', async () => {
        let finish;
        const { approve, logged } = await session({ approve: (id, { openTouch }) => { openTouch('touch-id-1234567890'); return new Promise(r => { finish = r; }); } });
        expect(await approve()).toEqual({ touch: 'touch-id-1234567890' });
        finish({ denied: 'touch-denied' });
        await new Promise(r => setTimeout(r, 20));
        expect(logged).toContainEqual({ event: 'device-approve-result', denied: 'touch-denied' });
    });

    it('MOET weigeren: een aanraakvraag zonder aanraakmodule of met een onbekend id (404)', async () => {
        const { base } = await session({ approve: async () => ({}) });
        expect((await fetch(`${base}/api/touch/onbekend-id-1234567890`)).status).toBe(404);
        expect((await fetch(`${base}/api/touch/onbekend-id-1234567890/deny`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    });

    it('tls routes zonder tlsTrust poort geven lege lijsten', async () => {
        const { base } = await serve({ vault: { status: () => ({ exists: false, credentialCount: 0 }), create: async () => ({ recoveryCode: 'X' }) } });
        const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        const cookie = setup.headers.get('set-cookie').split(';')[0];
        const { csrf } = await setup.json();
        const res = await fetch(`${base}/api/tls`, { headers: { cookie, 'x-csrf-token': csrf } });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
        const trustedRes = await fetch(`${base}/api/tls/trusted`, { headers: { cookie, 'x-csrf-token': csrf } });
        expect(trustedRes.status).toBe(200);
        expect(await trustedRes.json()).toEqual([]);
        const addedRes = await fetch(`${base}/api/tls/added-roots`, { headers: { cookie, 'x-csrf-token': csrf } });
        expect(addedRes.status).toBe(200);
        expect(await addedRes.json()).toEqual([]);
    });
});
