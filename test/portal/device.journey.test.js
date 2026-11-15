// Een koppeling goedkeuren in het portaal, zonder tray. De CLI wacht op de goedkeuring, het
// portaal toont tool, code en client; na "Toestaan" heeft de tool zijn key. Een bestaande naam wordt expliciet gemeld.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES, runLogin, readToolKey } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: tools koppelen, %s', (mode, start) => {
    let proc;
    let b;
    const shots = mode === 'proces';

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false, tray: 'none' });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given een wachtende koppeling When "Toestaan" in het portaal Then krijgt de tool haar key en verdwijnt de aanvraag', async () => {
        const clientHome = tempHome();
        const login = runLogin({ proxy: proc.proxy, name: 'claude-code', home: clientHome });
        await tid(b.page, 'tab-tools').click();
        await settled(b.page);
        const row = b.page.locator('[data-testid="device-table"] tbody tr').first();
        for (const t0 = Date.now(); Date.now() - t0 < 45_000 && await row.count() === 0;) { await tid(b.page, 'tab-tools').click(); await settled(b.page); }
        const text = await row.textContent();
        expect(text).toContain('claude-code');
        expect(text).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}/);
        // 9.20: de terminalcode blijft bij de gebruiker; het portaal vraagt die zelf in te typen.
        expect(await tid(b.page, 'tools-waiting').textContent()).toMatch(/type the code/i);
        expect(await tid(b.page, 'menu-wait-tools').textContent()).toBe('1');
        expect(text).toContain('127.0.0.1');
        if (shots) await screenshot(b.page, 'portaal-12-koppelen-wacht');
        // ook op Activity, onder "Waiting for you", met een knop naar Virtual keys
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        expect(await tid(b.page, 'waiting-pair').textContent()).toContain('claude-code wants to pair');
        await tid(b.page, 'waiting-pair-go').click(); await settled(b.page);
        expect(await tid(b.page, 'tab-tools').getAttribute('aria-current')).toBe('page');
        const codeDeadline = Date.now() + 10_000;
        while (!/Your code: [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < codeDeadline) await new Promise(r => setTimeout(r, 20));
        const terminalCode = login.stderr.match(/Your code: ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
        expect(terminalCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        const pending = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/device')).json());
        const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        const wrong = await b.page.evaluate(async ({ id, csrf }) => (await globalThis.portalFetch(`/api/device/${id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ code: '0000-0000' }) })).status, { id: pending[0].id, csrf: state.csrf });
        expect(wrong).toBe(400);
        // Een verkeerde code in het portaal: een vertaalde melding, geen ruwe foutcode.
        await tid(b.page, 'device-approve-claude-code').click();
        await tid(b.page, 'ask-input').fill('1111-1111');
        await tid(b.page, 'ask-ok').click();
        await settled(b.page);
        const wrongText = await tid(b.page, 'message').textContent();
        expect(wrongText).toMatch(/pairing code is not right/i);
        expect(wrongText).not.toContain('DEVICE_CODE_INVALID');
        await tid(b.page, 'device-approve-claude-code').click();
        await tid(b.page, 'ask-input').fill(terminalCode);
        await tid(b.page, 'ask-ok').click();
        await settled(b.page);
        const result = await login;
        expect(result.code, result.stderr).toBe(0);
        expect(result.stderr).toContain(terminalCode);
        expect(result.stderr).toMatch(/type this code into the pairing request/i);
        const key = await readToolKey(clientHome, 'claude-code');
        expect(key).toMatch(/^ks_/);
        // de gekoppelde tool staat meteen in de lijst, met naam en soort; er wacht niets meer
        await tid(b.page, 'tool-row-claude-code').waitFor();
        expect(await tid(b.page, 'tool-row-claude-code').textContent()).toContain('Web requests');
        expect(await tid(b.page, 'tools-waiting').isHidden()).toBe(true);
        expect(findLeaks({ page: await b.page.content(), api: b.responses.join('\n'), out: proc.output(), cli: result.stderr }, [key])).toEqual([]);
    }, 60_000);

    it('een bestaande naam wordt meteen geweigerd (name_taken; 9.5); weigeren in het portaal laat de CLI stoppen met access_denied', async () => {
        const taken = await runLogin({ proxy: proc.proxy, name: 'claude-code', home: tempHome() });
        expect(taken.code).toBe(1);
        expect(taken.stderr).toContain('name_taken');
        const login = runLogin({ proxy: proc.proxy, name: 'claude-code-2', home: tempHome() });
        const row = b.page.locator('[data-testid="device-table"] tbody tr').first();
        for (const t0 = Date.now(); Date.now() - t0 < 45_000 && await row.count() === 0;) { await tid(b.page, 'tab-tools').click(); await settled(b.page); }
        expect(await row.textContent()).toContain('claude-code-2');
        await tid(b.page, 'device-deny-claude-code-2').click();
        await settled(b.page);
        const result = await login;
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('access_denied');
    }, 60_000);
});
