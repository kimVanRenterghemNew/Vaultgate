// De certificaat-root van een nieuw subdomein vergelijken met die van het toegestane domein: alleen een handshake, geen
// request. Echte HTTPS-servers met de test-CA's (test/fixtures/tls).
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTlsTrust } from '../../src/tls/index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tls');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const servers = [];
afterAll(async () => { for (const s of servers) await new Promise(r => { s.closeAllConnections(); s.close(r); }); });

async function server(leaf) {
    let requests = 0;
    const s = https.createServer({ key: read(`blad-${leaf}.key`), cert: read(`blad-${leaf}.pem`) }, (req, res) => { requests++; res.end('ok'); });
    await new Promise(r => s.listen(0, '127.0.0.1', r));
    servers.push(s);
    return { url: new URL(`https://localhost:${s.address().port}/`), requests: () => requests };
}

const trust = (pin = null, extraCa = [read('ca-a.pem'), read('ca-b.pem')]) => createTlsTrust({ registry: { getTlsPin: async () => pin, setTlsPin: async () => {} }, audit: { append: async () => {} }, clock: { now: () => 0 }, extraCa });

describe('certificaat-root vergelijken', () => {
    it('Given hetzelfde domein zonder pin When vergeleken Then same, en er ging geen request naar de server', async () => {
        const a = await server('a');
        expect(await trust().compareRoot(a.url, 'localhost')).toBe('same');
        expect(a.requests()).toBe(0);
    });

    it('Given een pin met een andere root When vergeleken Then different', async () => {
        const a = await server('a');
        expect(await trust({ root: 'AA:BB', issuer: 'x' }).compareRoot(a.url, 'localhost')).toBe('different');
    });

    it('MOET unknown geven: een keten naar een root die niemand vertrouwt, of geen https', async () => {
        const b = await server('b');
        expect(await trust(null, [read('ca-a.pem')]).compareRoot(b.url, 'localhost')).toBe('unknown');
        expect(await trust().compareRoot(new URL('http://localhost:1/'), 'localhost')).toBe('unknown');
    });

});
