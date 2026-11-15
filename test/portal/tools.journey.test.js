// Een tool registreren via "Create key" (dezelfde twee wegen als het welkom), de key één keer zien; een rustige lijst
// met soort, status en sinds; Rotate (nieuwe key in de dialoog, de oude wordt geweigerd); intrekken -> tool-key-revoked;
// het adres van een VM toevoegen in het portaal, waarna een agent op dat adres de proxy mag gebruiken.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { tempHome, MODES, waitForEvent } from '../helpers/journey.js';
import { addGrant, openBrowser, setupPortal, screenshot, tid, settled, answerAsk } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { AA, contrast, inBothThemes } from '../helpers/contrast.js';
import { fixedPort } from '../helpers/fixedPort.js';

const lanIp = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const nl = JSON.parse(fs.readFileSync(new URL('../../i18n/nl.json', import.meta.url), 'utf8'));

/** Een oude key MOET geweigerd worden: onbekend (na Rotate) of ingetrokken. */
const REFUSED = ['no-tool-key', 'tool-key-revoked'];

const row = (page, name) => tid(page, `tool-row-${name}`);

/** Opent "Create key" (een dialoog: een nog open dialoog eerst dicht) en kiest de weg "zelf instellen". */
async function openCreate(page) {
    if (await tid(page, 'tools-create-card').evaluate(d => d.open)) { await page.keyboard.press('Escape'); await settled(page); }
    await tid(page, 'tools-create').click();
}

async function openManual(page) {
    await openCreate(page);
    await tid(page, 'key-way-manual').click();
    await settled(page);
}

