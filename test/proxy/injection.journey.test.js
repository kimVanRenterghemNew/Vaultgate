// Injectiebeleid per secret, tegen het echte proces. Een secret dat alleen in `Authorization` mag,
// gaat niet mee in de query of een vrije header naar dezelfde, toegestane host (de uitlaatklep uit de security-audit); een
// secret dat expliciet in `query:key` mag, wel. De doelhost ontvangt bij een weigering niets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const header = fakeSecret('inject-header');
const query = fakeSecret('inject-query');

describe.each(MODES)('injectiebeleid, %s', (mode, start) => {
    let upstream;
    let proc;
    let key;

    beforeAll(async () => {
        upstream = await startUpstream();
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'api', value: header, hosts: [upstream.origin] }); // standaard: alleen Authorization
            await registry.addSecret({ name: 'maps', value: query, hosts: [upstream.origin], inject: ['query:key'] });
            const tool = await registry.addTool({ name: 'mytool' });
            for (const s of ['api', 'maps']) await registry.addGrant({ toolId: tool.id, secretName: s, host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const call = (path, headers = {}) => fetch(`${proc.proxy}/forward/${upstream.origin}${path}`, { method: 'POST', headers: { 'x-vault-gate-tool-key': key, ...headers }, body: '{}' });

    it('op de toegestane plek (Authorization) gaat het secret mee', async () => {
        expect((await call('/x', { authorization: 'Bearer {{secret:api}}' })).status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${header}`);
    });

    it('Given een secret toegestaan in Authorization When `?note={{secret:api}}` naar dezelfde host Then placeholder-location-not-allowed en de doelhost ontvangt niets', async () => {
        const before = upstream.requests.length;
        for (const path of ['/notes?note={{secret:api}}', '/notes?note=%7B%7Bsecret:api%7D%7D']) {
            const res = await call(path, { authorization: 'Bearer {{secret:api}}' });
            expect(res.status).toBe(403);
            expect(res.headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
        }
        expect(upstream.requests.length).toBe(before);
    });

    it('MOET weigeren: een vrije header (x-note) met het secret', async () => {
        const res = await call('/notes', { 'x-note': '{{secret:api}}' });
        expect(res.headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
    });

    it('een secret dat expliciet in query:key mag, gaat daar mee; in een andere parameter niet', async () => {
        expect((await call('/maps?key={{secret:maps}}')).status).toBe(200);
        expect(upstream.requests.at(-1).url).toBe(`/maps?key=${encodeURIComponent(query)}`);
        expect((await call('/maps?other={{secret:maps}}')).headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
        expect(findLeaks({ out: proc.output() }, [header, query, key])).toEqual([]);
    });
});
