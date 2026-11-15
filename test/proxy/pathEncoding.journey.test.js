// Pad-encoding onder een pad-prefix, met het echte proces: een gecodeerde `/`, `\`, `.` of dubbele encoding in het pad
// geeft 400 bad-target en bereikt de doelserver nooit; een gewoon pad onder het prefix gaat gewoon door.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('repo');
let upstream;

beforeAll(async () => { upstream = await startUpstream(); });
afterAll(() => upstream?.close());

describe.each(MODES)('pad-encoding onder een pad-prefix (%s)', (mode, start) => {
    let proc;
    let key;

    beforeAll(async () => {
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'repo', value, hosts: [`${upstream.origin}/repos/user/`] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'repo', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);
    afterAll(() => proc?.stop());

    const call = path => fetch(`${proc.proxy}/forward/${upstream.origin}${path}`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:repo}}' } });

    it('Given een allowlist /repos/user/ When een request naar /repos/user/..%2fother Then 400 bad-target en de doelserver ziet niets', async () => {
        for (const path of ['/repos/user/..%2fother', '/repos/user/x%5c..%5cother', '/repos/user/..%252fother', '/repos/user/%2e%2e%2fother']) {
            const before = upstream.requests.length;
            const res = await call(path);
            const body = await res.text();
            expect(res.status, path).toBe(400);
            expect(res.headers.get('x-vault-gate-rule'), path).toBe('bad-target');
            expect(body).not.toContain(value);
            expect(upstream.requests.length, path).toBe(before);
        }
    });

    it('een gewoon pad onder het prefix gaat door met het secret', async () => {
        const res = await call('/repos/user/x');
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1)).toMatchObject({ url: '/repos/user/x', headers: { authorization: `Bearer ${value}` } });
    });

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, [value, key].filter(Boolean))).toEqual([]);
    });
});
