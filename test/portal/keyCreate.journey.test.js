// Een key maken bij Virtual keys: een dialoog met de stappen onder elkaar; de key en de configuratie staan volledig in
// hun vak (niets afgekapt), en sluiten wist een getoonde key uit de pagina, net als "Got it".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';

/** Hoeveel pixels inhoud er rechts buiten het vak valt (0: alles past). */
const clipped = locator => locator.evaluate(el => el.scrollWidth - el.clientWidth);

describe.each(MODES)('portaal: een key maken in een dialoog, %s', (mode, start) => {
    let proc;
    let b;
    const shots = mode === 'proces';

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given Virtual keys When Create key Then een dialoog met de stappen onder elkaar en keuzekaarten die niet platgedrukt zijn', async () => {
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        expect(await tid(b.page, 'tools-create-card').evaluate(d => d.tagName === 'DIALOG' && d.open)).toBe(true);
        const widths = await b.page.locator('ks-key-create .choice-card').evaluateAll(cards => cards.filter(c => c.offsetParent).map(c => c.getBoundingClientRect().width));
        expect(widths.length).toBeGreaterThanOrEqual(2);
        for (const w of widths) expect(w).toBeGreaterThanOrEqual(200);
        // de stappen onder elkaar: stap 3 begint onder stap 2, niet ernaast
        const [two, three] = await b.page.locator('ks-key-create .step-num').evaluateAll(n => n.slice(1, 3).map(x => x.getBoundingClientRect()));
        expect(three.top).toBeGreaterThan(two.bottom);
        expect(Math.abs(three.left - two.left)).toBeLessThan(2);
        if (shots) await screenshot(b.page, 'portaal-8a-tools-create-pair');
    });

    it('Given een gemaakte key When de dialoog met Escape sluit Then stond de configuratie volledig in haar vak en staat de key niet meer in de pagina', async () => {
        await tid(b.page, 'key-way-manual').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('dialog-tool');
        await tid(b.page, 't-add').click();
        await tid(b.page, 't-key-box').waitFor();
        const key = (await tid(b.page, 't-key').textContent()).trim();
        expect(key).toMatch(/^ks_/);
        expect(await clipped(tid(b.page, 't-key-box'))).toBeLessThanOrEqual(0);
        expect(await clipped(tid(b.page, 'key-config'))).toBeLessThanOrEqual(0);
        expect(await b.page.locator('ks-key-create .mockup-code').count()).toBe(0); // geen getekend terminalvenster
        if (shots) await screenshot(b.page, 'portaal-8-tool-key-eenmalig');
        await b.page.keyboard.press('Escape');
        await settled(b.page);
        expect(await tid(b.page, 'tools-create-card').evaluate(d => d.open)).toBe(false);
        expect(await b.page.content()).not.toContain(key);
        await tid(b.page, 'tool-row-dialog-tool').waitFor(); // de key bestaat wel: in de lijst
    });
});
