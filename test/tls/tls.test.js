// Hoe de proxy een keten beoordeelt. Alleen de root telt: een andere uitgever (tussencertificaat) onder dezelfde root is
// geen wijziging, een andere root uit de lijst van geldige roots ook niet (een andere certificaatleverancier). Een root
// buiten die lijst is een wijziging (standaard dicht). Welke roots geldig zijn: test/tls/rootStore.test.js.
import { describe, it, expect, vi } from 'vitest';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { chainIdentity, decideChain, CHAIN_RULES, createTlsTrust } from '../../src/tls/index.js';

const cert = (fp, issuer, parent) => {
    const c = { fingerprint256: fp, issuer: { CN: issuer, O: 'org' }, subject: { CN: `cn-${fp}` } };
    c.issuerCertificate = parent ?? c; // een root wijst naar zichzelf
    return c;
};

describe('TLS-vertrouwen en ketenidentiteit', () => {
    it('ketenidentiteit = uitgever van het blad + vingerafdruk van de root', () => {
        const root = cert('ROOT', 'Root CA');
        const inter = cert('INTER', 'Root CA', root);
        const leaf = cert('LEAF', 'Intermediate CA', inter);
        expect(chainIdentity(leaf)).toEqual({ issuer: 'CN=Intermediate CA, O=org', root: 'ROOT' });
        expect(chainIdentity({ issuer: { OU: ['A', 'B'] }, issuerCertificate: null, fingerprint256: 'FP' })).toEqual({ issuer: 'OU=A+B', root: 'FP' });
        expect(chainIdentity({ issuer: null, issuerCertificate: null, fingerprint256: 'FP' })).toEqual({ issuer: '', root: 'FP' });
    });

    it.each([
        ['tls-first-use', null, { issuer: 'X', root: 'R' }, false],
        ['tls-chain-known', { issuer: 'X', root: 'R' }, { issuer: 'X', root: 'R' }, false],
        ['tls-issuer-renewed', { issuer: 'X', root: 'R' }, { issuer: 'ANDERE', root: 'R' }, false],
        ['tls-root-switched', { issuer: 'X', root: 'R' }, { issuer: 'Y', root: 'ANDERE' }, true],
        ['tls-chain-changed', { issuer: 'X', root: 'R' }, { issuer: 'X', root: 'ANDERE' }, false],
    ])('regel %s', (rule, pin, observed, listed) => {
        const d = decideChain({ pin, observed, listed });
        expect(d.rule).toBe(rule);
        expect(d.allow).toBe(rule !== 'tls-chain-changed');
    });

    it('alleen de root telt: een nieuwe uitgever of een andere geldige root wordt onthouden, een bekende keten niet opnieuw', () => {
        expect(decideChain({ pin: { issuer: 'X', root: 'R' }, observed: { issuer: 'Y', root: 'R' }, listed: true }).remember).toBe(true);
        expect(decideChain({ pin: { issuer: 'X', root: 'R' }, observed: { issuer: 'Y', root: 'S' }, listed: true }).remember).toBe(true);
        expect(decideChain({ pin: { issuer: 'X', root: 'R' }, observed: { issuer: 'X', root: 'R' }, listed: true }).remember).toBeUndefined();
    });

    it('MOET weigeren: een andere root die niet in de lijst van geldige roots staat, ook met dezelfde uitgever', () => {
        const d = decideChain({ pin: { issuer: 'X', root: 'R' }, observed: { issuer: 'X', root: 'ONBEKEND' }, listed: false });
        expect(d).toMatchObject({ allow: false, rule: 'tls-chain-changed', status: 502 });
    });

    it('de tabel eindigt met een expliciete standaard', () => {
        expect(CHAIN_RULES.at(-1).name).toBe('tls-chain-changed');
    });
});

