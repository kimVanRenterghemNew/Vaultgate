// Foutpaden van de proxy op moduleniveau (poorten als dubbel): wat in een echt proces moeilijk uit te lokken is, maar wel
// standaard dicht moet zijn. Een fout geeft een regelnaam en nooit een stille doorgang of een waarde in de melding.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createProxy } from '../../src/proxy/index.js';
import { parseHostRules } from '../../src/policy/index.js';

const servers = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

async function serve(proxy) {
    const server = http.createServer((req, res) => proxy.handle(req, res));
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${server.address().port}`;
}

const tool = { id: 't', name: 'mytool', revoked: false, clients: [] };
function deps(overrides = {}) {
    const audited = [];
    return {
        audited,
        vault: { isUnlocked: () => true },
        registry: {
            findToolByKey: async () => tool,
            findSecret: async name => ({ id: `id-${name}`, name, hosts: parseHostRules(['http://127.0.0.1:1']) }),
            findGrant: async () => ({ id: 'g1', mode: 'silent', expiresAt: null, expired: false }), // 3.4: findGrant i.p.v. hasGrant
            secretValue: async () => 'v',
            ...overrides.registry,
        },
        audit: { append: async e => { audited.push(e); }, ...overrides.audit },
        approval: { request: async () => ({ allow: false, status: 503, rule: 'approval-unavailable' }), ...overrides.approval },
        newRequestId: () => 'r1',
    };
}

const call = (base) => fetch(`${base}/forward/http://127.0.0.1:1/x`, { headers: { 'x-vault-gate-tool-key': 'ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', authorization: 'Bearer {{secret:s}}' } });

describe('proxy: foutpaden', () => {
    it('de kluis sluit tussen beslissing en invullen: na de time-out 401 approval-timeout zoals een uitgebleven goedkeuring; de audit zegt vault-locked', async () => {
        const d = deps({ registry: { secretValue: async () => { throw Object.assign(new Error('locked'), { code: 'VAULT_LOCKED' }); } } });
        const started = Date.now();
        const res = await call(await serve(createProxy({ ...d, closedWaitMs: () => 300 })));
        expect(Date.now() - started).toBeGreaterThanOrEqual(290);
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(res.headers.get('www-authenticate')).toBe('Basic realm="vaultgate"');
        expect(await res.json()).toEqual({ error: { type: 'vaultgate', rule: 'approval-timeout', message: 'approval-timeout', secret: 's' } });
        expect(d.audited.at(-1)).toMatchObject({ allow: false, rule: 'vault-locked', status: 401, secret: 's' });
    });

    it('MOET wachten: een gesloten kluis antwoordt niet voor de time-out verstreken is', async () => {
        const d = deps();
        const base = await serve(createProxy({ ...d, vault: { isUnlocked: () => false }, closedWaitMs: () => 2000 }));
        const res = await Promise.race([call(base).then(() => 'answered'), new Promise(r => setTimeout(() => r('waiting'), 500))]);
        expect(res).toBe('waiting');
    });

    it('een onverwachte fout: 500 internal-error met een regelnaam, geen stacktrace of waarde', async () => {
        const logged = [];
        const d = deps({ registry: { findSecret: async () => { throw new Error('kapot: v'); } } });
        const res = await call(await serve(createProxy({ ...d, log: e => logged.push(e) })));
        expect(res.status).toBe(500);
        const body = await res.text();
        expect(JSON.parse(body).error.rule).toBe('internal-error');
        expect(body).not.toContain('kapot');
        expect(logged.some(e => e.event === 'proxy-error')).toBe(true);
    });

    it('een audit die faalt, wordt gemeld en blokkeert de weigering niet', async () => {
        const logged = [];
        const d = deps({ registry: { findToolByKey: async () => null }, audit: { append: async () => { throw Object.assign(new Error('schijf vol'), { code: 'ENOSPC' }); } } });
        const res = await call(await serve(createProxy({ ...d, log: e => logged.push(e), denyCoalesceMs: 0 })));
        expect(res.status).toBe(401);
        expect(logged).toContainEqual({ event: 'audit-failed', code: 'ENOSPC' });
    });

    it('interne proxy-headers zoals x-vault-gate-protocol verlaten de proxy nooit (hop-by-hop)', async () => {
        let receivedHeaders = null;
        const upstream = http.createServer((req, res) => {
            receivedHeaders = req.headers;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}');
        });
        servers.push(upstream);
        await new Promise(r => upstream.listen(0, '127.0.0.1', r));
        const upUrl = `http://127.0.0.1:${upstream.address().port}`;

        const d = deps({
            registry: {
                findToolByKey: async () => ({ ...tool, kind: 'mcp' }),
                findSecret: async () => ({ id: 'id-s', name: 's', hosts: parseHostRules([upUrl]) }),
                findGrant: async () => ({ id: 'g1', mode: 'silent', expiresAt: null, expired: false }),
                secretValue: async () => 'secret-val',
            },
        });
        const proxyUrl = await serve(createProxy({ ...d }));
        const res = await fetch(`${proxyUrl}/forward/${upUrl}/test`, {
            headers: {
                'x-vault-gate-tool-key': 'ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'x-vault-gate-protocol': 'mcp',
                authorization: 'Bearer {{secret:s}}',
            },
        });
        expect(res.status).toBe(200);
        expect(receivedHeaders['x-vault-gate-protocol']).toBeUndefined();
        expect(receivedHeaders['x-vault-gate-tool-key']).toBeUndefined();
    });

    it('MOET opnieuw vragen: een toekenning zonder einde voor een handmatige key, ouder dan 4 uur (van vóór "Always alleen voor roterende keys"); een roterende key niet', async () => {
        const old = { id: 'g1', mode: 'silent', expiresAt: null, expired: false, createdAt: Date.now() - 5 * 3_600_000 };
        const asked = [];
        const approval = { request: async q => { asked.push(q); return { allow: false, status: 503, rule: 'approval-unavailable' }; } };
        const manual = deps({ registry: { findGrant: async () => old }, approval });
        await call(await serve(createProxy(manual)));
        expect(asked).toEqual([expect.objectContaining({ manualKey: true })]);
        expect(manual.audited.at(-1)).toMatchObject({ rule: 'approval-unavailable' });
        const rotating = deps({ registry: { findGrant: async () => old, findToolByKey: async () => ({ ...tool, rotating: true, via: 'token' }) }, approval });
        await call(await serve(createProxy(rotating)));
        expect(asked).toHaveLength(1); // geen nieuwe vraag: de toekenning geldt
        const fresh = deps({ registry: { findGrant: async () => ({ ...old, createdAt: Date.now() }) }, approval });
        await call(await serve(createProxy(fresh)));
        expect(asked).toHaveLength(1); // een verse toekenning (bv. net gekoppeld) geldt nog
    });

    it('geen toekenning en geen tray: de beslissing van approval wordt de weigering', async () => {
        const d = deps({ registry: { findGrant: async () => null } });
        const res = await call(await serve(createProxy(d)));
        expect(res.status).toBe(503);
        expect(d.audited.at(-1)).toMatchObject({ allow: false, rule: 'approval-unavailable', secret: 's', tool: 'mytool' });
    });

    it('zonder ingestelde routes gelden de standaardroutes (anthropic, openai)', async () => {
        const d = deps({ registry: { findToolByKey: async () => null } });
        const res = await fetch(`${await serve(createProxy(d))}/anthropic/v1/messages`);
        expect(res.headers.get('x-vault-gate-rule')).toBe('no-tool-key'); // route gevonden, tool-key ontbreekt
    });

    it('Given rustige uren When call Then 403 quiet-hours en geen goedkeuringsvraag', async () => {
        const atNight = new Date();
        atNight.setHours(2, 0, 0, 0);
        let asked = false;
        const d = deps({
            registry: { findGrant: async () => null },
            approval: { request: async () => { asked = true; return { allow: true, status: 200, rule: 'approved-once' }; } },
        });
        const res = await call(await serve(createProxy({
            ...d,
            clock: { now: () => atNight.getTime() },
            policyState: () => ({ quietHours: ['23:00-07:00'] }),
        })));
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'quiet-hours']);
        expect(asked).toBe(false);
    });

    it('Given een actieve tool-blokkade When call Then 403 tool-blocked en geen goedkeuringsvraag', async () => {
        const now = Date.now();
        let asked = false;
        const d = deps({
            registry: { findGrant: async () => null },
            approval: { request: async () => { asked = true; return { allow: true, status: 200, rule: 'approved-once' }; } },
        });
        const res = await call(await serve(createProxy({
            ...d,
            clock: { now: () => now },
            policyState: () => ({ blocks: [{ kind: 'tool', toolId: 't', until: now + 60_000 }] }),
        })));
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'tool-blocked']);
        expect(asked).toBe(false);
    });

    it('Given melding-toekenning en globale sluimer When call Then geen tray-melding', async () => {
        const notifications = [];
        const now = Date.now();
        const d = deps({
            registry: { findGrant: async () => ({ id: 'g1', mode: 'notify', expiresAt: null, expired: false }) },
        });
        await call(await serve(createProxy({
            ...d,
            notify: n => notifications.push(n),
            clock: { now: () => now },
            policyState: () => ({ notificationSnooze: { globalUntil: now + 60_000, grants: [] } }),
        })));
        expect(notifications).toEqual([]);
    });

    it('herhaalde identieke weigeringen worden samengevoegd in de audit met een teller', async () => {
        // Een nep-klok: de test laat het venster zelf aflopen, dus de snelheid van de machine speelt geen rol.
        const timers = new Map();
        let nextTimer = 1;
        const clock = {
            now: () => Date.now(),
            setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
            clearTimeout: id => { timers.delete(id); },
        };
        const expire = async () => { const due = [...timers.values()]; timers.clear(); for (const fn of due) fn(); await new Promise(resolve => setImmediate(resolve)); };
        const d = deps({ registry: { findToolByKey: async () => null } });
        const base = await serve(createProxy({ ...d, clock, denyCoalesceMs: 25 }));
        const deny = async () => {
            const res = await call(base);
            expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([401, 'no-tool-key']);
        };
        for (let i = 0; i < 3; i++) await deny();
        await expire();
        const denied = () => d.audited.filter(e => e.rule === 'no-tool-key');
        expect(denied()).toHaveLength(2);
        expect(denied()[0].count ?? 1).toBe(1);
        expect(denied()[1]).toMatchObject({ count: 2, detail: 'coalesced' });
        // MOET: na het venster begint een nieuwe groep, met een eigen eerste regel
        await deny();
        expect(denied()).toHaveLength(3);
        expect(denied()[2].count ?? 1).toBe(1);
    });
});

