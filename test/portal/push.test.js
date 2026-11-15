// Het pushkanaal van het portaal (Server-Sent Events) op moduleniveau: alleen met een lopende sessie en een eenmalig
// kaartje dat met het sessietoken gehaald is; berichten noemen alleen de soort; elke push staat in de log; Lock sluit het
// kanaal; een ophaling na een push verlengt de sessie niet.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fc from 'fast-check';
import { createPortal, PUSH_KINDS } from '../../src/portal/index.js';
import { createCrypto } from '../../src/crypto/index.js';

const servers = [];
afterEach(() => servers.splice(0).forEach(s => { s.closeAllConnections(); s.close(); }));

async function loggedIn({ clock = { now: () => Date.now() } } = {}) {
    const logged = [];
    const vault = { status: () => ({ exists: false, credentialCount: 0 }), create: async () => ({ recoveryCode: 'X' }), isUnlocked: () => true, lock: () => {}, listCredentials: () => [] };
    const portal = createPortal({ vault, registry: {}, audit: { append: async () => {} }, approval: { pending: () => [] }, crypto: createCrypto(), clock, log: e => logged.push(e) });
    const server = http.createServer((req, res) => portal.handle(req, res));
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    portal.setPort(server.address().port);
    const base = `http://localhost:${server.address().port}`;
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const { csrf } = await setup.json();
    const ticket = async (headers = { cookie, 'x-csrf-token': csrf }) => fetch(`${base}/api/push/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    return { base, portal, logged, cookie, csrf, ticket };
}

/** Opent de stroom en leest tot `until(tekst)` waar is of de server sluit. Geeft { status, text, closed }. */
async function stream(url, headers, until = () => false) {
    const res = await fetch(url, { headers });
    if (res.status !== 200) return { status: res.status, text: await res.text(), closed: true };
    const reader = res.body.getReader();
    let text = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return { status: 200, text, closed: true };
        text += Buffer.from(value).toString('utf8');
        if (until(text)) { await reader.cancel(); return { status: 200, text, closed: false }; }
    }
}

const opened = async s => {
    const { ticket } = await (await s.ticket()).json();
    return `${s.base}/api/push?ticket=${ticket}`;
};

describe('portaal: pushkanaal', () => {
    it('Given een sessie met kaartje When er iets verandert Then komt alleen de soort door en staat de push in de log', async () => {
        const s = await loggedIn();
        const url = await opened(s);
        const reading = stream(url, { cookie: s.cookie }, text => text.includes('data: settings'));
        await new Promise(r => setTimeout(r, 50));
        s.portal.publish('audit');
        s.portal.publish('settings');
        const { status, text } = await reading;
        expect(status).toBe(200);
        expect(text).toContain('data: audit\n\n');
        expect(s.logged).toContainEqual({ event: 'ui-push', kind: 'audit' });
        expect(s.logged).toContainEqual({ event: 'ui-push', kind: 'settings' });
    });

    it('MOET weigeren: zonder sessie, zonder kaartje, met een gebruikt kaartje of een kaartje van een andere sessie: 401 en geen berichten', async () => {
        const s = await loggedIn();
        expect((await s.ticket({})).status).toBe(401);
        expect((await s.ticket({ cookie: s.cookie })).status).toBe(403); // cookie zonder token
        expect((await stream(await opened(s), {})).status).toBe(401); // geen cookie
        expect((await stream(`${s.base}/api/push`, { cookie: s.cookie })).status).toBe(401); // geen kaartje
        const other = await fetch(`${s.base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"p"}' });
        const stolen = await opened(s);
        expect((await stream(stolen, { cookie: other.headers.get('set-cookie').split(';')[0] })).status).toBe(401); // andere sessie
        expect((await stream(stolen, { cookie: s.cookie })).status).toBe(401); // al aangeboden: verbruikt
        const url = await opened(s);
        expect((await stream(url, { cookie: s.cookie }, text => text.includes(': open'))).status).toBe(200);
        expect((await stream(url, { cookie: s.cookie })).status).toBe(401); // eenmalig
        expect(s.logged.filter(e => e.event === 'push-refused').map(e => e.rule).sort()).toEqual(['push-no-session', 'push-ticket-invalid', 'push-ticket-invalid', 'push-ticket-invalid', 'push-ticket-invalid']);
    });

    it('MOET weigeren: een verlopen kaartje of een verlopen sessie', async () => {
        let now = Date.now();
        const s = await loggedIn({ clock: { now: () => now } });
        const url = await opened(s);
        now += 31_000;
        expect((await stream(url, { cookie: s.cookie })).status).toBe(401);
        const late = await opened(s);
        now += 16 * 60_000;
        expect((await stream(late, { cookie: s.cookie })).status).toBe(401);
    });

    it('Given een open kanaal When Lock Then krijgt de pagina "lock" en sluit de server het kanaal', async () => {
        const s = await loggedIn();
        const url = await opened(s);
        const reading = stream(url, { cookie: s.cookie });
        await new Promise(r => setTimeout(r, 50));
        expect((await fetch(`${s.base}/api/lock`, { method: 'POST', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
        const { text, closed } = await reading;
        expect(text).toContain('data: lock\n\n');
        expect(closed).toBe(true);
    });

    it('Given een open kanaal When het hele portaal vergrendelt (tray) Then sluit de server het kanaal', async () => {
        const s = await loggedIn();
        const reading = stream(await opened(s), { cookie: s.cookie });
        await new Promise(r => setTimeout(r, 50));
        s.portal.lockPortal();
        expect((await reading).closed).toBe(true);
    });

    it('een ophaling na een push (x-portal-refresh) verlengt de sessie niet; een gewone handeling wel', async () => {
        let now = Date.now();
        const s = await loggedIn({ clock: { now: () => now } });
        const get = extra => fetch(`${s.base}/api/device`, { headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, ...extra } });
        now += 10 * 60_000;
        expect((await get({ 'x-portal-refresh': '1' })).status).toBe(200);
        now += 6 * 60_000; // 16 min sinds de laatste handeling
        expect((await get({})).status).toBe(401);
    });

    it('MOET weigeren: een onbekende soort wordt niet gepusht', async () => {
        const s = await loggedIn();
        expect(() => s.portal.publish('FAKE-secret-123')).toThrow(/unknown push kind/);
    });

    it('invariant: wat er ook gepusht wordt, de stroom bevat alleen vaste regels (soort, open, ping)', async () => {
        const s = await loggedIn();
        await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...PUSH_KINDS.filter(k => k !== 'lock')), { minLength: 1, maxLength: 8 }), async kinds => {
            // Pas pushen als de stroom open is (`: open` binnen): een vaste wachttijd verloor onder last soms de berichten.
            let ready;
            const open = new Promise(r => { ready = r; });
            const reading = stream(await opened(s), { cookie: s.cookie }, text => { if (text.startsWith(': open')) ready(); return text.split('data: ').length - 1 >= kinds.length; });
            await open;
            for (const kind of kinds) s.portal.publish(kind);
            const { text } = await reading;
            expect(text).toMatch(new RegExp(`^(: (open|ping)\\n\\n|data: (${PUSH_KINDS.join('|')})\\n\\n)+$`));
        }), { numRuns: 15 });
    }, 60_000); // 15 echte stromen na elkaar: onder de volle check duurt dat langer dan de standaard 15 s
});