describe('createTlsTrust', () => {
    const leaf = (rootFp, issuerCn) => {
        const root = { fingerprint256: rootFp, issuer: { CN: 'root' }, subject: { CN: 'root' } };
        root.issuerCertificate = root;
        return { fingerprint256: 'LEAF', issuer: { CN: issuerCn }, subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost', issuerCertificate: root };
    };
    const setup = ({ failSave = false } = {}) => {
        const pins = new Map();
        const audited = [];
        const logged = [];
        const trust = createTlsTrust({
            registry: { getTlsPin: async o => pins.get(o) ?? null, setTlsPin: async (o, id) => { if (failSave) throw Object.assign(new Error('vol'), { code: 'ENOSPC' }); pins.set(o, id); } },
            audit: { append: async e => { audited.push(e); } }, clock: { now: () => 1 }, log: e => logged.push(e),
        });
        return { trust, pins, audited, logged };
    };
    const url = new URL('https://localhost:8443/x');

    it('een verkeerde hostnaam blijft een fout (standaardcontrole van Node eerst)', () => {
        const { trust } = setup();
        const err = trust.requestOptions(url, null).checkServerIdentity('localhost', { ...leaf('R', 'CA'), subjectaltname: 'DNS:anders.example' });
        expect(err).toBeInstanceOf(Error);
    });

    it('eerste gebruik onthoudt de keten; een mislukte opslag wordt gemeld, de call gaat door', async () => {
        const ok = setup();
        expect(ok.trust.requestOptions(url, null).checkServerIdentity('localhost', leaf('R', 'CA'))).toBeUndefined();
        await new Promise(r => setImmediate(r));
        expect(ok.pins.get(url.origin)).toMatchObject({ issuer: 'CN=CA', root: 'R' });
        const failing = setup({ failSave: true });
        expect(failing.trust.requestOptions(url, null).checkServerIdentity('localhost', leaf('R', 'CA'))).toBeUndefined();
        await new Promise(r => setImmediate(r));
        expect(failing.logged).toContainEqual({ event: 'tls-pin-failed', code: 'ENOSPC' });
    });

    it('een gewijzigde keten: fout, één audit-regel en één melding, ook bij herhaling; vertrouwen legt de nieuwe keten vast', async () => {
        const { trust, pins, audited } = setup();
        const pin = { issuer: 'CN=CA', root: 'R' };
        for (let i = 0; i < 2; i++) expect(trust.requestOptions(url, pin).checkServerIdentity('localhost', leaf('ANDERE', 'Evil CA')).code).toBe('TLS_CHAIN_CHANGED');
        await new Promise(r => setImmediate(r));
        expect(audited.filter(e => e.rule === 'tls-chain-changed')).toHaveLength(1);
        expect(trust.pendingChanges()).toEqual([expect.objectContaining({ origin: url.origin, pinnedIssuer: 'CN=CA', observedIssuer: 'CN=Evil CA', observedRoot: 'ANDERE', observedFingerprint: 'LEAF', since: 1 })]);
        await trust.accept(url.origin);
        expect(pins.get(url.origin)).toMatchObject({ issuer: 'CN=Evil CA', root: 'ANDERE' });
        expect(trust.pendingChanges()).toEqual([]);
        expect(audited.at(-1)).toMatchObject({ mode: 'admin', origin: 'portal', rule: 'tls-chain-accepted', allow: true });
    });

    it('Given een gepinde host When een andere uitgever onder dezelfde root Then geen fout en geen melding; de pin volgt de uitgever', async () => {
        const { trust, pins, audited } = setup();
        expect(trust.requestOptions(url, { issuer: 'CN=R10', root: 'R' }).checkServerIdentity('localhost', leaf('R', 'R11'))).toBeUndefined();
        await new Promise(r => setImmediate(r));
        expect(pins.get(url.origin)).toMatchObject({ issuer: 'CN=R11', root: 'R' });
        expect(trust.pendingChanges()).toEqual([]);
        expect(audited).toEqual([]);
    });

    it('Given een gepinde host When een keten naar een andere geldige root (andere leverancier) Then geen melding, wel een audit-regel', async () => {
        const { trust, pins, audited } = setup();
        const roots = { ca: [], fingerprints: new Set(['ANDERE']) };
        expect(trust.requestOptions(url, { issuer: 'CN=CA', root: 'R' }, null, roots).checkServerIdentity('localhost', leaf('ANDERE', 'Other CA'))).toBeUndefined();
        await new Promise(r => setImmediate(r));
        expect(pins.get(url.origin)).toMatchObject({ issuer: 'CN=Other CA', root: 'ANDERE' });
        expect(trust.pendingChanges()).toEqual([]);
        expect(audited).toEqual([expect.objectContaining({ mode: 'tls', host: url.origin, allow: true, rule: 'tls-root-switched', detail: 'R -> ANDERE' })]);
    });

    it('MOET weigeren: vertrouwen voor een oorsprong zonder openstaande wijziging', async () => {
        const { trust } = setup();
        await expect(trust.accept('https://niets.example')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await trust.pinFor('https://niets.example')).toBeNull();
    });

    it('laadt en cachet een bestaande tls-uitzondering per oorsprong', async () => {
        const calls = [];
        const trust = createTlsTrust({
            registry: {
                getTlsPin: async () => null,
                setTlsPin: async () => {},
                getTlsException: async origin => {
                    calls.push(origin);
                    return { caPem: 'PEM', fingerprint: 'AA', root: 'R', issuer: 'CN=CA' };
                },
            },
            audit: { append: async () => {} },
            clock: { now: () => 1 },
            log: () => {},
        });
        expect(await trust.trustedCaFor('https://x.example')).toEqual({ caPem: 'PEM', fingerprint: 'AA', root: 'R', issuer: 'CN=CA' });
        expect(await trust.trustedCaFor('https://x.example')).toEqual({ caPem: 'PEM', fingerprint: 'AA', root: 'R', issuer: 'CN=CA' });
        expect(calls).toEqual(['https://x.example']);
    });

    it('geen of onvolledige uitzondering geeft geen CA-override terug', async () => {
        const values = new Map([
            ['https://none.example', null],
            ['https://partial.example', { issuer: 'CN=CA', root: 'R' }],
        ]);
        const trust = createTlsTrust({
            registry: { getTlsException: async origin => values.get(origin), getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} }, clock: { now: () => 1 },
        });
        expect(await trust.trustedCaFor('https://none.example')).toBeNull();
        expect(await trust.trustedCaFor('https://partial.example')).toBeNull();
    });

    it('accepteert een expliciet vertrouwde root en gebruikt die alleen voor die oorsprong', async () => {
        const connect = vi.spyOn(tls, 'connect').mockImplementation((opts, onConnect) => {
            const socket = new EventEmitter();
            const root = { fingerprint256: 'ROOT', raw: Buffer.from([1, 2, 3]), subject: { CN: 'root' } };
            root.issuerCertificate = root;
            socket.getPeerCertificate = () => ({
                fingerprint256: 'LEAF', issuer: { CN: 'leaf issuer' },
                issuerCertificate: root,
            });
            socket.end = () => {};
            process.nextTick(onConnect);
            return socket;
        });
        const saved = [];
        const audit = [];
        const trust = createTlsTrust({
            registry: {
                getTlsPin: async () => null, setTlsPin: async () => {},
                getTlsException: async () => null,
                setTlsException: async (origin, value) => saved.push({ origin, value }),
            },
            audit: { append: async entry => audit.push(entry) }, clock: { now: () => 9 },
        });
        const origin = 'https://untrusted.example';
        const url = new URL(`${origin}/path`);
        try {
            await trust.noteUntrusted(url);
            expect(trust.pendingChanges()).toEqual([expect.objectContaining({ origin, kind: 'tls-untrusted', observedRoot: 'ROOT' })]);
            await trust.accept(origin);
            expect(saved).toHaveLength(1);
            expect(trust.pendingChanges()).toEqual([]);
            expect(audit.at(-1)).toMatchObject({ mode: 'admin', origin: 'portal', rule: 'tls-untrusted-accepted', allow: true });
            const override = await trust.trustedCaFor(origin);
            expect(override).toMatchObject({ caPem: expect.stringContaining('BEGIN CERTIFICATE'), fingerprint: 'LEAF' });
            expect(trust.requestOptions(url, null, override)).toMatchObject({ rejectUnauthorized: false, acceptedFingerprint: 'LEAF' });
            await trust.noteUntrusted(url);
            expect(saved).toHaveLength(1);
        } finally {
            connect.mockRestore();
        }
    });

    it('noteUntrusted vangt capture-fouten af en logt ze', async () => {
        const logged = [];
        const trust = createTlsTrust({
            registry: { getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} },
            clock: { now: () => 1 },
            log: e => logged.push(e),
        });
        await trust.noteUntrusted(new URL('https://127.0.0.1:1'));
        expect(logged.some(e => e.event === 'tls-untrusted-capture-failed')).toBe(true);
    });

    it('noteUntrusted logt ook verbindingsfouten zonder platformcode veilig', async () => {
        const connect = vi.spyOn(tls, 'connect').mockImplementation(() => {
            const socket = new EventEmitter();
            process.nextTick(() => socket.emit('error', new Error('handshake failed')));
            return socket;
        });
        const logged = [];
        const trust = createTlsTrust({
            registry: { getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} }, clock: { now: () => 1 }, log: e => logged.push(e),
        });
        try {
            await trust.noteUntrusted(new URL('https://failure.example'));
            expect(logged).toContainEqual({ event: 'tls-untrusted-capture-failed', host: 'https://failure.example', code: 'unknown' });
        } finally {
            connect.mockRestore();
        }
    });

    it('compareRoot geeft unknown terug als een handshake geen peer-certificaat oplevert', async () => {
        const connect = vi.spyOn(tls, 'connect').mockImplementation(() => {
            const socket = new EventEmitter();
            socket.setTimeout = () => {};
            socket.destroy = () => {};
            socket.authorized = true;
            socket.getPeerCertificate = () => null;
            process.nextTick(() => socket.emit('secureConnect'));
            return socket;
        });
        const trust = createTlsTrust({
            registry: { getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} }, clock: { now: () => 1 },
        });
        try {
            expect(await trust.compareRoot(new URL('https://mock.example/'), 'mock.example')).toBe('unknown');
        } finally {
            connect.mockRestore();
        }
    });

    it('blijft bruikbaar met een oudere registry zonder TLS-exception-poorten', async () => {
        const trust = createTlsTrust({
            registry: { getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} }, clock: { now: () => 1 },
        });
        expect(await trust.trustedCaFor('https://legacy.example')).toBeNull();
        await expect(trust.accept('https://legacy.example')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await trust.trustedRoots()).toEqual([]);
        await trust.revoke('https://legacy.example');
    });

    it('trustedCaFor met minimale uitzondering (alleen caPem of fingerprint)', async () => {
        const trust = createTlsTrust({
            registry: {
                getTlsPin: async () => null, setTlsPin: async () => {},
                getTlsException: async o => (o === '*' ? { fingerprint: 'GLOBAL_FP' } : (o === 'https://host.example' ? { caPem: 'HOST_PEM' } : null)),
            },
            audit: { append: async () => {} }, clock: { now: () => 1 },
        });
        const hostTrusted = await trust.trustedCaFor('https://host.example');
        expect(hostTrusted).toMatchObject({ caPem: 'HOST_PEM', fingerprint: null, root: null, issuer: null });
        const globalTrusted = await trust.trustedCaFor('https://other.example');
        expect(globalTrusted).toMatchObject({ caPem: null, fingerprint: 'GLOBAL_FP', root: null, issuer: null });
    });

    it('noteUntrusted volgt een issuerCertificate-keten en publiceert root-fingerprint', async () => {
        const connect = vi.spyOn(tls, 'connect').mockImplementation((opts, onConnect) => {
            const socket = new EventEmitter();
            const root = { fingerprint256: 'ROOT', raw: Buffer.from([1, 2, 3]), issuerCertificate: null, subject: { CN: 'root' } };
            root.issuerCertificate = root;
            const leaf = { fingerprint256: 'LEAF', issuer: { CN: 'leaf issuer' }, valid_from: 'from', valid_to: 'to', issuerCertificate: root };
            socket.getPeerCertificate = () => leaf;
            socket.end = () => {};
            socket.once = socket.on.bind(socket);
            process.nextTick(onConnect);
            return socket;
        });
        const trust = createTlsTrust({
            registry: { getTlsPin: async () => null, setTlsPin: async () => {} },
            audit: { append: async () => {} },
            clock: { now: () => 1 },
            log: () => {},
        });
        try {
            await trust.noteUntrusted(new URL('https://mocked.example:443'));
            expect(trust.pendingChanges()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tls-untrusted', observedRoot: 'ROOT' })]));
        } finally {
            connect.mockRestore();
        }
    });

    it('accepteert een root globaal en ondersteunt intrekken per root en per oorsprong', async () => {
        const connect = vi.spyOn(tls, 'connect').mockImplementation((opts, onConnect) => {
            const socket = new EventEmitter();
            const root = { fingerprint256: 'ROOT_GLOBAL', raw: Buffer.from([1, 2, 3]), subject: { CN: 'global root' } };
            root.issuerCertificate = root;
            socket.getPeerCertificate = () => ({
                fingerprint256: 'LEAF_GLOBAL', issuer: { CN: 'corp proxy' },
                issuerCertificate: root,
            });
            socket.end = () => {};
            process.nextTick(onConnect);
            return socket;
        });
        const saved = new Map();
        const removed = [];
        const audit = [];
        const trust = createTlsTrust({
            registry: {
                getTlsPin: async () => null, setTlsPin: async () => {},
                getTlsException: async o => saved.get(o) ?? null,
                setTlsException: async (o, v) => saved.set(o, v),
                removeTlsException: async o => { removed.push(o); saved.delete(o); },
                listTlsExceptions: async () => [...saved.entries()].map(([origin, v]) => ({ origin, ...v })),
            },
            audit: { append: async entry => audit.push(entry) }, clock: { now: () => 10 },
        });
        const origin = 'https://global.example';
        try {
            await trust.noteUntrusted(new URL(origin));
            await trust.noteUntrusted(new URL(origin));
            await trust.accept(origin, { scope: 'global' });
            expect(await trust.trustedRoots()).toHaveLength(1);
            expect(await trust.trustedCaFor('https://other.example')).toMatchObject({ scope: 'global' });
            expect(await trust.addedRoots()).toBeDefined();

            await trust.revoke('ROOT_GLOBAL');
            expect(removed).toContain('ROOT_GLOBAL');
            await trust.revoke('*');
            expect(removed).toContain('*');
        } finally {
            connect.mockRestore();
        }
    });
});

