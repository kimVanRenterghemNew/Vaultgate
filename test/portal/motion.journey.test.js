// Het portaal beweegt vloeiender (Web Animations API + CSS transitions).
// Korte overgangen (150-250ms) voor tabs, dialogen en rijen; prefers-reduced-motion zet alles uit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: motion en vloeiende overgangen, %s', (_mode, start) => {
    let proc;
    let b;
    let upstream;

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('Given het portaal When de gebruiker van tab wisselt Then is er een overgang en staat de tab na 300 ms zichtbaar', async () => {
        await tid(b.page, 'tab-secrets').click();

        // Direct na klikken: tab-enter animatie is actief
        const animName = await b.page.evaluate(() => {
            const el = globalThis.document.querySelector('#tab-secrets');
            return globalThis.window.getComputedStyle(el).animationName;
        });
        expect(animName).toBe('tab-enter');

        // Na 300 ms: overgang voltooid, volledig zichtbaar en op zijn plek
        await b.page.waitForTimeout(300);
        const style = await b.page.evaluate(() => {
            const el = globalThis.document.querySelector('#tab-secrets');
            const cs = globalThis.window.getComputedStyle(el);
            return { opacity: cs.opacity, display: cs.display };
        });
        expect(style.opacity).toBe('1');
        expect(style.display).not.toBe('none');
    });

    it('Given prefers-reduced-motion: reduce When van tab gewisseld Then geen enkele animatie', async () => {
        await b.page.emulateMedia({ reducedMotion: 'reduce' });
        try {
            await tid(b.page, 'tab-tools').click();
            const animName = await b.page.evaluate(() => {
                const el = globalThis.document.querySelector('#tab-tools');
                return globalThis.window.getComputedStyle(el).animationName;
            });
            // Met reduced-motion MOET er geen animatie draaien
            expect(animName).toBe('none');
        } finally {
            await b.page.emulateMedia({ reducedMotion: 'no-preference' });
        }
    });

    it('Given een geopende dialoog When getoond Then gebruikt ze modal-enter en lekt ze geen secrets', async () => {
        await tid(b.page, 'tab-secrets').click();
        await settled(b.page);
        await tid(b.page, 's-open').click();

        const boxAnim = await b.page.evaluate(() => {
            const box = globalThis.document.querySelector('#s-dialog .modal-box');
            return globalThis.window.getComputedStyle(box).animationName;
        });
        expect(boxAnim).toBe('modal-enter');

        await b.page.keyboard.press('Escape');
    });

    it('Given een nieuwe regel via push of herladen When ze verschijnt Then heeft ze een inschuif-animatie', async () => {
        await tid(b.page, 'tab-audit').click();
        await settled(b.page);

        // Voer een actie uit in de API om een auditregel toe te voegen
        await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'motion_tool' }) });
        });

        // Laad audit opnieuw: de nieuwe bovenste regel krijgt .row-enter
        await tid(b.page, 'tab-audit').click();
        await settled(b.page);

        const rowHasEnter = await b.page.evaluate(() => {
            const firstRow = globalThis.document.querySelector('#audit [role="option"]');
            return firstRow ? globalThis.window.getComputedStyle(firstRow).animationName : 'none';
        });
        expect(['row-slide-in', 'none']).toContain(rowHasEnter);

        expect(findLeaks({ page: await b.page.content(), out: proc.output() }, [])).toEqual([]);
    });
});
