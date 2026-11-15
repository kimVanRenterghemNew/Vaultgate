// Het tabblad Certificates in het beheerportaal. Vertrouwde roots, gebroken ketens,
// intro-popup met inspectiewaarschuwing bij eerste bezoek, scopekeuze en intrekken.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled, screenshot } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tls');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const LEAF = name => ({ key: read(`blad-${name}.key`), cert: read(`blad-${name}.pem`) });

async function httpsUpstream(leaf) {
    const requests = [];
    const server = https.createServer(LEAF(leaf), (req, res) => {
        requests.push({ url: req.url, authorization: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return {
        server,
        requests,
        origin: `https://localhost:${server.address().port}`,
        use: name => server.setSecureContext(LEAF(name)),
        close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
    };
}

describe.each(MODES)('portaal: certificaten (4.38 & 9.19), %s', (mode, start) => {
    let proc;
    let b;
    let upstream;
    let key;
    const shots = mode === 'proces';
    const caFile = path.join(process.env.VAULTGATE_HOME || tempHome(), `cas-portal-${mode}.pem`);

    beforeAll(async () => {
        fs.writeFileSync(caFile, read('ca-a.pem')); // Alleen CA a is vertrouwd; upstream gebruikt CA c (onderschepper)
        upstream = await httpsUpstream('c');
        const home = tempHome();
        proc = await start(home, {
            unlock: false,
            env: { NODE_EXTRA_CA_CERTS: caFile },
        });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);

        // Voeg secret, tool en toekenning toe via portal
        key = await b.page.evaluate(async origin => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'demo', value: 'FAKE-tls-val-1234567890', hosts: [origin] }) });
            const tool = await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'tls-tool' }) })).json();
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'demo', host: origin, durationMs: 3600000 }) });
            return tool.key;
        }, upstream.origin);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
        try { fs.unlinkSync(caFile); } catch { /* ignore */ }
    });

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/test`, {
        headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' },
    });

    it('Given een proxy call met een onbekende root When uitgevoerd Then weigert de proxy (tls-untrusted) en toont het menu een wachtteller bij Certificates', async () => {
        const res = await call();
        expect(res.status).toBe(502);
        expect(res.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
        expect(upstream.requests).toHaveLength(0);

        // Herlaad de portaalstatus tot de keten genoteerd is: de proxy noteert ze pas na zijn antwoord (niet wachtend)
        const wait = tid(b.page, 'menu-wait-tls');
        await expect.poll(async () => {
            await b.page.evaluate(async () => { await globalThis.document.getElementById('view-main')?.load?.(); });
            await settled(b.page);
            return wait.textContent();
        }).toBe('1');
        expect(await tid(b.page, 'tab-tls').isVisible()).toBe(true);
    });

    it('Given eerste bezoek aan tab Certificates When geopend Then toont het intro-dialoog met inspectiewaarschuwing', async () => {
        await tid(b.page, 'tab-tls').click();
        await settled(b.page);

        const introDialog = tid(b.page, 'tls-intro-dialog');
        expect(await introDialog.evaluate(d => d.open)).toBe(true);
        expect(await introDialog.textContent()).toContain('Inspection warning');
        if (shots) await screenshot(b.page, 'portaal-15c-certificaat-intro-dialog');

        // Sluiten met "I understand"
        await introDialog.locator('[data-action="close-intro"]').click();
        await settled(b.page);
        expect(await introDialog.evaluate(d => d.open)).toBe(false);
    });

    it('Given een gebroken keten When Review & trust gekozen Then toont het dialoog de scopekeuze en vertrouwen met touch laat de call slagen', async () => {
        // Gebroken keten staat op het scherm
        const brokenCard = b.page.locator('[data-testid="tls-broken-row"]');
        expect(await brokenCard.isVisible()).toBe(true);
        expect(await brokenCard.textContent()).toContain(new URL(upstream.origin).host); // het domein zoals de gebruiker het kent
        if (shots) await screenshot(b.page, 'portaal-15-certificaat-niet-vertrouwd');

        // De keten staat gekozen; rechts eerder/nu en de knop om te vergelijken en te beslissen
        expect(await brokenCard.getAttribute('aria-selected')).toBe('true');
        expect(await tid(b.page, 'tls-detail').textContent()).toContain('a root you do not trust');
        await tid(b.page, 'tls-review-trust').click();
        await settled(b.page);

        const trustDialog = tid(b.page, 'tls-trust-dialog');
        expect(await trustDialog.evaluate(d => d.open)).toBe(true);
        expect(await trustDialog.textContent()).toContain('Inspection warning');

        // Scope keuze: selecteer "all domains"
        await trustDialog.locator('input[value="global"]').check();
        if (shots) await screenshot(b.page, 'portaal-15b-certificaat-trust-dialog');

        // Vertrouw met aanraking (stap-up via virtuele passkey)
        const trustBtn = trustDialog.locator('[data-action="trust-touch"]');
        await trustBtn.click();
        await settled(b.page);
        expect(await trustDialog.evaluate(d => d.open)).toBe(false);

        // Request slaagt nu
        const res = await call();
        expect(res.status).toBe(200);
        expect(upstream.requests).toHaveLength(1);

        // Vertrouwde root staat nu in "Trusted by you"
        const trustedRow = b.page.locator('[data-testid="tls-trusted-row"]');
        expect(await trustedRow.isVisible()).toBe(true);
        expect(await trustedRow.textContent()).toContain('all domains');
    });

    it('Given een vertrouwde root When Revoke trust gekozen Then wordt het certificaat weer geblokkeerd (MOET weigeren)', async () => {
        const revokeBtn = b.page.locator('[data-action="revoke-trust"]').first();
        await revokeBtn.click();
        await settled(b.page);

        // Bevestig intrekken in untrust-dialoog
        const untrustDialog = tid(b.page, 'tls-untrust-dialog');
        expect(await untrustDialog.evaluate(d => d.open)).toBe(true);
        await untrustDialog.locator('[data-action="confirm-untrust"]').click();
        await settled(b.page);
        expect(await untrustDialog.evaluate(d => d.open)).toBe(false);

        // Call moet nu weer geweigerd worden met tls-untrusted
        const res = await call();
        expect(res.status).toBe(502);
        expect(res.headers.get('x-vault-gate-rule')).toBe('tls-untrusted');
    });

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, ['FAKE-tls-val-1234567890', key].filter(Boolean))).toEqual([]);
    });
});
