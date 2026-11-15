// Man-in-the-middle en spoofing. Echte HTTPS-doelservers met eigen test-CA's (test/fixtures/tls). Alleen de root telt:
// een vernieuwd blad of een ander tussencertificaat onder dezelfde root gaat door zonder melding, net als een andere
// leverancier met een root uit de lijst van geldige roots (CA a en b, via NODE_EXTRA_CA_CERTS). Een keten naar een root
// buiten die lijst (CA c, een "onderschepper") wordt al tijdens de handshake geweigerd, zodat er geen byte (dus geen secret)
// vertrekt: tls-untrusted, met een melding in het portaal; na "vertrouwen" gaat de call weer door.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome, seedVault, MODES, PASSPHRASE } from '../helpers/journey.js';
import { createApp } from '../../src/composition.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { openBrowser, tid, settled } from '../helpers/browser.js';
import { portalClient } from '../helpers/portalClient.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tls');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const LEAF = name => ({ key: read(`blad-${name}.key`), cert: read(`blad-${name}.pem`) });
const value = fakeSecret('tls');

async function httpsUpstream(leaf) {
    const requests = [];
    const server = https.createServer(LEAF(leaf), (req, res) => { requests.push({ url: req.url, authorization: req.headers.authorization }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { server, requests, origin: `https://localhost:${server.address().port}`, use: name => server.setSecureContext(LEAF(name)), close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

/**
 * Een portaalsessie in een kluis zonder passkey: ontgrendelen met de passphrase geeft een sessie; een keten vertrouwen
 * vraagt een aanraking, dus eerst een software-passkey als eerste passkey.
 */
async function portalSession(portal, { withKey = true } = {}) {
    const client = portalClient(portal);
    await client.raw('POST', '/api/unlock', { passphrase: PASSPHRASE });
    if (withKey) await client.addKey();
    return client;
}

describe.each(MODES)('certificaatketens, %s', (mode, start) => {
    let upstream;
    let proc;
    let key;
    const caFile = path.join(process.env.VAULTGATE_HOME, `test-cas-${mode}.pem`);

    beforeAll(async () => {
        fs.writeFileSync(caFile, `${read('ca-a.pem')}\n${read('ca-b.pem')}`);
        upstream = await httpsUpstream('a');
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        // Proces: de test-CA's via NODE_EXTRA_CA_CERTS; in-process via de optie tlsExtraCa.
        proc = mode === 'proces'
            ? await start(home, { env: { NODE_EXTRA_CA_CERTS: caFile } })
            : await startInProcessWithCas(home, [read('ca-a.pem'), read('ca-b.pem')]);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });

    it('eerste gebruik: de keten wordt onthouden en de call slaagt', async () => {
        const res = await call();
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).authorization).toBe(`Bearer ${value}`);
    });

    it('een vernieuwd blad bij dezelfde CA gaat door, zonder melding', async () => {
        upstream.use('a2');
        expect((await call()).status).toBe(200);
    });

    it('Given een gepinde host When het tussencertificaat wisselt onder dezelfde root Then gaat de call door zonder melding', async () => {
        upstream.use('t1');
        expect((await call()).status).toBe(200);
        upstream.use('t2');
        expect((await call()).status).toBe(200);
        expect(upstream.requests.at(-1).authorization).toBe(`Bearer ${value}`);
        expect(await pending(proc.portal)).toEqual([]);
    });

    it('Given een gepinde host When een blad van een andere leverancier met een geldige root Then gaat de call door zonder melding', async () => {
        upstream.use('b');
        expect((await call()).status).toBe(200);
        expect(await pending(proc.portal)).toEqual([]);
    });

    it('MOET weigeren: een keten naar een root buiten de lijst (onderschepper): geen secret, regel tls-untrusted, melding in het portaal', async () => {
        upstream.use('c');
        const before = upstream.requests.length;
        const res = await call();
        expect(res.status).toBe(502);
        expect(res.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
        expect(upstream.requests.length).toBe(before); // er kwam niets aan: geweigerd tijdens de handshake
        await expect.poll(() => pending(proc.portal)).toMatchObject([{ origin: upstream.origin, kind: 'tls-untrusted', observedIssuer: expect.stringContaining('test CA c') }]);
        // Wat de gebruiker ziet: een melding "Certificate not trusted" met eerder/nu naast elkaar, niet vertrouwen voorop.
        const b = await openBrowser();
        try {
            await b.page.goto(proc.portal);
            await tid(b.page, 'bootstrap-pass').fill(PASSPHRASE);
            await tid(b.page, 'bootstrap-go').click();
            await tid(b.page, 'tls-box').waitFor();
            expect(await tid(b.page, 'tls-box').textContent()).toContain(`Certificate not trusted for ${upstream.origin}`);

            // Eerder en nu naast elkaar met uitgever, root, geldig tot en vingerafdruk
            expect(await tid(b.page, 'tls-col-before').isVisible()).toBe(true);
            expect(await tid(b.page, 'tls-col-now').isVisible()).toBe(true);

            // Binnen 1,5 s is de vertrouwknop uitgeschakeld en doet klikken niets
            const acceptBtn = b.page.locator('[data-action="accept"]');
            expect(await acceptBtn.getAttribute('disabled')).not.toBeNull();
            await acceptBtn.click({ force: true });
            expect(await pending(proc.portal)).toHaveLength(1);

            await b.page.evaluate(() => {
                globalThis.localStorage.setItem('vaultgate.setupGuideDismissed', '1');
                globalThis.localStorage.setItem('vaultgate.tls-intro-seen', '1');
            });

            // "Niet vertrouwen (aanbevolen)" is de standaardknop en verbergt de melding
            const untrustBtn = b.page.locator('[data-action="untrust"]');
            await untrustBtn.click();
            await expect.poll(async () => tid(b.page, 'tls-box').isVisible()).toBe(false);

            // Op Certificates staat de keten zelf (lijst + detail); de melding bovenaan zou ze daar dubbel tonen
            await tid(b.page, 'tab-tls').click();
            await settled(b.page);
            expect(await b.page.locator('[data-testid="tls-broken-row"]').count()).toBe(1);
            expect(await tid(b.page, 'tls-box').isVisible()).toBe(false);

            // Toolaanroep blijft geweigerd (MOET weigeren: geen secret gelekt)
            const retryRes = await call();
            expect(retryRes.status).toBe(502);
            expect(retryRes.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
        } finally {
            await b.close();
        }
    }, 60_000);

    it('na "vertrouwen" in het portaal gaat de call weer door', async () => {
        const s = await portalSession(proc.portal);
        const accept = await s.call('POST', '/api/tls/accept', { origin: upstream.origin });
        expect(accept.status).toBe(200);
        expect((await call()).status).toBe(200);
        expect(findLeaks({ out: proc.output() }, [value, key])).toEqual([]);
    });
});

async function pending(portal) {
    const s = await portalSession(portal, { withKey: false }); // alleen lezen
    return (await s.raw('GET', '/api/tls')).data;
}

async function startInProcessWithCas(home, cas) {
    const events = [];
    let output = '';
    const app = createApp({ home, proxyPort: 0, portalPort: 0, tray: 'none', window: 'none', tlsExtraCa: cas, log: e => { events.push(e); output += `${JSON.stringify(e)}\n`; } });
    const ports = await app.start();
    await app.unlockWithPassphrase(PASSPHRASE);
    return { events, proxy: `http://127.0.0.1:${ports.proxyPort}`, portal: `http://localhost:${ports.portalPort}`, output: () => output, stop: () => app.stop() };
}

describe('een CA die niemand vertrouwt', () => {
    it('geeft tls-untrusted (geen secret mee)', async () => {
        const upstream = await httpsUpstream('b');
        const home = tempHome();
        const key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        const p = await startInProcessWithCas(home, [read('ca-a.pem')]); // alleen CA a; de doelhost gebruikt CA b
        try {
            const res = await fetch(`${p.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
            expect(res.status).toBe(502);
            expect(res.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
            expect(upstream.requests).toHaveLength(0);

            const s = await portalSession(p.portal);
            const { data: pending } = await s.raw('GET', '/api/tls');
            expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({ origin: upstream.origin })]));

            const accept = await s.call('POST', '/api/tls/accept', { origin: upstream.origin });
            expect(accept.status).toBe(200);
            const after = await fetch(`${p.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
            expect(after.status).toBe(200);
        } finally {
            await p.stop();
            await upstream.close();
        }
    });
});
