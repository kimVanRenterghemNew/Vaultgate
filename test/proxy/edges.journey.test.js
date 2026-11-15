// Randen van de proxy: vergrendelde kluis, onbereikbare doelhost, ongeldig doel, meerdere secrets in één
// request, gecodeerde plaatshouders in de query, redirects binnen een route, set-cookie met de waarde, en een tool-key die
// in een willekeurige header staat (die gaat nooit door).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const a = fakeSecret('a');
const b = fakeSecret('b');
let upstream;
let deadOrigin;
let holder;

beforeAll(async () => {
    upstream = await startUpstream((req, res, rec) => {
        if (req.url.includes('/redirect?to=')) { res.writeHead(301, { location: decodeURIComponent(req.url.split('to=')[1]) }); res.end(); return; }
        if (req.url.includes('/cookie')) { res.writeHead(200, { 'set-cookie': [`k=${a}`, 'x=1'] }); res.end('ok'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: rec.url, headers: rec.headers }));
    });
    // A port that is closed after picking it can be handed to another test's server (then that one answers, e.g. 404).
    // So we keep holding it on 127.0.0.1 for the whole file and aim at 127.0.0.2: same port, nobody listens there.
    holder = net.createServer(socket => socket.destroy()).listen(0, '127.0.0.1');
    await new Promise(r => holder.once('listening', r));
    deadOrigin = `http://127.0.0.2:${holder.address().port}`;
});
afterAll(async () => {
    await upstream?.close();
    if (holder) await new Promise(r => holder.close(r));
});

describe.each(MODES)('randen van de proxy (%s)', (mode, start) => {
    let proc;
    let locked;
    let key;

    beforeAll(async () => {
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            // 9.4: a ook in query k, b in query q (expliciet toegestaan).
            await registry.addSecret({ name: 'a', value: a, hosts: [upstream.origin, deadOrigin], inject: ['header:authorization', 'query:k'] });
            await registry.addSecret({ name: 'b', value: b, hosts: [upstream.origin], inject: ['query:q'] });
            await registry.updateSettings({ routes: [{ name: 'up', base: `${upstream.origin}/v1`, secret: 'a', header: 'x-goog-api-key' }] });
            const tool = await registry.addTool({ name: 'mytool' });
            for (const [s, h] of [['a', upstream.origin], ['b', upstream.origin], ['a', deadOrigin]]) await registry.addGrant({ toolId: tool.id, secretName: s, host: h, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
        locked = await start(home, { unlock: false });
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await locked?.stop();
    });

    const call = (p, headers = {}, base = proc.proxy, signal = undefined) => fetch(`${base}${p}`, { redirect: 'manual', signal, headers: { 'x-vault-gate-tool-key': key, ...headers } });

    it('vergrendelde kluis: geen antwoord voor de goedkeurings-time-out (MOET wachten), zonder de tool-key te kunnen controleren', async () => {
        const controller = new AbortController();
        const res = call(`/forward/${upstream.origin}/x`, { authorization: 'Bearer {{secret:a}}' }, locked.proxy, controller.signal).then(() => 'answered', () => 'aborted');
        const state = await Promise.race([res, new Promise(r => setTimeout(() => r('waiting'), 1500))]);
        controller.abort();
        expect(state).toBe('waiting');
    });

    it('onbereikbare doelhost: 502 upstream-error zonder details over de waarde', async () => {
        const res = await call(`/forward/${deadOrigin}/x?k={{secret:a}}`);
        expect(res.status).toBe(502);
        const body = await res.text();
        expect(JSON.parse(body).error.rule).toBe('upstream-error');
        expect(body).not.toContain(a);
    });

    it('ongeldig doel: 400 bad-target', async () => {
        expect((await call('/forward/geen-url')).headers.get('x-vault-gate-rule')).toBe('bad-target');
        expect((await call('/forward/ftp://x.example/')).headers.get('x-vault-gate-rule')).toBe('bad-target');
    });

    it('twee secrets in één request: beide ingevuld, beide gescrubd; ook een %-gecodeerde plaatshouder in de query', async () => {
        const res = await call(`/forward/${upstream.origin}/multi?q=%7B%7Bsecret:b%7D%7D`, { authorization: 'Bearer {{secret:a}}' });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('granted,granted');
        const received = upstream.requests.at(-1);
        expect(received.headers.authorization).toBe(`Bearer ${a}`);
        expect(received.url).toBe(`/multi?q=${encodeURIComponent(b)}`);
        expect(findLeaks({ body: await res.text() }, [a, b])).toEqual([]);
    });

    it('een client die "//" tot "/" inkort, bereikt toch het juiste doel', async () => {
        const res = await call(`/forward/${upstream.origin.replace('http://', 'http:/')}/kort`, { authorization: 'Bearer {{secret:a}}' });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).url).toBe('/kort');
    });

    it('een redirect binnen een route blijft binnen die route; set-cookie met de waarde wordt gescrubd', async () => {
        const inside = await call(`/up/redirect?to=${encodeURIComponent('/v1/ander')}`);
        expect(inside.status).toBe(301);
        expect(inside.headers.get('location')).toBe(`${proc.proxy}/up/ander`);
        const outside = await call(`/up/redirect?to=${encodeURIComponent('/v2/elders')}`);
        expect(outside.headers.get('location')).toBe(`${proc.proxy}/forward/${upstream.origin}/v2/elders`);
        const cookie = await call('/up/cookie');
        expect(cookie.headers.getSetCookie()).toEqual(['k=***', 'x=1']);
        expect(upstream.requests.at(-1).headers['x-goog-api-key']).toBe(a);
    });

    it('de tool-key gaat nooit door, ook niet in een willekeurige header', async () => {
        await call(`/forward/${upstream.origin}/x`, { authorization: 'Bearer {{secret:a}}', 'x-debug': `mijn key is ${key}` });
        expect(JSON.stringify(upstream.requests.at(-1).headers)).not.toContain(key);
    });

    it('geen lek in de uitvoer', () => {
        expect(findLeaks({ out: proc.output(), locked: locked.output() }, [a, b, key])).toEqual([]);
    });
});
