// Het aanraakvenster bij een koppeling: het bevestigt dat de ingevoerde code overeenkomt en
// heeft na bevestigen of weigeren een knop die het venster sluit. Het echte proces, een echte browser met een virtuele
// authenticator; de CLI `login` vraagt de koppeling, de tray (nep) staat toe, de test opent het venster uit de log.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES, runLogin } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, screenshot, settled } from '../helpers/browser.js';

const [, startProcess] = MODES[0];

describe('aanraakvenster bij een koppeling', () => {
    let proc;
    let b;

    beforeAll(async () => {
        proc = await startProcess(tempHome(), { unlock: false, tray: 'none' });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    // window.close() van een gewone tab sluit niets; de test telt de aanroepen en laat de tekst staan.
    const recordClose = () => b.page.evaluate(() => {
        globalThis.closeCalls = 0;
        globalThis.close = () => { globalThis.closeCalls += 1; };
    });
    const closeCalls = () => b.page.evaluate(() => globalThis.closeCalls);

    async function startPair(name) {
        const login = runLogin({ proxy: proc.proxy, name, home: tempHome() });
        await tid(b.page, 'tab-tools').click();
        await settled(b.page);
        const row = b.page.locator('[data-testid="device-table"] tbody tr').first();
        for (const started = Date.now(); Date.now() - started < 20_000 && await row.count() === 0;) { await tid(b.page, 'tab-tools').click(); await settled(b.page); }
        const deadline = Date.now() + 10_000;
        while (!/Your code: [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        const code = login.stderr.match(/Your code: ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
        expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        const result = await b.page.evaluate(async codeValue => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const pending = await (await globalThis.portalFetch('/api/device')).json();
            const headers = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            const verified = await globalThis.portalFetch(`/api/device/${pending[0].id}/verify`, { method: 'POST', headers, body: JSON.stringify({ code: codeValue }) });
            if (!verified.ok) throw new Error('device code verification failed');
            const approved = await globalThis.portalFetch(`/api/device/${pending[0].id}/approve`, { method: 'POST', headers, body: '{}' });
            return approved.json();
        }, code);
        expect(result.touch).toBeTruthy();
        return { login, touchId: result.touch };
    }

    it('Given een wachtende koppeling When het venster opent Then staat bij de code dat ze dezelfde moet zijn als in de terminal; na bevestigen sluit een knop het venster', async () => {
        const { login, touchId } = await startPair('mytool');
        await b.page.goto(`${proc.portal}/touch#${touchId}`);
        await tid(b.page, 'touch-question').waitFor();
        const details = await tid(b.page, 'touch-details').textContent();
        expect(details).toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}/);
        const hint = await tid(b.page, 'touch-code-hint').textContent();
        expect(hint).toContain(details.match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)[0]);
        expect(hint).toMatch(/matches your terminal/i);
        expect(hint).toMatch(/touch your passkey to confirm/i);
        expect(await tid(b.page, 'touch-close').isVisible()).toBe(false);
        expect(await b.page.locator('h1').textContent()).toBe('Pair mytool?');
        // één venster dat één ding vraagt: weigeren links (omlijnd, met de focus), aanraken rechts als enige gevulde knop
        expect(await b.page.locator('[data-layout="focus"]').count()).toBe(1);
        expect(await tid(b.page, 'touch-deny').textContent()).toBe('Cancel and deny');
        expect(await b.page.evaluate(() => globalThis.document.activeElement?.dataset.testid)).toBe('touch-deny');
        expect(await b.page.locator('#touch-actions .btn-primary').count()).toBe(1);
        await screenshot(b.page, 'touch-1-pair');

        await tid(b.page, 'touch-confirm').click();
        await tid(b.page, 'touch-done').waitFor();
        expect((await login).code).toBe(0);
        await tid(b.page, 'touch-close').waitFor();
        expect(await tid(b.page, 'touch-close').textContent()).toBe('Close window');
        await recordClose();
        await tid(b.page, 'touch-close').click();
        expect(await closeCalls()).toBe(1);
        // Sluiten lukte niet (gewone tab): de tekst blijft staan.
        expect(await tid(b.page, 'touch-done').textContent()).toMatch(/close this window/i);
        expect(await b.page.locator('h1').textContent()).toBe('Confirmed');
        await screenshot(b.page, 'touch-2-done');
    }, 60_000);

    it('Given een wachtende koppeling When weigeren Then ook een knop om te sluiten', async () => {
        await b.page.goto(proc.portal);
        await settled(b.page);
        const { login, touchId } = await startPair('mytool-2');
        await b.page.goto(`${proc.portal}/touch#${touchId}`);
        await tid(b.page, 'touch-question').waitFor();
        await tid(b.page, 'touch-deny').click();
        await tid(b.page, 'touch-done').waitFor();
        expect((await login).code).toBe(1);
        await recordClose();
        await tid(b.page, 'touch-close').click();
        expect(await closeCalls()).toBe(1);
        expect(await tid(b.page, 'touch-done').textContent()).toMatch(/denied/i);
    }, 60_000);

    it('Given een gekozen thema in Settings When het aanraakvenster opent Then volgt het die keuze; zonder keuze het systeem', async () => {
        const theme = () => b.page.evaluate(() => globalThis.document.documentElement.dataset.theme ?? '');
        await b.page.goto(proc.portal);
        await b.page.evaluate(() => globalThis.localStorage.setItem('vaultgate.theme', 'console-light')); // wat Settings bewaart
        await b.page.goto(`${proc.portal}/touch#bestaat-niet`);
        expect(await theme()).toBe('console-light');
        await b.page.evaluate(() => globalThis.localStorage.removeItem('vaultgate.theme'));
        await b.page.reload();
        expect(await theme()).toBe(''); // zoals Windows
    }, 30_000);

    it('MOET weigeren: geen uitleg bij de code als er niets te koppelen valt (een vraag die niet bestaat)', async () => {
        await b.page.goto(`${proc.portal}/touch#bestaat-niet`);
        await tid(b.page, 'touch-message').getByText(/no longer exists/i).waitFor();
        expect(await b.page.locator('h1').textContent()).toBe('Nothing to confirm');
        await screenshot(b.page, 'touch-3-gone');
        expect(await tid(b.page, 'touch-code-hint').isVisible()).toBe(false);
        expect(await tid(b.page, 'touch-close').isVisible()).toBe(false);
    }, 30_000);
});
