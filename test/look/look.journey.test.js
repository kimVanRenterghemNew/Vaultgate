// `npm run look` kijkt elk scherm na terwijl het een screenshot maakt. De nakijker moet een fout scherm melden
// (rauwe i18n-sleutel, scrollbalk, JS-fout) en een goed scherm met rust laten.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openBrowser } from '../helpers/browser.js';
import { inspect } from '../helpers/look.js';

describe('look: schermen nakijken', () => {
    let b;
    beforeAll(async () => { b = await openBrowser(); }, 60_000);
    afterAll(async () => { await b?.close(); });

    it('MOET melden: een zichtbare i18n-sleutel, een scrollbalk en een JS-fout', async () => {
        const errors = [];
        b.page.once('pageerror', e => errors.push(e.message));
        await b.page.setContent('<!doctype html><html><body style="margin:0"><p>portal.welcome.start</p><div style="height:3000px"></div><script>setTimeout(() => { throw new Error("boom"); })</script></body></html>');
        await b.page.waitForTimeout(100);
        const problems = await inspect(b.page, { errors });
        expect(problems).toEqual(expect.arrayContaining([
            expect.stringMatching(/untranslated key: portal\.welcome\.start/),
            expect.stringMatching(/scrolls/),
            expect.stringMatching(/js error: boom/),
        ]));
    });

    it('een goed scherm: geen problemen', async () => {
        await b.page.setContent('<!doctype html><html><body style="margin:0"><h1>Your vault is ready</h1><p>Version 0.1.0 at example.com</p></body></html>');
        expect(await inspect(b.page, { errors: [] })).toEqual([]);
    });
});
