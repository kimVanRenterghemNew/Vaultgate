// Het portaal toont per tool welke secrets naar welke hosts mogen, ook die uit "altijd" in de tray (herkomst
// zichtbaar), filtert per tool en secret, en een toekenning verwijderen laat de volgende call weer een vraag aan de tray geven.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { addGrant, openBrowser, setupPortal, screenshot, tid, settled, answerTouch, answerAsk } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: toekenningen, %s', (mode, start) => {
    let proc;
    let b;
    let upstream;
    let key;
    const shots = mode === 'proces';
    const rows = () => b.page.locator('[data-testid^="grant-row-"]');
    /** Kiest de toekenning links en geeft de tekst van het detail rechts. */
    const detailOf = async id => { await tid(b.page, 'grant-row-' + id).click(); return tid(b.page, 'grant-detail').textContent(); };
    const grantOf = async (tool, secret) => (await b.page.evaluate(async () => (await globalThis.portalFetch('/api/grants')).json())).find(g => g.toolName === tool && g.secretName === secret);

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await start(tempHome(), { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        key = await b.page.evaluate(async origin => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'demo', value: 'FAKE-grants-value-1234567890', hosts: [origin] }) });
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'ander', value: 'FAKE-grants-value-0987654321', hosts: [origin] }) });
            await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'agent' }) });
            return (await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'mytool' }) })).json()).key;
        }, upstream.origin);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    /** "Altijd" in de tray vraagt sinds 9.3 een aanraking van de passkey: die geeft de test in het portaalvenster. */
    let touches = 0;
    async function callWithTouch() {
        const pending = call();
        await answerTouch(b.page, proc, ++touches);
        await b.page.goto(proc.portal);
        await tid(b.page, 'view-main').waitFor();
        return pending;
    }

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });

    it('een "altijd" in de tray verschijnt in het portaal met herkomst tray; toevoegen in het portaal begint leeg', async () => {
        expect((await callWithTouch()).headers.get('x-vault-gate-rule')).toBe('approved-4h');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        // niets vooraf ingevuld; het domein kies je uit die van het secret; standaard een melding en één uur
        await tid(b.page, 'g-open').click();
        expect([await tid(b.page, 'g-tool').inputValue(), await tid(b.page, 'g-secret').inputValue(), await tid(b.page, 'g-host').inputValue()]).toEqual(['', '', '']);
        expect(await tid(b.page, 'g-tool').locator('option:checked').textContent()).toBe('Choose a tool…');
        expect(await tid(b.page, 'g-mode').inputValue()).toBe('notify');
        expect(await tid(b.page, 'g-duration').inputValue()).toBe('3600000');
        await tid(b.page, 'g-secret').selectOption({ label: 'ander' });
        expect(await tid(b.page, 'g-host').locator('option').allTextContents()).toEqual(['Choose a domain…', upstream.origin]);
        if (shots) await screenshot(b.page, 'portaal-10b-grant-add');
        await b.page.keyboard.press('Escape');
        // en een toekenning via het portaal zelf, voor de herkomst "portaal"
        await addGrant(b.page, { tool: 'agent', secret: 'ander', host: upstream.origin });
        await rows().nth(1).waitFor();
        expect(await detailOf('mytool-demo')).toContain('approved in the tray'); // sinds 3.4 maakt de tray ook toekenningen met een looptijd
        expect(await tid(b.page, 'grant-row-agent-ander').textContent()).toMatch(/(59|60) min left/);
        const agent = await detailOf('agent-ander');
        expect(agent).toContain('added in the portal');
        expect(agent).toContain('Let it through with a notification');
        expect(agent).toMatch(/(59|60) min left/);
        if (shots) await screenshot(b.page, 'portaal-10-toekenningen');
    });

    it('filteren per tool en per secret', async () => {
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await tid(b.page, 'g-filter-tool').selectOption({ label: 'mytool' });
        await settled(b.page);
        expect(await rows().count()).toBe(1);
        await tid(b.page, 'g-filter-tool').selectOption('');
        await tid(b.page, 'g-filter-secret').selectOption({ label: 'ander' });
        await settled(b.page);
        expect(await rows().allTextContents()).toEqual([expect.stringContaining('agent')]);
        await tid(b.page, 'g-filter-secret').selectOption('');
        await settled(b.page);
    });

    it('Given een toekenning uit de tray When in het portaal verwijderd (Delete) Then vraagt de volgende call opnieuw goedkeuring', async () => {
        await tid(b.page, 'grant-row-mytool-demo').click();
        expect((await tid(b.page, 'grant-revoke-mytool-demo').textContent()).trim()).toBe('Delete');
        await tid(b.page, 'grant-revoke-mytool-demo').click();
        expect(await tid(b.page, 'ask-question').textContent()).toContain('mytool → demo');
        await answerAsk(b.page);
        expect(await rows().count()).toBe(1);
        expect((await callWithTouch()).headers.get('x-vault-gate-rule')).toBe('approved-4h'); // opnieuw gevraagd (de tray zei weer "altijd")
    });

    it('3.4/3.6: een toekenning met een looptijd en elke keer vragen; Edit wijzigt "bij gebruik" en laat de resterende tijd staan', async () => {
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await addGrant(b.page, { tool: 'mytool', secret: 'ander', host: upstream.origin, mode: 'confirm', duration: 1800000 });
        const row = tid(b.page, 'grant-row-mytool-ander');
        expect(await row.textContent()).toMatch(/(29|30) min left/);
        expect(await detailOf('mytool-ander')).toContain('Ask me every call');
        const detail = tid(b.page, 'grant-detail');
        const before = (await grantOf('mytool', 'ander')).expiresAt;
        await tid(b.page, 'grant-edit-mytool-ander').click();
        expect(await tid(b.page, 'grant-edit-extend').inputValue()).toBe('keep');
        await tid(b.page, 'grant-edit-mode').selectOption('silent');
        if (shots) await screenshot(b.page, 'portaal-10c-grant-edit');
        await tid(b.page, 'grant-edit-save').click(); await settled(b.page);
        expect(await detail.textContent()).toContain('Let it through quietly'); // de keuze bleef staan na het herladen
        expect((await grantOf('mytool', 'ander')).expiresAt).toBe(before); // de resterende tijd bleef staan
        // verlengen met een uur telt vanaf het huidige einde
        await tid(b.page, 'grant-edit-mytool-ander').click();
        await tid(b.page, 'grant-edit-extend').selectOption('3600000');
        await tid(b.page, 'grant-edit-save').click(); await settled(b.page);
        const extended = (await grantOf('mytool', 'ander')).expiresAt;
        expect(extended - before).toBeGreaterThan(3_590_000);
        expect(extended - before).toBeLessThan(3_610_000);
    });

    it('4.29: Given een oude key met standaard "elke keer vragen" en 4 uur When gekozen bij een nieuwe toekenning Then staan die klaar; een nieuwe key krijgt melding en 1 uur', async () => {
        const oldKey = await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            return (await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'oud', onUse: 'confirm', validMs: 14_400_000 }) })).json()).key;
        });
        await b.page.reload(); await tid(b.page, 'view-main').waitFor();
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await tid(b.page, 'g-open').click();
        await tid(b.page, 'g-tool').selectOption({ label: 'mytool' });
        expect([await tid(b.page, 'g-mode').inputValue(), await tid(b.page, 'g-duration').inputValue()]).toEqual(['notify', '3600000']);
        await tid(b.page, 'g-tool').selectOption({ label: 'oud' });
        expect([await tid(b.page, 'g-mode').inputValue(), await tid(b.page, 'g-duration').inputValue()]).toEqual(['confirm', '14400000']);
        await tid(b.page, 'g-secret').selectOption({ label: 'demo' });
        await tid(b.page, 'g-host').selectOption(upstream.origin);
        await tid(b.page, 'g-mode').selectOption('silent'); // de call hieronder mag geen goedkeuring vragen
        await tid(b.page, 'g-add').click(); await settled(b.page);
        expect(await tid(b.page, 'grant-row-oud-demo').textContent()).toMatch(/[34] h left/);
        const grant = await grantOf('oud', 'demo');
        expect(grant.expiresAt - grant.createdAt).toBeGreaterThan(14_390_000);
        expect(grant.expiresAt - grant.createdAt).toBeLessThanOrEqual(14_400_000);
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': oldKey, authorization: 'Bearer {{secret:demo}}' } });
        expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
    });

    it('3.7: Given een vaste "elke keer vragen" When een toekenning van 30 min erbij Then staat er een tijdelijke regel; "End now" laat de vaste staan', async () => {
        const fixed = await grantOf('agent', 'ander');
        await b.page.evaluate(async id => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            await globalThis.portalFetch(`/api/grants/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: JSON.stringify({ mode: 'confirm', durationMs: 0 }) });
        }, fixed.id);
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await addGrant(b.page, { tool: 'agent', secret: 'ander', host: upstream.origin, mode: 'silent', duration: 1800000 });
        expect(await detailOf('agent-ander')).toContain('Ask me every call'); // de vaste regel
        expect(await tid(b.page, 'grant-temporary-agent-ander').textContent()).toMatch(/(29|30) min left.*Let it through quietly/s);
        if (shots) await screenshot(b.page, 'portaal-10d-grant-temporary');
        await tid(b.page, 'grant-end-temporary-agent-ander').click(); await settled(b.page);
        expect(await tid(b.page, 'grant-temporary-agent-ander').count()).toBe(0);
        expect(await grantOf('agent', 'ander')).toMatchObject({ id: fixed.id, mode: 'confirm', expiresAt: null, overrideUntil: null });
    });

    it('MOET weigeren: een toekenning via de API voor een host buiten de domeinen van het secret (grant-host-not-allowed)', async () => {
        const result = await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const tool = (await (await globalThis.portalFetch('/api/tools')).json()).find(x => x.name === 'mytool');
            const res = await globalThis.portalFetch('/api/grants', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: JSON.stringify({ toolId: tool.id, secretName: 'demo', host: 'https://evil.example' }) });
            return { status: res.status, body: await res.json() };
        });
        expect(result.status).toBe(400);
        expect(result.body.error.rule).toBe('grant-host-not-allowed');
        expect((await b.page.evaluate(async () => (await globalThis.portalFetch('/api/grants')).json())).some(g => g.host === 'https://evil.example')).toBe(false);
    });

    it('"All domains of this secret": één toekenning per domein', async () => {
        await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: JSON.stringify({ name: 'twee', value: 'FAKE-grants-value-two-1234567', hosts: ['api.two.example', 'uploads.two.example'] }) });
        });
        await b.page.reload(); await tid(b.page, 'view-main').waitFor();
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await addGrant(b.page, { tool: 'agent', secret: 'twee', host: '*', mode: 'silent', duration: 14_400_000 }); // een handmatige key: hoogstens 4 uur
        const hosts = (await b.page.evaluate(async () => (await globalThis.portalFetch('/api/grants')).json())).filter(g => g.secretName === 'twee').map(g => g.host).sort();
        expect(hosts).toEqual(['https://api.two.example', 'https://uploads.two.example']);
    });

    it('geen waarde in de API-antwoorden', () => {
        expect(b.responses.join('\n')).not.toContain('FAKE-grants-value');
        void fakeSecret;
    });

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, ['FAKE-grants-value-1234567890', 'FAKE-grants-value-0987654321', 'FAKE-grants-value-two-1234567', key].filter(Boolean))).toEqual([]);
    });
});
