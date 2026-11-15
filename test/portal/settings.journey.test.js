// Instellingen zoals de mockup: een keuze bewaart zichzelf, andere machines en routes in een dialoog; een ongeldige
// route wordt geweigerd en verandert niets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';

describe.each(MODES)('portaal: instellingen, %s', (mode, start) => {
    let proc;
    let b;
    const shots = mode === 'proces';
    const settings = () => b.page.evaluate(async () => (await globalThis.portalFetch('/api/settings')).json());

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given Settings When een andere tijd voor auto-vergrendelen gekozen Then is ze meteen bewaard, zonder knop', async () => {
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        expect(await tid(b.page, 'set-autolock').inputValue()).toBe('15');
        expect(await tid(b.page, 'vault-state').textContent()).toContain('Locks in 15 min');
        await tid(b.page, 'set-autolock').selectOption('60');
        await settled(b.page);
        expect((await settings()).autoLockMs).toBe(3_600_000);
        // de afteller in de kopbalk volgt meteen, zonder de pagina te herladen
        expect(await tid(b.page, 'vault-state').textContent()).toContain('Locks in 60 min');
        await tid(b.page, 'set-autolock').selectOption('5');
        await settled(b.page);
        expect((await settings()).autoLockMs).toBe(300_000);
        expect(await tid(b.page, 'vault-state').textContent()).toContain('Locks in 5 min');
        await tid(b.page, 'set-timeout').selectOption('60');
        await settled(b.page);
        expect((await settings()).approvalTimeoutMs).toBe(60_000);
        expect(await tid(b.page, 'set-listeners-now').textContent()).toContain('none');
        // een lijst per groep (ledger), geen lijst + detail
        expect(await b.page.locator('ks-settings section.panel h2').allTextContents()).toEqual(['Vault and approvals', 'Appearance', 'Network', 'Quiet hours and notifications', 'Security', 'Danger zone']);
        expect(await b.page.locator('ks-settings .split').count()).toBe(0);
        // dezelfde link naar de technische specificatie als in het welkom
        expect(await b.page.locator('ks-settings [data-testid="security-specs"]').getAttribute('href')).toBe('https://vaultgate.github.io/Vaultgate/security.html#keys');
        if (shots) await screenshot(b.page, 'portaal-15-settings');
    });

    it('Given Settings When het thema Dark of Light gekozen Then volgt het portaal die keuze, ook na herladen; Same as Windows volgt het systeem weer', async () => {
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        const look = () => b.page.evaluate(() => [globalThis.document.documentElement.dataset.theme ?? '', globalThis.getComputedStyle(globalThis.document.body).backgroundColor]);
        await b.page.emulateMedia({ colorScheme: 'light' });
        expect(await tid(b.page, 'set-theme').inputValue()).toBe('');
        const [, systemLight] = await look();
        await tid(b.page, 'set-theme').selectOption('dracula');
        expect((await look())[0]).toBe('dracula');
        expect((await look())[1]).not.toBe(systemLight); // donker terwijl Windows licht staat
        await b.page.reload(); await tid(b.page, 'view-main').waitFor();
        expect((await look())[0]).toBe('dracula'); // de keuze blijft (per browser, zoals de taal)
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        expect(await tid(b.page, 'set-theme').inputValue()).toBe('dracula');
        await tid(b.page, 'set-theme').selectOption('console-light');
        expect(await look()).toEqual(['console-light', systemLight]);
        await tid(b.page, 'set-theme').selectOption('');
        expect(await look()).toEqual(['', systemLight]); // weer het systeem
        await b.page.emulateMedia({ colorScheme: process.env.KS_COLOR_SCHEME ?? 'dark' });
    });

    it('een route toevoegen in de dialoog; MOET weigeren: een route met een ongeldige naam (er verandert niets)', async () => {
        await tid(b.page, 'set-routes-open').click();
        await tid(b.page, 'set-route-add').click();
        const route = b.page.locator('[data-route]').last();
        await route.locator('[data-part="name"]').fill('Fout Pad');
        await route.locator('[data-part="base"]').fill('http://127.0.0.1:4000');
        await route.locator('[data-part="secret"]').fill('litellm');
        await tid(b.page, 'set-routes-save').click();
        await tid(b.page, 'message').filter({ hasText: 'INVALID_SETTING' }).waitFor();
        expect((await settings()).routes).toEqual([]);
        await route.locator('[data-part="name"]').fill('litellm');
        if (shots) await screenshot(b.page, 'portaal-15b-settings-routes');
        await tid(b.page, 'set-routes-save').click();
        await settled(b.page);
        expect((await settings()).routes).toEqual([{ name: 'litellm', base: 'http://127.0.0.1:4000', secret: 'litellm', header: 'authorization' }]);
        expect(await tid(b.page, 'set-routes-now').textContent()).toContain('/litellm → http://127.0.0.1:4000');
    });
});