describe('proxy: hercontrole vóór het ophalen van de waarde', () => {
    /** Een registry die tijdens de beslissing wijzigt: de tweede lookup van de key ziet de ingetrokken tool. */
    function changingRegistry({ bump }) {
        let generation = 0;
        let lookups = 0;
        const values = [];
        return {
            values,
            lookups: () => lookups,
            registry: {
                generation: () => generation,
                findToolByKey: async () => { lookups += 1; if (lookups === 1 && bump) generation += 1; return lookups === 1 ? tool : { ...tool, revoked: true }; },
                secretValue: async id => { values.push(id); return 'v'; },
            },
        };
    }

    it('Given een toekenning When de registry wijzigt tussen beslissen en invullen Then wint de nieuwe beslissing (tool-key-revoked) en wordt er niets opgehaald', async () => {
        const c = changingRegistry({ bump: true });
        const d = deps({ registry: c.registry });
        const res = await call(await serve(createProxy(d)));
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([401, 'tool-key-revoked']);
        expect(c.values).toEqual([]);
        expect(d.audited.some(e => e.allow === true)).toBe(false);
    });

    it('Given een toekenning When niets wijzigt en niets gevraagd werd Then geen hercontrole (één lookup van de key)', async () => {
        const c = changingRegistry({ bump: false });
        const d = deps({ registry: c.registry });
        await call(await serve(createProxy(d)));
        expect(c.lookups()).toBe(1);
        expect(c.values).toEqual(['id-s']);
    });
});

