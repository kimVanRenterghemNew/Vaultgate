// De kopbalk volgens de mockups: Ã©Ã©n menu (ks-menu) links naast het logo, in de volgorde van de mockups, met
// "Authentication"; rechts, na een lijn, de sessie apart: de afteller als tekst met een klok, Lock omlijnd en een
// Log out-icoon. Zonder open kluis geen menu.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';

describe.each(MODES)('portaal: kopbalk en menu, %s', (mode, start) => {
    let proc;
    let b;
    const shots = mode === 'proces';

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        await settled(b.page);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given een open portaal Then staat het menu in de kopbalk, in de volgorde van de mockups', async () => {
        const items = b.page.locator('ks-header ks-menu [data-tab]');
        expect(await items.allTextContents()).toEqual(['Activity', 'Virtual keys', 'Secrets', 'Grants', 'Certificates', 'Authentication', 'Settings']);
        expect(await b.page.locator('ks-main [data-testid^="tab-"]').count()).toBe(0);
        if (shots) await screenshot(b.page, 'portal-header');
    });

    it('When de gebruiker een menu-item kiest Then toont het portaal dat scherm en markeert het het item', async () => {
        await tid(b.page, 'tab-secrets').click();
        await settled(b.page);
        expect(await tid(b.page, 'tab-secrets').getAttribute('aria-current')).toBe('page');
        expect(await tid(b.page, 'tab-audit').getAttribute('aria-current')).toBeNull();
        expect(await b.page.locator('#tab-secrets').isVisible()).toBe(true);
        expect(await b.page.locator('#tab-audit').isVisible()).toBe(false);
    });

    it('rechts: de afteller met uitleg, Lock, en Log out als icoon met een naam', async () => {
        const tip = await tid(b.page, 'vault-state').getAttribute('data-tip');
        expect(tip).toContain('Settings'); // de tijd is instelbaar, geen vaste 15 minuten meer
        expect(tip).toContain('keep working'); // vergrendelen is alleen het portaal
        expect(await tid(b.page, 'vault-state').textContent()).toMatch(/Locks in \d+ min/);
        expect(await tid(b.page, 'lock').isVisible()).toBe(true);
        expect(await tid(b.page, 'logout').getAttribute('aria-label')).toBe('Log out');
        // alles in de kopbalk past in het portaalvenster: niets valt rechts weg
        const width = await b.page.evaluate(() => globalThis.document.documentElement.clientWidth);
        expect((await tid(b.page, 'logout').boundingBox()).x + 32).toBeLessThanOrEqual(width);
        expect(await tid(b.page, 'logout').isVisible()).toBe(true);
    });

    it('Given een open portaal When de kopbalk getekend is Then staan timer, Lock en uitloggen in Ã©Ã©n sessieblok, apart van het menu, en is de timer geen knop', async () => {
        const session = tid(b.page, 'session');
        for (const id of ['vault-state', 'lock', 'logout']) expect(await session.locator(`[data-testid="${id}"]`).count()).toBe(1);
        expect(await b.page.locator('ks-menu [data-testid="session"], ks-menu [data-testid="vault-state"]').count()).toBe(0);
        const timer = await tid(b.page, 'vault-state').evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), btn: !!el.closest('button, .btn'), clock: !!el.querySelector('use[href="#i-clock"]') }));
        expect(timer).toEqual({ tag: 'SPAN', role: null, btn: false, clock: true });
        expect(await tid(b.page, 'lock').getAttribute('class')).toContain('btn-outline');
        expect((await tid(b.page, 'logout').textContent()).trim()).toBe(''); // alleen een icoon, met een naam (aria-label)
        // de lijn: links van het sessieblok, rechts van het laatste menu-item; het menu begint naast het logo
        const line = await session.evaluate(el => globalThis.getComputedStyle(el).borderLeftWidth);
        expect(parseFloat(line)).toBeGreaterThan(0);
        const menuEnd = await b.page.locator('ks-header ks-menu [data-tab]').last().boundingBox();
        const menuStart = await b.page.locator('ks-header ks-menu [data-tab]').first().boundingBox();
        const sessionBox = await session.boundingBox();
        expect(sessionBox.x).toBeGreaterThanOrEqual(menuEnd.x + menuEnd.width);
        expect(Math.abs(menuEnd.y - sessionBox.y)).toBeLessThan(sessionBox.height); // op Ã©Ã©n regel, niet eronder
        expect(menuStart.x).toBeLessThan(300); // links, naast het logo, niet gecentreerd
    });

    it('Given de afteller loopt When de gebruiker iets doet in het portaal Then begint ze opnieuw vanaf de ingestelde tijd', async () => {
        await b.page.clock.install(); // nep-tijd in de pagina; de server telt echt, daar gaan maar seconden voorbij
        // Elk antwoord met een sessie zet de afteller op de echte resttijd van de server. Een ophaling op de achtergrond
        // (het pushkaartje, het laden van het scherm) die pas na de sprong van de nepklok aankomt, zou ze dus terug op
        // 15 min zetten: eerst wachten tot het pushkanaal open is en alles afgehandeld is, dan pas springen.
        const pushOpen = b.page.waitForResponse(r => new URL(r.url()).pathname === '/api/push');
        await b.page.reload();
        await tid(b.page, 'view-main').waitFor();
        await pushOpen;
        await settled(b.page);
        expect(await tid(b.page, 'vault-state').textContent()).toContain('Locks in 15 min');
        await b.page.clock.fastForward(10 * 60_000);
        expect(await tid(b.page, 'vault-state').textContent()).toContain('Locks in 5 min');
        await tid(b.page, 'tab-secrets').click();
        await settled(b.page);
        await expect.poll(() => tid(b.page, 'vault-state').textContent()).toContain('Locks in 15 min');
    });

    it('Given een vergrendeld portaal Then is de portalsessie dicht en is er geen menu', async () => {
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        expect(await b.page.locator('ks-menu').isVisible()).toBe(false);
    });
});
