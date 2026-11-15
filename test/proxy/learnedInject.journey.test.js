// De plek van een secret leren bij het eerste gebruik: een secret zonder plek krijgt de plek van de eerste toegestane
// call; een andere plek daarna wordt geweigerd zonder te ontsleutelen, en de audit zegt welke plek het was.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('learn');

describe.each(MODES)('de plek leren (%s)', (mode, start) => {
    let upstream;
    let proc;
    let key;

    beforeAll(async () => {
        upstream = await startUpstream();
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'x', value, hosts: [upstream.origin], inject: [] }); // nog te leren
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'x', host: upstream.origin, origin: 'portal' });
            await registry.addSecret({ name: 'y', value, hosts: [upstream.origin], inject: [] });
            await registry.addGrant({ toolId: tool.id, secretName: 'y', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const call = headers => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, ...headers } });

    it('Given een nieuw secret zonder plek When de eerste toegestane call met x-api-key Then gaat ze door en is de plek header:x-api-key', async () => {
        const res = await call({ 'x-api-key': '{{secret:x}}' });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers['x-api-key']).toBe(value);
        // daarna mag dezelfde plek gewoon
        expect((await call({ 'x-api-key': '{{secret:x}}' })).status).toBe(200);
    });

    it('MOET weigeren: hetzelfde secret in een andere header, zonder te ontsleutelen; de audit noemt de plek', async () => {
        const before = upstream.requests.length;
        const res = await call({ 'x-forwarded-for': '{{secret:x}}' });
        expect(res.status).toBe(403);
        expect(res.headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
        expect(upstream.requests.length).toBe(before);
        expect(findLeaks({ out: proc.output() }, [value])).toEqual([]);
    });

    it('MOET weigeren: een eerste call met een gereserveerde header (cookie) leert niets; daarna leert een gewone plek wel', async () => {
        const res = await call({ cookie: 'k={{secret:y}}' });
        expect(res.headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
        expect((await call({ authorization: 'Bearer {{secret:y}}' })).status).toBe(200);
        expect((await call({ 'x-api-key': '{{secret:y}}' })).headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed'); // de plek is nu authorization
    });
});