describe('proxy: houdt het portaal niet open', () => {
    const counting = () => { const touched = []; return { touched, vault: { isUnlocked: () => true, touchActivity: () => { touched.push(Date.now()); return true; } } }; };

    it('MOET niet tellen als activiteit: een toegestane request, een onbekende key, en een geldige key die geweigerd wordt', async () => {
        const c = counting();
        expect((await call(await serve(createProxy({ ...deps(), vault: c.vault })))).status).toBe(502); // toegestaan en doorgestuurd (poort 1 antwoordt niet)
        const unknown = deps({ registry: { findToolByKey: async () => null } });
        expect((await call(await serve(createProxy({ ...unknown, vault: c.vault, denyCoalesceMs: 0 })))).status).toBe(401);
        const deniedSecret = deps({ registry: { findSecret: async () => null } });
        expect((await call(await serve(createProxy({ ...deniedSecret, vault: c.vault, denyCoalesceMs: 0 })))).status).toBe(403);
        expect(c.touched).toEqual([]);
    });
});

describe('proxy: device-routes, foutpaden', () => {
    const post = (base, path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    it('te veel aanvragen: 429 too_many_requests; een onverwachte fout: 500 server_error zonder details; kapotte JSON telt als leeg', async () => {
        const logged = [];
        const calls = [];
        const device = {
            request: async ({ clientName }) => { calls.push(clientName); throw Object.assign(new Error('x'), { code: clientName === 'veel' ? 'TOO_MANY_REQUESTS' : 'BOEM' }); },
            poll: async ({ deviceCode }) => ({ status: 400, body: { error: deviceCode ? 'authorization_pending' : 'invalid_grant' } }),
        };
        const base = await serve(createProxy({ ...deps(), device, log: e => logged.push(e) }));
        const many = await post(base, '/device/code', JSON.stringify({ client_name: 'veel' }));
        expect([many.status, await many.json()]).toEqual([429, { error: 'too_many_requests' }]);
        const boom = await post(base, '/device/code', JSON.stringify({ client_name: 'anders' }));
        expect([boom.status, await boom.json()]).toEqual([500, { error: 'server_error' }]);
        expect(logged).toContainEqual({ event: 'device-error', code: 'BOEM' });
        const broken = await post(base, '/device/token', '{kapot');
        expect(await broken.json()).toEqual({ error: 'invalid_grant' });
    });

    it('zonder device-module zijn /device-routes gewone (onbekende) routes', async () => {
        const res = await post(await serve(createProxy(deps())), '/device/code', '{}');
        expect(res.headers.get('x-vault-gate-rule')).toBe('unknown-route');
    });
});

describe('proxy: randen van de ingang', () => {
    it('absolute-form met een ongeldige URL: 400 bad-target; een route zonder pad gaat naar de wortel van de route', async () => {
        const http = await import('node:http');
        const base = await serve(createProxy({ ...deps(), registry: { ...deps().registry, findToolByKey: async () => null } }));
        const { port } = new URL(base);
        const status = await new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: 'http://[ongeldig/x' }, res => { res.resume(); resolve([res.statusCode, res.headers['x-vault-gate-rule']]); });
            req.on('error', reject);
            req.end();
        });
        expect(status).toEqual([400, 'bad-target']);
        const res = await fetch(`${base}/anthropic`);
        expect(res.headers.get('x-vault-gate-rule')).toBe('no-tool-key'); // route gevonden (pad '/'), daarna de beller-regels
    });

    it('MOET weigeren: een te grote body op /device/code (de verbinding wordt verbroken)', async () => {
        const device = { request: async () => ({}), poll: async () => ({ status: 400, body: {} }) };
        const base = await serve(createProxy({ ...deps(), device }));
        await expect(fetch(`${base}/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(10_000) }).then(r => r.status)).rejects.toThrow();
    });
});

describe('proxy: git over HTTPS', () => {
    it('de tool-key in Basic-auth (git credential helper) wordt herkend en vervangen; een 401 vraagt om Basic-auth', async () => {
        const d = deps({ registry: { findToolByKey: async k => (k === 'ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ? tool : null) } });
        const base = await serve(createProxy(d));
        const basic = Buffer.from('x-access-token:ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').toString('base64');
        const res = await fetch(`${base}/forward/http://127.0.0.1:1/x`, { headers: { authorization: `Basic ${basic}`, 'x-token': '{{secret:s}}' } });
        expect(res.headers.get('x-vault-gate-rule')).not.toBe('no-tool-key'); // herkend (daarna faalt de verbinding naar poort 1)
        const anonymous = await fetch(`${base}/forward/http://127.0.0.1:1/x`);
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get('www-authenticate')).toBe('Basic realm="vaultgate"');
    });
});
