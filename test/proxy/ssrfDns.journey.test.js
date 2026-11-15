// SSRF-bescherming tegen verboden adressen (cloud metadata 169.254.169.254, link-local, onbedoelde loopback).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const demoVal = fakeSecret('demo');
const metaVal = fakeSecret('meta');
let upstream;

beforeAll(async () => {
    upstream = await startUpstream((req, res, record) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: record.url, ok: true }));
    });
});
afterAll(() => upstream?.close());

describe.each(MODES)('SSRF pre-connect validatie (%s)', (mode, start) => {
    let proc;
    let toolKey;

    beforeAll(async () => {
        const home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value: demoVal, hosts: [upstream.origin] });
            await registry.addSecret({ name: 'meta', value: metaVal, hosts: ['http://169.254.169.254'] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            await registry.addGrant({ toolId: tool.id, secretName: 'meta', host: 'http://169.254.169.254', origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);
    afterAll(() => proc?.stop());

    const forward = (url, headers = {}) => fetch(`${proc.proxy}/forward/${url}`, {
        headers: { 'x-vault-gate-tool-key': toolKey, ...headers },
    });

    it('Given een secret gericht op cloud-metadata 169.254.169.254 When aangeroepen Then 403 ssrf-target-blocked', async () => {
        const res = await forward('http://169.254.169.254/latest/meta-data', { authorization: 'Bearer {{secret:meta}}' });
        expect(res.status).toBe(403);
        expect(res.headers.get('x-vault-gate-rule')).toBe('ssrf-target-blocked');
        const body = await res.text();
        expect(body).not.toContain(metaVal);
        expect(findLeaks({ body }, [metaVal])).toEqual([]);
    });

    it('Given een legitieme expliciet toegestane doelhost (loopback testserver) When aangeroepen Then gaat het verzoek gewoon door (200 OK)', async () => {
        const res = await forward(`${upstream.origin}/test`, { authorization: 'Bearer {{secret:demo}}' });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
        const json = await res.json();
        expect(json.ok).toBe(true);
    });
});
