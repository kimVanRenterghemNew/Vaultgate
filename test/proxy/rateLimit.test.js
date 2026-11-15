// Na 5 foute pogingen in 3 min antwoordt de proxy niet meer meteen (tarpit: de verbinding blijft
// open tot de blokkade voorbij is of de tarpit-tijd op is, daarna 429 `throttled`), met één audit-regel en één melding.
// Een tool met een geldige key wordt apart geteld: een lawaaierig proces op dezelfde pc houdt haar niet op.
// In-process (de tarpit-tijd is in de test korter dan in gebruik); het echte HTTP-pad van de proxy.
import { describe, it, expect, afterAll } from 'vitest';
import { tempHome, seedVault, startInProcess } from '../helpers/journey.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret } from '../helpers/secretLeak.js';

const value = fakeSecret('rate');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

async function scenario(prefix = '') {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const home = tempHome();
    const key = await seedVault(home, async ({ registry }) => {
        await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin + prefix] });
        const tool = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
        return tool.key;
    });
    const proc = await startInProcess(home, { throttle: { tarpitMs: 300 } });
    cleanup.push(() => proc.stop());
    const call = (k, secret = 'demo', path = `${prefix || '/'}x`) => fetch(`${proc.proxy}/forward/${upstream.origin}${path}`, { headers: { 'x-vault-gate-tool-key': k, authorization: `Bearer {{secret:${secret}}}` } });
    return { proc, key, call, upstream };
}

describe('vertragen na foute pogingen', () => {
    it('Given 5 verzonnen keys When een 6de Then wacht het antwoord (tarpit) en komt 429 throttled; één audit-regel en één melding', async () => {
        const { proc, call } = await scenario();
        for (let i = 0; i < 5; i++) expect((await call(`ks_verzonnen${i}verzonnenverzonnen12`)).headers.get('x-vault-gate-rule')).toBe('no-tool-key');
        const t0 = Date.now();
        const res = await call('ks_nogeenverzonnenverzonnenverz');
        expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([429, 'throttled']);
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        const audit = await proc.app.audit.read();
        expect(audit.filter(e => e.rule === 'throttled')).toHaveLength(1);
        expect(proc.events.filter(e => e.event === 'throttled')).toHaveLength(1);
    });

    it('een tool met een geldige key gaat gewoon door terwijl verzonnen keys van dezelfde pc vertraagd worden', async () => {
        const { key, call } = await scenario();
        for (let i = 0; i < 6; i++) await call(`ks_verzonnen${i}verzonnenverzonnen12`);
        const res = await call(key);
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([200, 'granted']);
    });

    it('MOET weigeren: een tool die secret-namen aftast wordt zelf vertraagd, ook met een geldige key', async () => {
        const { key, call } = await scenario();
        for (let i = 0; i < 5; i++) expect((await call(key, `gok${i}`)).headers.get('x-vault-gate-rule')).toBe('unknown-secret');
        const res = await call(key);
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([429, 'throttled']);
    });

    it('MOET weigeren: een tool die met gecodeerde paden een pad-prefix aftast wordt vertraagd, en de doelserver ziet niets', async () => {
        const { key, call, upstream } = await scenario('/repos/user/');
        for (let i = 0; i < 5; i++) expect((await call(key, 'demo', `/repos/user/..%2fother${i}`)).headers.get('x-vault-gate-rule')).toBe('bad-target');
        const res = await call(key);
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([429, 'throttled']);
        expect(upstream.requests).toHaveLength(0);
    });

    it('MOET weigeren: een onleesbaar doel telt ook als foute poging (per client-adres)', async () => {
        const { proc, call } = await scenario();
        for (let i = 0; i < 5; i++) {
            const res = await fetch(`${proc.proxy}/forward/http://[kapot${i}`);
            expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([400, 'bad-target']);
        }
        const res = await call('ks_verzonnenverzonnenverzonnen12');
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([429, 'throttled']);
    });

    it('gewone requests onder een pad-prefix tellen niet: na tien geslaagde calls nog steeds doorgelaten', async () => {
        const { key, call } = await scenario('/repos/user/');
        for (let i = 0; i < 10; i++) expect((await call(key)).status).toBe(200);
        const res = await call(key);
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([200, 'granted']);
    });
});