describe.each(MODES)('portaal: tools en keys, %s', (mode, start) => {
    const value = fakeSecret('tools');
    let proc;
    let b;
    let upstream;
    let key;
    let firstKey;
    const shots = mode === 'proces';

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        // een secret en een tool, zoals de gebruiker ze aanmaakt
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-name').fill('demo');
        await tid(b.page, 's-value').fill(value);
        await tid(b.page, 's-hosts').fill(upstream.origin);
        await tid(b.page, 's-add').click();
        await b.page.locator('[data-testid^="secret-row-"]').first().waitFor();
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    const call = (k, extra = {}) => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': k, authorization: 'Bearer {{secret:demo}}', ...extra } });

    it('"Create key" biedt dezelfde twee wegen als het welkom: koppelen (standaard) of zelf instellen', async () => {
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        expect(await tid(b.page, 'tools-empty').textContent()).toContain('No virtual keys yet');
        expect(await tid(b.page, 'key-pair').isVisible()).toBe(false);
        await tid(b.page, 'tools-create').click();
        await settled(b.page);
        expect(await tid(b.page, 'key-way-pair').getAttribute('aria-selected')).toBe('true');
        expect(await tid(b.page, 'key-pair').isVisible()).toBe(true);
        expect(await tid(b.page, 'key-pair-command').textContent()).toContain('login --name');
        expect(await tid(b.page, 'device-table').isVisible()).toBe(true);
        if (shots) await screenshot(b.page, 'portaal-8a-tools-create-pair');
        await tid(b.page, 'key-way-manual').click();
        await settled(b.page);
        expect(await tid(b.page, 'key-way-manual').getAttribute('aria-selected')).toBe('true');
        expect(await tid(b.page, 'key-pair').isHidden()).toBe(true);
        expect(await tid(b.page, 't-name').isVisible()).toBe(true);
    });

    it('Create volgt de mockups: genummerde stappen, de naam leeg, en bij MCP geen koppelen maar meteen de key', async () => {
        await openCreate(b.page);
        await settled(b.page);
        expect(await b.page.locator('ks-key-create .step-num').allTextContents()).toEqual(['1', '2', '3']);
        expect(await tid(b.page, 't-name').inputValue()).toBe('');
        expect(await tid(b.page, 't-name').getAttribute('placeholder')).toBe('claude-code');
        await tid(b.page, 'kf-kind-mcp').click();
        await settled(b.page);
        expect(await tid(b.page, 'kf-kind-mcp').getAttribute('aria-checked')).toBe('true');
        expect(await tid(b.page, 'key-way-pair').isHidden()).toBe(true);
        expect(await tid(b.page, 'key-pair').isHidden()).toBe(true);
        expect(await tid(b.page, 't-add').isVisible()).toBe(true);
        if (shots) await screenshot(b.page, 'portaal-8c-tools-create-mcp');
        await tid(b.page, 'kf-kind-web').click();
        await settled(b.page);
        expect(await tid(b.page, 'key-way-pair').isVisible()).toBe(true);
    });

    it('het portaal maakt voor "mytool" een tool-key die één keer getoond wordt', async () => {
        // 4.29: "bij gebruik" en "geldig" horen bij een toekenning, niet bij de key
        expect(await b.page.evaluate(() => globalThis.document.querySelectorAll('ks-key-form select, #kf-on-use, #kf-valid').length)).toBe(0);
        await tid(b.page, 't-name').fill('mytool');
        await tid(b.page, 't-add').click();
        await tid(b.page, 't-key-box').waitFor();
        key = (await tid(b.page, 't-key').textContent()).trim();
        expect(key).toMatch(/^ks_/);
        if (shots) await screenshot(b.page, 'portaal-8-tool-key-eenmalig');
        await b.page.reload();
        await tid(b.page, 'view-main').waitFor();
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await row(b.page, 'mytool').waitFor();
        expect(await b.page.content()).not.toContain(key);
    });

    it('de lijst: naam, soort met icoon en status; rechts sinds wanneer de key gezet is, nooit de key; geen "bij gebruik" of "geldig"', async () => {
        const text = await row(b.page, 'mytool').textContent();
        expect(text).toContain('mytool');
        expect(text).toContain('Web requests');
        expect(text).toContain('active');
        expect(text).not.toMatch(/approval|on use|valid/i);
        await row(b.page, 'mytool').click();
        expect(await row(b.page, 'mytool').getAttribute('aria-selected')).toBe('true');
        const detail = await tid(b.page, 'tool-detail').textContent();
        expect(detail).toMatch(/set on \S.*shown once, never again/);
        expect(detail).not.toContain(key); // de key alleen bij aanmaken, één keer
        expect(await row(b.page, 'mytool').locator('use[href="#i-globe"]').count()).toBeGreaterThan(0);
        if (shots) await screenshot(b.page, 'portaal-9-tools');
    });

    it('een handmatige key: "Manual — doesn\'t rotate" met de uitleg; Edit zet "opnieuw om mijn passkey vragen"', async () => {
        expect(await tid(b.page, 'tool-rotation-mytool').textContent()).toContain("Manual — doesn't rotate");
        expect(await tid(b.page, 'tool-rotation-help-mytool').textContent()).toContain('environment variable');
        expect(nl.portal.keys.manual).toBe('Handmatig — roteert niet');
        if (shots) await screenshot(b.page, 'portaal-9b-tools-handmatig');
        await tid(b.page, 'tool-edit-mytool').click();
        expect(await tid(b.page, 'tool-edit-reask').inputValue()).toBe('0');
        await tid(b.page, 'tool-edit-reask').selectOption(String(8 * 3_600_000));
        await tid(b.page, 'tool-edit-save').click();
        await settled(b.page);
        await tid(b.page, 'tool-edit-dialog').waitFor({ state: 'hidden' });
        await tid(b.page, 'tool-edit-mytool').click();
        expect(await tid(b.page, 'tool-edit-reask').inputValue()).toBe(String(8 * 3_600_000));
        await b.page.keyboard.press('Escape');
        await tid(b.page, 'tool-edit-dialog').waitFor({ state: 'hidden' });
    });

    it('de knop heet Rotate (Engels) en Roteren (Nederlands), niet "New key"', async () => {
        expect((await tid(b.page, 'tool-rotate-mytool').textContent()).trim()).toBe('Rotate');
        expect(await tid(b.page, 'tools-list').textContent()).not.toContain('New key');
        expect(nl.portal.keys.rotate).toBe('Roteren');
    });

    it('met een toekenning werkt de key; Rotate waarschuwt eerst, toont dan een nieuwe key in de dialoog, en de oude MOET geweigerd worden', async () => {
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await addGrant(b.page, { tool: 'mytool', secret: 'demo', host: upstream.origin });
        await b.page.locator('[data-testid^="grant-row-"]').first().waitFor();
        expect((await call(key)).status).toBe(200);
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tool-rotate-mytool').click();
        // 4.47: eerst de vraag, met een oranje waarschuwing dat de oude key meteen stopt
        await tid(b.page, 'ask-warning').waitFor({ state: 'visible' });
        expect(await tid(b.page, 'ask-warning').textContent()).toContain('stops working right away');
        // niet settled(): de handeling wacht hier op het antwoord; alleen de dialoog laten infaden voor de screenshot
        if (shots) { await b.page.waitForTimeout(400); await screenshot(b.page, 'portaal-8d-rotate-warning'); }
        await answerAsk(b.page);
        const dialog = tid(b.page, 'key-dialog');
        await tid(dialog, 't-key-box').waitFor();
        await settled(b.page);
        expect(await b.page.evaluate(() => globalThis.document.querySelector('[data-testid="key-dialog"]').open)).toBe(true);
        const fresh = (await tid(dialog, 't-key').textContent()).trim();
        expect(fresh).toMatch(/^ks_/);
        expect(fresh).not.toBe(key);
        expect(await tid(dialog, 'key-config').textContent()).toContain(fresh);
        await tid(dialog, 'key-done').click();
        await settled(b.page);
        expect(await b.page.content()).not.toContain(fresh);
        const old = await call(key);
        expect(old.status).toBe(401);
        expect(REFUSED).toContain(old.headers.get('x-vault-gate-rule'));
        expect((await call(fresh)).status).toBe(200);
        firstKey = key;
        key = fresh;
    });

    it('na intrekken krijgt een call tool-key-revoked, en de lijst zegt "revoked"', async () => {
        await tid(b.page, 'tool-revoke-mytool').click();
        expect(await tid(b.page, 'ask-question').textContent()).toContain('mytool');
        await answerAsk(b.page, { cancel: true }); // annuleren: key blijft werken
        expect((await call(key)).status).toBe(200);
        await tid(b.page, 'tool-revoke-mytool').click();
        await answerAsk(b.page);
        const res = await call(key);
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('tool-key-revoked');
        expect(await row(b.page, 'mytool').textContent()).toContain('revoked');
        // de zachte foutbadge is leesbaar: minstens 4,5:1 in beide thema's
        const badge = row(b.page, 'mytool').locator('.tag-bad');
        const ratios = await inBothThemes(b.page, () => contrast(badge));
        for (const [theme, ratio] of Object.entries(ratios)) expect(ratio, theme).toBeGreaterThanOrEqual(AA);
    });

    it('Rotate na intrekken: de oude key is onbekend; de nieuwe blijft ingetrokken tot "Heractiveren", daarna werkt ze', async () => {
        await tid(b.page, 'tool-rotate-mytool').click();
        await answerAsk(b.page);
        await tid(b.page, 't-key-box').waitFor();
        await settled(b.page);
        const fresh = (await tid(b.page, 't-key').textContent()).trim();
        expect(fresh).not.toBe(key);
        await tid(b.page, 'key-done').click();
        await settled(b.page);
        expect((await call(key)).headers.get('x-vault-gate-rule')).toBe('no-tool-key');
        expect((await call(fresh)).headers.get('x-vault-gate-rule')).toBe('tool-key-revoked');
        await tid(b.page, 'tool-reactivate-mytool').click();
        await answerAsk(b.page, { cancel: true }); // annuleren: blijft ingetrokken
        expect((await call(fresh)).headers.get('x-vault-gate-rule')).toBe('tool-key-revoked');
        await tid(b.page, 'tool-reactivate-mytool').click();
        expect(await tid(b.page, 'ask-question').textContent()).toContain('mytool');
        await answerAsk(b.page);
        expect(await tid(b.page, 'tool-reactivate-mytool').count()).toBe(0);
        expect((await call(fresh)).status).toBe(200);
        key = fresh;
    });

    it('2.6: na het toevoegen van het adres van de VM in het portaal mag een agent op dat adres; daarvoor client-not-allowed', async () => {
        if (!lanIp) throw new Error('deze test heeft een niet-loopback IPv4-adres nodig');
        const port = await fixedPort([lanIp]);
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        await tid(b.page, 'set-listeners-open').click();
        await tid(b.page, 'set-listeners').fill(`${lanIp}:${port}`);
        await tid(b.page, 'set-listeners-save').click();
        await waitForEvent(proc, 'listening-extra');
        const fromVm = () => new Promise((resolve, reject) => {
            const req = http.request({ host: lanIp, port, localAddress: lanIp, path: `/forward/${upstream.origin}/x`, headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } }, res => { res.resume(); resolve(res.headers['x-vault-gate-rule']); });
            req.on('error', reject);
            req.end();
        });
        expect(await fromVm()).toBe('client-not-allowed');
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        // 4.47: Edit, de toggle "Also from other addresses", het adres, Save
        await tid(b.page, 'tool-edit-mytool').click();
        await tid(b.page, 'tool-edit-other').check();
        await tid(b.page, 'tool-edit-clients').fill(lanIp);
        if (shots) await screenshot(b.page, 'portaal-8e-edit');
        await tid(b.page, 'tool-edit-save').click();
        await settled(b.page);
        expect(await tid(b.page, 'tool-detail').textContent()).toContain(lanIp);
        expect(await fromVm()).toBe('granted');
    }, 30_000);

    let mcpKey;
    it('soort MCP: de stap toont installeren en JSON kopiëren, geen key; na "Got it" staat de key niet meer in de pagina; de lijst toont MCP', async () => {
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await openManual(b.page);
        await tid(b.page, 't-name').fill('mcp-tool');
        await tid(b.page, 'kf-kind-mcp').click();
        await tid(b.page, 't-add').click();
        const dialog = b.page.locator('ks-key-create');
        await tid(dialog, 'mcp-install').waitFor();
        await settled(b.page);
        expect(await b.page.evaluate(() => globalThis.document.querySelector('[data-testid="key-dialog"]').open)).toBe(false);
        mcpKey = (await tid(dialog, 't-key').textContent()).trim();
        expect(mcpKey).toMatch(/^ks_/);
        expect(await tid(dialog, 't-key-box').isVisible()).toBe(false); // de agent krijgt --name, de gebruiker hoeft de key niet
        const config = await tid(dialog, 'key-config').innerText();
        expect(config).toContain('Copy JSON');
        expect(config).not.toContain(mcpKey);
        expect(config).not.toContain('ANTHROPIC_BASE_URL');
        if (shots) await screenshot(b.page, 'portaal-8b-mcp-key');
        await tid(dialog, 'key-done').click();
        await settled(b.page);
        expect(await b.page.content()).not.toContain(mcpKey);
        await row(b.page, 'mcp-tool').waitFor();
        expect(await row(b.page, 'mcp-tool').textContent()).toContain('MCP server');
        expect(await row(b.page, 'mcp-tool').locator('use[href="#i-plug"]').count()).toBeGreaterThan(0);
    });

    it('Edit: hernoemen houdt de key en de soort; een bestaande naam MOET geweigerd worden', async () => {
        await row(b.page, 'mcp-tool').click();
        await tid(b.page, 'tool-edit-mcp-tool').click();
        await tid(b.page, 'tool-edit-name').fill('mytool');
        await tid(b.page, 'tool-edit-save').click();
        await settled(b.page);
        expect(await tid(b.page, 'message').textContent()).toMatch(/already taken/i);
        await tid(b.page, 'tool-edit-name').fill('mcp-renamed');
        await tid(b.page, 'tool-edit-save').click();
        await settled(b.page);
        await row(b.page, 'mcp-renamed').waitFor();
        expect(await row(b.page, 'mcp-renamed').textContent()).toContain('MCP server');
        expect(await row(b.page, 'mcp-tool').count()).toBe(0);
    });

    it('geen key of waarde in de procesuitvoer', () => {
        expect(findLeaks({ out: proc.output() }, [value, firstKey, key, mcpKey])).toEqual([]);
    });
});
