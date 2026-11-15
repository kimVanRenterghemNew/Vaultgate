// Van taal wisselen in Settings: de teksten (ook data-i18n-attributen en wat de code zelf invult) wisselen ter plekke,
// Settings blijft actief, de pagina laadt niet opnieuw en de sessie blijft geldig.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled } from '../helpers/browser.js';

const [, startProcess] = MODES.find(([mode]) => mode === 'proces');

/**
 * Voert `action` uit en faalt als de pagina intussen opnieuw laadde of wegnavigeerde: een `load`-event telt als fout,
 * net als een verdwenen merkteken in het venster.
 */
async function withoutReload(page, action) {
    let loads = 0;
    const onLoad = () => { loads += 1; };
    page.on('load', onLoad);
    await page.evaluate(() => { globalThis.stillSamePage = true; });
    try { await action(); } finally { page.off('load', onLoad); }
    const same = await page.evaluate(() => globalThis.stillSamePage === true);
    if (loads || !same) throw new Error(`page reloaded (${loads} load events)`);
}

describe('portaal: van taal wisselen', () => {
    let proc;
    let b;

    beforeAll(async () => {
        proc = await startProcess(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given Settings When Nederlands gekozen Then blijft Settings actief, staat alles in het Nederlands, zonder herladen', async () => {
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        expect(await b.page.locator('label[for="set-language"]').textContent()).toBe('Language');

        await withoutReload(b.page, async () => {
            await tid(b.page, 'set-language').selectOption('nl');
            await settled(b.page);
        });

        expect(await tid(b.page, 'tab-settings').getAttribute('aria-current')).toBe('page');
        expect(await b.page.locator('#tab-settings').isHidden()).toBe(false);
        expect(await b.page.locator('#tab-audit').isHidden()).toBe(true);
        expect(await b.page.locator('label[for="set-language"]').textContent()).toBe('Taal');
        expect(await tid(b.page, 'logout').getAttribute('aria-label')).toBe('Afmelden');
        expect(await tid(b.page, 'logout').getAttribute('title')).toBe('Meld je af in het portaal.');
        expect(await tid(b.page, 'set-listeners-now').textContent()).toBe('extra luisteradressen: geen');
        expect(await tid(b.page, 'set-language').inputValue()).toBe('nl');
        expect(await b.page.evaluate(() => globalThis.document.documentElement.lang)).toBe('nl');
        // de sessie blijft geldig en de keuze blijft bewaard
        expect((await b.page.evaluate(async () => (await globalThis.portalFetch('/api/settings')).status))).toBe(200);
        expect(await b.page.evaluate(() => globalThis.localStorage.getItem('vaultgate.lang'))).toBe('nl');
        expect(await b.page.evaluate(() => globalThis.document.body.innerText)).not.toContain('Network');
    });

    it('MOET weigeren: een load-event tijdens de keuze telt als fout', async () => {
        await expect(withoutReload(b.page, async () => { await b.page.reload(); await settled(b.page); })).rejects.toThrow(/reloaded/);
    });
});
