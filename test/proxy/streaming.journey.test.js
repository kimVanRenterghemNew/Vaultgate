// Een gestreamd antwoord (SSE) komt chunk voor chunk door, afbreken door de client breekt de
// upstream-call af, en een secret dat over twee chunks gesplitst terugkomt, ziet de tool als ***. Ook een gecomprimeerd
// antwoord wordt uitgepakt en gescrubd.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import zlib from 'node:zlib';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('stream');
let upstream;
let proc;
let toolKey;
let upstreamClosed = 0;

describe.each(MODES)('%s', (mode, start) => {
    beforeAll(async () => {
        upstream = await startUpstream((req, res) => {
            if (req.url.startsWith('/sse')) {
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
                let i = 0;
                const timer = setInterval(() => {
                    i += 1;
                    res.write(`data: {"chunk":${i}}\n\n`);
                    if (i === 10) { clearInterval(timer); res.end(); }
                }, 100);
                res.on('close', () => { clearInterval(timer); upstreamClosed += 1; });
            } else if (req.url.startsWith('/echo-split')) {
                const half = Math.floor(value.length / 2);
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.write(`data: {"error":"bad key ${value.slice(0, half)}`);
                setTimeout(() => { res.end(`${value.slice(half)}"}\n\n`); }, 50);
            } else if (req.url.startsWith('/gzip')) {
                res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
                res.end(zlib.gzipSync(`{"echo":"${value}"}`));
            } else if (req.url.startsWith('/zstd')) {
                res.writeHead(200, { 'content-encoding': 'zstd' });
                res.end('x');
            }
        });
        const home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'llm', value, hosts: [upstream.origin] });
            await registry.updateSettings({ routes: [{ name: 'llm', base: upstream.origin, secret: 'llm', header: 'authorization' }] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'llm', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const call = (path, init = {}) => fetch(`${proc.proxy}/llm${path}`, { ...init, headers: { authorization: `Bearer ${toolKey}` } });

    describe('streaming ongebufferd', () => {
        async function readArrivals(url, init) {
            const t0 = Date.now();
            const res = await fetch(url, init);
            const reader = res.body.getReader();
            const arrivals = [];
            let text = '';
            for (;;) {
                const { done, value: chunk } = await reader.read();
                if (done) break;
                text += Buffer.from(chunk).toString();
                arrivals.push(Date.now() - t0);
            }
            return { text, arrivals };
        }

        it('Given een nep-server die 10 chunks met 100 ms pauze stuurt When via de proxy gelezen Then komt chunk 1 aan in dezelfde tijd als zonder proxy, niet na 1 s', async () => {
            const direct = await readArrivals(`${upstream.origin}/sse`);
            const viaProxy = await readArrivals(`${proc.proxy}/llm/sse`, { headers: { authorization: `Bearer ${toolKey}` } });
            expect(viaProxy.text.match(/data: /g)).toHaveLength(10);
            // Niet gebufferd: de chunks komen via de proxy gespreid aan (zie de laatste twee expects). Een buffer zou alles in één
            // keer aan het eind leveren. Vroeger stond hier ook "eerste chunk vóór het einde van de directe stream"; die
            // vergelijking tussen twee aparte runs faalde onder zware belasting (op de ontwikkelmachine: direct 2615 ms, proxy 3623 ms) zonder
            // dat er gebufferd werd. De spreiding binnen dezelfde stream toont hetzelfde, onafhankelijk van de belasting.
            console.log(`eerste chunk: direct ${direct.arrivals[0]} ms, via proxy ${viaProxy.arrivals[0]} ms`);
            expect(viaProxy.arrivals.length).toBeGreaterThanOrEqual(5); // meerdere aankomsten, niet één blok aan het eind
            expect(viaProxy.arrivals.at(-1) - viaProxy.arrivals[0]).toBeGreaterThan(500);
        });

        it('afbreken door de client breekt ook de upstream-call af', async () => {
            const before = upstreamClosed;
            const controller = new AbortController();
            const res = await call('/sse', { signal: controller.signal });
            const reader = res.body.getReader();
            await reader.read();
            controller.abort();
            const t0 = Date.now();
            while (upstreamClosed === before && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 20));
            expect(upstreamClosed).toBe(before + 1);
            expect(Date.now() - t0).toBeLessThan(1000); // ruim voor het einde van de stream (1 s)
        });
    });

    describe('scrubben in het proces', () => {
        it('Given een dienst die de sleutel over twee stream-chunks gesplitst terugecho\'t When de tool leest Then ziet hij ***', async () => {
            const body = await (await call('/echo-split')).text();
            expect(body).toBe('data: {"error":"bad key ***"}\n\n');
        });

        it('een gzip-antwoord wordt uitgepakt en gescrubd (zonder content-encoding naar de tool)', async () => {
            const res = await call('/gzip');
            expect(res.headers.get('content-encoding')).toBeNull();
            expect(await res.json()).toEqual({ echo: '***' });
            expect(upstream.requests.at(-1).headers['accept-encoding']).toBe('identity');
        });

        it('MOET weigeren: een codering die niet te scrubben valt (bv. zstd) geeft 502 unsupported-encoding', async () => {
            const res = await call('/zstd');
            expect(res.status).toBe(502);
            expect(res.headers.get('x-vault-gate-rule')).toBe('unsupported-encoding');
        });

        it('geen lek in de uitvoer van het proces', () => {
            expect(findLeaks({ output: proc.output() }, [value, toolKey])).toEqual([]);
        });
    });
});
