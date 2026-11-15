// Eerst de keten, dan pas de waarde: de proxy maakt de TLS-verbinding (keten en root gecontroleerd) vóór hij een secret
// ontsleutelt. Een keten naar een root buiten de lijst van geldige roots wordt geweigerd zonder dat er iets ontsleuteld
// wordt. Module: de proxy met een echte TLS-controle en echte HTTPS-doelservers (test/fixtures/tls); de kluis is een dubbel
// die telt hoe vaak er ontsleuteld wordt.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy } from '../../src/proxy/index.js';
import { createTlsTrust } from '../../src/tls/index.js';
import { parseHostRules } from '../../src/policy/index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tls');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const VALUE = 'nep-secret-tls-voor-ontsleutelen';
const KEY = 'ks_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const closers = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

async function listen(server) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise(r => { server.closeAllConnections?.(); server.close(r); }));
    return server.address().port;
}

async function setup(leaf) {
    const received = [];
    const upstream = https.createServer({ key: read(`blad-${leaf}.key`), cert: read(`blad-${leaf}.pem`) }, (req, res) => { received.push(req.headers.authorization); res.end('{}'); });
    const origin = `https://localhost:${await listen(upstream)}`;
    const state = { decrypted: 0, audited: [] };
    const registry = {
        findToolByKey: async () => ({ id: 't', name: 'mytool', revoked: false, clients: [] }),
        findSecret: async name => ({ id: `id-${name}`, name, hosts: parseHostRules([origin]) }),
        findGrant: async () => ({ id: 'g1', mode: 'silent', expiresAt: null, expired: false }),
        secretValue: async () => { state.decrypted += 1; return VALUE; },
        getTlsPin: async () => null,
        setTlsPin: async () => {},
    };
    const audit = { append: async entry => { state.audited.push(entry); } };
    // Alleen CA a is geldig; de systeemstore van de pc telt hier niet mee.
    const tlsTrust = createTlsTrust({ registry, audit, clock: { now: () => 0 }, extraCa: [read('ca-a.pem')], stores: { bundled: () => [], extra: () => [], system: () => [] } });
    const proxy = createProxy({ vault: { isUnlocked: () => true }, registry, audit, approval: {}, tlsTrust, newRequestId: () => 'r1' });
    const base = `http://127.0.0.1:${await listen(http.createServer((req, res) => proxy.handle(req, res)))}`;
    const call = () => fetch(`${base}/forward/${origin}/x`, { headers: { 'x-vault-gate-tool-key': KEY, authorization: 'Bearer {{secret:s}}' } });
    return { state, received, call };
}

describe('TLS vóór ontsleutelen', () => {
    it('Given een keten met een onbekende root When een call Then weigert de proxy (tls-untrusted) zonder te ontsleutelen', async () => {
        const { state, received, call } = await setup('c');
        const res = await call();
        expect(res.status).toBe(502);
        expect(res.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
        expect(state.decrypted).toBe(0);
        expect(received).toEqual([]);
        expect(state.audited).toContainEqual(expect.objectContaining({ allow: false, rule: 'tls-untrusted', status: 502 }));
        expect(JSON.stringify(state.audited)).not.toContain(VALUE);
    });

    it('Given een keten met een tussencertificaat onder een geldige root When een call Then ontsleutelt de proxy één keer en gaat de waarde mee', async () => {
        const { state, received, call } = await setup('t1');
        const res = await call();
        expect(res.status).toBe(200);
        expect(state.decrypted).toBe(1);
        expect(received).toEqual([`Bearer ${VALUE}`]);
    });
});