describe('pin-race (2.10, gevonden door de aanvalsbank 9.16)', () => {
    it('MOET weigeren: twee requests die allebei "geen pin" ophaalden; de eerste handshake pint A, de tweede met keten B wordt geweigerd', async () => {
        const pins = new Map();
        const trust = createTlsTrust({
            registry: { getTlsPin: async o => pins.get(o) ?? null, setTlsPin: async (o, id) => { await new Promise(r => setTimeout(r, 50)); pins.set(o, id); } },
            audit: { append: async () => {} }, clock: { now: () => 1 }, log: () => {},
        });
        const url = new URL('https://localhost:8443/x');
        const leaf = (rootFp, issuerCn) => {
            const root = { fingerprint256: rootFp, issuer: { CN: 'root' }, subject: { CN: 'root' } };
            root.issuerCertificate = root;
            return { fingerprint256: 'LEAF', issuer: { CN: issuerCn }, subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost', issuerCertificate: root };
        };
        const [p1, p2] = await Promise.all([trust.pinFor(url.origin), trust.pinFor(url.origin)]);
        expect(trust.requestOptions(url, p1).checkServerIdentity('localhost', leaf('A', 'CA a'))).toBeUndefined();
        expect(trust.requestOptions(url, p2).checkServerIdentity('localhost', leaf('B', 'CA b'))?.code).toBe('TLS_CHAIN_CHANGED');
        expect(await trust.pinFor(url.origin)).toMatchObject({ issuer: 'CN=CA a', root: 'A' }); // ook vóór de opslag klaar is
    });
});
