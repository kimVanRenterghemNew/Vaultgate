// Na het welkom valt de gebruiker terug op het gewone portaal: geen dwingende vervolg-wizard.
// De rest van de opzet kan later, via de gewone tabbladen.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { addGrant, openBrowser, setupPortal, screenshot, tid, settled, answerAsk } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: begeleide eerste keer, %s', (mode, start) => {
    const value = fakeSecret('wizard');
    let proc;
    let b;
    let upstream;
    let key;
    const shots = mode === 'proces';
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

    it('na welkom: gewone portaal op Activity, zonder dwingende vervolg-wizard', async () => {
        await tid(b.page, 'view-main').waitFor();
        await settled(b.page);
        expect(await tid(b.page, 'tab-audit').getAttribute('aria-current')).toBe('page');
        expect(await tid(b.page, 'wizard').isVisible()).toBe(false);
        if (shots) await screenshot(b.page, 'portaal-13-post-welcome-main');
    });

    it('de gebruiker kan de rest later doen via de gewone tabbladen (tool -> secret -> grant)', async () => {
        await tid(b.page, 'tab-tools').click();
        await settled(b.page);
        await tid(b.page, 'tools-create').click();
        await tid(b.page, 'key-way-manual').click();
        await settled(b.page);
        await tid(b.page, 't-name').fill('mytool');
        await tid(b.page, 't-add').click();
        await settled(b.page);
        key = (await tid(b.page, 't-key').textContent()).trim();
        await tid(b.page, 'key-done').click();
        await settled(b.page);

        await tid(b.page, 'tab-secrets').click();
        await settled(b.page);
        expect(await tid(b.page, 'tab-secrets').getAttribute('aria-current')).toBe('page');
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-name').fill('demo');
        await tid(b.page, 's-value').fill(value);
        await tid(b.page, 's-hosts').fill(upstream.origin);
        await tid(b.page, 's-add').click();
        await settled(b.page);

        await tid(b.page, 'tab-grants').click();
        await settled(b.page);
        await addGrant(b.page, { secret: 'demo', host: upstream.origin });
        if (shots) await screenshot(b.page, 'portaal-14-post-welcome-grant');
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/eerste`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
    });

    it('nergens een waarde in de pagina of de API-antwoorden', async () => {
        expect(findLeaks({ page: await b.page.content(), api: b.responses.join('\n'), out: proc.output() }, [value])).toEqual([]);
    });

    it('Given opzet zonder herstelcode When kluis vergrendeld Then toont login "opnieuw beginnen" en weigert passphrase', async () => {
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        expect(await tid(b.page, 'login-start-over').isVisible()).toBe(true);
        expect(await tid(b.page, 'login-start-over').textContent()).toContain('start over');
        const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(state.hasRecovery).toBe(false);
        expect(state.hasPassphrase).toBe(false);
        const res = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"gok"}' })).status);
        expect(res).toBe(401);
        await tid(b.page, 'login-go').click();
        await tid(b.page, 'view-main').waitFor();
    });

    it('Delete vault in Settings met aanraking: dialoog bevestigen wist de kluis en keert terug naar het welkom', async () => {
        await tid(b.page, 'tab-settings').click();
        await settled(b.page);
        expect(await tid(b.page, 'set-delete-vault').isVisible()).toBe(true);

        // Annuleren: kluis blijft bestaan
        await tid(b.page, 'set-delete-vault').click();
        await answerAsk(b.page, { cancel: true });
        const midState = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(midState.vaultExists).toBe(true);

        // Bevestigen: aanraking via virtual authenticator wist de kluis en toont welkom
        if (shots) await screenshot(b.page, 'portaal-15-delete-vault-settings');
        await tid(b.page, 'set-delete-vault').click();
        await answerAsk(b.page);
        await tid(b.page, 'view-welcome').waitFor();
        await settled(b.page);
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('none');
        const endState = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(endState.vaultExists).toBe(false);
        expect(endState.unlocked).toBe(false);
    });
});
