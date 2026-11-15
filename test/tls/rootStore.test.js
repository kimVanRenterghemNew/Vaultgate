// Welke roots geldig zijn: wat Node meelevert (de Mozilla-lijst), NODE_EXTRA_CA_CERTS, en de systeemstore zoals ze was bij
// de eerste start (een momentopname in de kluis). Een root die daarna in de systeemstore bijkwam, telt niet: een keten naar
// zo'n root wordt al tijdens de handshake geweigerd. Echte TLS-servers met de test-CA's (test/fixtures/tls); de stores van
// Node zijn hier een dubbel, zodat de test niet afhangt van de systeemstore van de pc.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRootStore, createTlsTrust, NODE_STORES } from '../../src/tls/index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tls');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const fp = pem => new X509Certificate(pem).fingerprint256;
const [A, B, C] = ['ca-a.pem', 'ca-b.pem', 'ca-c.pem'].map(read);

const stores = ({ bundled = [], extra = [], system = [] } = {}) => ({ bundled: () => bundled, extra: () => extra, system: () => system });
function snapshotRegistry(initial = null) {
    const state = { snapshot: initial, saves: 0, pins: new Map() };
    return {
        state,
        getRootSnapshot: async () => state.snapshot,
        setRootSnapshot: async list => { state.snapshot = [...list]; state.saves += 1; },
        getTlsPin: async o => state.pins.get(o) ?? null,
        setTlsPin: async (o, id) => { state.pins.set(o, id); },
    };
}

describe('de lijst van geldige roots', () => {
    it('de lijst van Node is wat Node meelevert plus NODE_EXTRA_CA_CERTS, niet "default" (die kan de systeemstore bevatten)', () => {
        expect(NODE_STORES.bundled()).toEqual(tls.getCACertificates('bundled'));
        expect(NODE_STORES.extra()).toEqual(tls.getCACertificates('extra'));
        const store = createRootStore({ registry: snapshotRegistry(), stores: stores({ bundled: [A], extra: [B], system: [C] }), extraCa: [A] });
        expect(store.base.ca).toEqual([A, B]);
        expect(store.base.fingerprints).toEqual(new Set([fp(A), fp(B)]));
    });

    it('Given geen momentopname When de eerste keer geladen Then wordt de systeemstore van nu de momentopname en telt ze mee', async () => {
        const registry = snapshotRegistry();
        const roots = await createRootStore({ registry, stores: stores({ bundled: [A], system: [B] }) }).current();
        expect(registry.state.snapshot).toEqual([fp(B)]);
        expect(roots.ca).toEqual([A, B]);
        expect(roots.fingerprints.has(fp(B))).toBe(true);
        expect(roots.added).toEqual([]);
    });

    it('Given een momentopname When een volgende start met een andere systeemstore Then blijft de eerste momentopname', async () => {
        const registry = snapshotRegistry();
        await createRootStore({ registry, stores: stores({ system: [B] }) }).current();
        await createRootStore({ registry, stores: stores({ system: [B, C] }) }).current();
        expect(registry.state.saves).toBe(1);
        expect(registry.state.snapshot).toEqual([fp(B)]);
    });

    it('Given een momentopname met root B When de systeemstore nu ook root C bevat Then telt C niet en staat ze bij wat er bijkwam', async () => {
        const roots = await createRootStore({ registry: snapshotRegistry([fp(B)]), stores: stores({ bundled: [A], system: [A, B, C] }) }).current();
        expect(roots.ca).toEqual([A, B]);
        expect(roots.fingerprints.has(fp(C))).toBe(false);
        // Een systeemkopie van een root die Node zelf meelevert, is niet "nieuw".
        expect(roots.added).toEqual([{ fingerprint: fp(C), subject: expect.stringContaining('Vaultgate test CA c') }]);
    });

    it('MOET weigeren: een registry zonder momentopname vertrouwt geen enkele systeemroot', async () => {
        const roots = await createRootStore({ registry: {}, stores: stores({ bundled: [A], system: [B] }) }).current();
        expect(roots.ca).toEqual([A]);
        expect(roots.fingerprints.has(fp(B))).toBe(false);
    });

    it('MOET weigeren: wat geen certificaat is, telt niet mee (en breekt de lijst niet)', async () => {
        const store = createRootStore({ registry: snapshotRegistry(), stores: stores({ bundled: [A, 'geen certificaat'], system: ['ook niet'] }) });
        expect(store.base.fingerprints).toEqual(new Set([fp(A)]));
        expect((await store.current()).added).toEqual([]);
    });

    it('een mislukte lading (bv. een vergrendelde kluis) wordt bij de volgende vraag opnieuw geprobeerd', async () => {
        const registry = snapshotRegistry();
        let fail = true;
        const get = registry.getRootSnapshot;
        registry.getRootSnapshot = async () => { if (fail) { fail = false; throw Object.assign(new Error('dicht'), { code: 'VAULT_LOCKED' }); } return get(); };
        const store = createRootStore({ registry, stores: stores({ system: [B] }) });
        await expect(store.current()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
        expect((await store.current()).fingerprints.has(fp(B))).toBe(true);
    });
});

describe('een root die na de momentopname bijkwam, bij een echte handshake', () => {
    const servers = [];
    afterAll(async () => { for (const s of servers) await new Promise(r => { s.closeAllConnections(); s.close(r); }); });

    async function server(leaf) {
        let requests = 0;
        const s = https.createServer({ key: read(`blad-${leaf}.key`), cert: read(`blad-${leaf}.pem`) }, (req, res) => { requests++; res.end('ok'); });
        await new Promise(r => s.listen(0, '127.0.0.1', r));
        servers.push(s);
        return { url: new URL(`https://localhost:${s.address().port}/`), requests: () => requests };
    }

    const get = (url, options) => new Promise(resolve => {
        const req = https.request(url, options, res => { res.resume(); resolve({ status: res.statusCode }); });
        req.on('error', error => resolve({ code: error.code }));
        req.end();
    });

    it('MOET weigeren: een keten naar root C (na de momentopname in de systeemstore) faalt bij de handshake; root B uit de momentopname werkt', async () => {
        const trust = createTlsTrust({ registry: snapshotRegistry([fp(B)]), audit: { append: async () => {} }, clock: { now: () => 0 }, stores: stores({ system: [B, C] }) });
        const roots = await trust.roots();
        const c = await server('c');
        expect(await get(c.url, trust.requestOptions(c.url, null, null, roots))).toEqual({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
        expect(c.requests()).toBe(0);
        const b = await server('b');
        expect(await get(b.url, trust.requestOptions(b.url, null, null, roots))).toEqual({ status: 200 });
        expect(await trust.addedRoots()).toEqual([expect.objectContaining({ fingerprint: fp(C) })]);
    });
});
