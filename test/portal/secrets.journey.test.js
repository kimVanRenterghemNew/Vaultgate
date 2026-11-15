// Secrets toevoegen, bewerken, roteren, verwijderen in het portaal; de waarde komt nooit terug: niet in de API, niet in
// de HTML van eender welk tabblad. De proxy gebruikt de geroteerde waarde.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled, answerAsk } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: secrets, %s', (mode, start) => {
    const value = fakeSecret('portal');
    const rotated = fakeSecret('rotated');
    let proc;
    let b;
    let upstream;
    const pages = {};
    const shots = mode === 'proces';
    const rows = () => b.page.locator('[data-testid^="secret-row-"]');
    const detail = () => tid(b.page, 'secret-detail');
    let toolKey;

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

    it('Given een nieuw secret zonder de toggle aan te raken When opgeslagen Then is het Sensitive, en daarna alleen "set on <datum>"', async () => {
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 's-open').click();
        expect(await tid(b.page, 's-sensitive').isChecked()).toBe(true); // standaard aan
        await tid(b.page, 's-name').fill('github_token');
        await tid(b.page, 's-value').fill(value);
        // het oog toont de waarde tijdens het typen
        expect(await tid(b.page, 's-value').getAttribute('type')).toBe('password');
        await tid(b.page, 's-reveal').click();
        expect(await tid(b.page, 's-value').getAttribute('type')).toBe('text');
        expect(await tid(b.page, 'secret-clipboard-note').textContent()).toContain('Win+V');
        await tid(b.page, 's-hosts').fill(`api.github.com, ${upstream.origin}`);
        if (shots) await screenshot(b.page, 'portaal-7a-secret-add');
        await tid(b.page, 's-add').click();
        await settled(b.page);
        const rowText = await rows().first().textContent();
        expect(rowText).toContain('github_token');
        expect(rowText).toContain('api.github.com');
        expect(rowText).toContain('no grants yet');
        expect(await rows().first().getAttribute('aria-selected')).toBe('true'); // het enige secret staat gekozen
        const detailText = await detail().textContent();
        expect(detailText).not.toContain('https://'); // domeinen zoals de gebruiker ze kent
        expect(detailText).toMatch(/set on \d.*never shown again/);
        expect(detailText).toContain('not yet known'); // de plek leert het secret bij de eerste toegestane call
        expect(detailText).toContain('every approval, even a one-time one'); // Sensitive: aanraken bij elke goedkeuring
        expect(await tid(b.page, 'sensitive-badge-github_token').count()).toBe(1);
        expect(await tid(b.page, 's-value').inputValue()).toBe('');
        expect(await tid(b.page, 's-value').getAttribute('type')).toBe('password'); // het oog staat weer dicht
        if (shots) { await b.page.waitForTimeout(500); await screenshot(b.page, 'portaal-7-secrets'); } // na de overgang van de dialoog
    });

    it('regressie: snel na elkaar klikken (gelijktijdige laadbeurten) geeft geen dubbele rijen', async () => {
        // drie kliks in dezelfde taak: drie laadbeurten tegelijk (zoals een ongeduldige gebruiker of een trage server)
        await b.page.evaluate(() => { for (let i = 0; i < 3; i++) globalThis.document.querySelector('[data-testid="tab-secrets"]').click(); });
        await settled(b.page);
        expect(await rows().count()).toBe(1);
    });

    it('MOET weigeren: een secret zonder doelhost; sluiten wist de getypte waarde', async () => {
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-name').fill('zonder_host');
        await tid(b.page, 's-value').fill('x');
        await tid(b.page, 's-add').click();
        await tid(b.page, 'message').filter({ hasText: 'INVALID_HOST_RULE' }).waitFor();
        await b.page.keyboard.press('Escape');
        await expect.poll(() => tid(b.page, 's-value').inputValue()).toBe(''); // het close-event komt een taak later
        await tid(b.page, 's-name').fill('');
    });

    it('9.4: de plek staat in de lijst; de API weigert een ongeldige plek (het portaal vraagt de plek niet meer)', async () => {
        const status = await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const [s] = await (await globalThis.portalFetch('/api/secrets')).json();
            const put = inject => globalThis.portalFetch(`/api/secrets/${s.id}/inject`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: JSON.stringify({ inject }) });
            return [(await put(['header:authorization', 'query:token'])).status, (await put(['body:x'])).status];
        });
        expect(status).toEqual([200, 400]);
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        expect(await detail().textContent()).toContain('query:token');
    });

    it('Edit: de domeinen als chips; een domein erbij en een eraf, Sensitive uit', async () => {
        await tid(b.page, 'edit-github_token').click();
        expect(await tid(b.page, 'secret-chip-api.github.com').count()).toBe(1);
        await tid(b.page, 'secret-edit-add').fill('uploads.github.com');
        await tid(b.page, 'secret-edit-add').press('Enter');
        await tid(b.page, 'secret-chip-remove-api.github.com').click();
        await tid(b.page, 'secret-edit-sensitive').uncheck();
        if (shots) await screenshot(b.page, 'portaal-7c-secret-edit');
        await tid(b.page, 'secret-edit-save').click();
        await settled(b.page);
        const text = await detail().textContent();
        expect(text).toContain('uploads.github.com');
        expect(text).not.toContain('api.github.com');
        expect(text).toContain('only for a grant, not for every request'); // Sensitive uit: geen aanraking per request
        expect(await tid(b.page, 'sensitive-badge-github_token').count()).toBe(0);
    });

    it('annuleren in Edit verandert niets', async () => {
        await tid(b.page, 'edit-github_token').click();
        await tid(b.page, 'secret-edit-add').fill('evil.example');
        await b.page.keyboard.press('Escape');
        await settled(b.page);
        expect(await rows().first().textContent()).not.toContain('evil.example');
    });

    it('roteren: de nieuwe waarde gaat in een wachtwoordveld van de dialoog en staat daarna niet in de pagina', async () => {
        let native = 0; const count = () => { native += 1; };
        b.page.on('dialog', count);
        await tid(b.page, 'rotate-github_token').click();
        expect(await tid(b.page, 'ask-input').inputValue()).toBe(''); // de oude waarde komt nooit terug, ook niet als voorstel
        expect(await tid(b.page, 'ask-reveal').isVisible()).toBe(true); // een oog bij de nieuwe waarde
        expect(await tid(b.page, 'ask-warning').textContent()).toContain('Win+V');
        if (shots) await screenshot(b.page, 'portaal-7b-secret-rotate-dialog');
        expect(await answerAsk(b.page, { value: rotated })).toBe('password');
        b.page.off('dialog', count); expect(native).toBe(0); // geen browser-pop-up
        expect(await tid(b.page, 'ask-input').inputValue()).toBe(''); // na het sluiten gewist
        expect(findLeaks({ page: await b.page.content() }, [value, rotated])).toEqual([]);
    });

    it('roteren: de proxy gebruikt de nieuwe waarde', async () => {
        // toegang via de proxy: tool + toekenning via de API van het portaal (zelfde sessie)
        const key = toolKey = await b.page.evaluate(async origin => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            const tool = await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'mytool' }) })).json();
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'github_token', host: origin }) });
            return tool.key;
        }, upstream.origin);
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/user`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:github_token}}' } });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${rotated}`);
    });

    it('Given een call met het secret op een andere plek When "Allow this place" in Activity Then gaat de volgende call door, en Edit toont de plek als chip', async () => {
        const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/user`, { headers: { 'x-vault-gate-tool-key': toolKey, 'x-api-key': '{{secret:github_token}}' } });
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed');
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        await b.page.locator('[data-testid="audit-row"]').filter({ hasText: 'placeholder-location-not-allowed' }).first().click();
        await tid(b.page, 'audit-allow-place').click();
        await b.page.waitForFunction(() => globalThis.document.querySelector('[data-testid="ask-dialog"]')?.open === true);
        expect(await tid(b.page, 'ask-question').textContent()).toContain('header:x-api-key');
        await answerAsk(b.page);
        expect((await call()).status).toBe(200);
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 'edit-github_token').click();
        expect(await tid(b.page, 'secret-place-header:x-api-key').count()).toBe(1);
        await tid(b.page, 'secret-place-remove-header:x-api-key').click();
        await tid(b.page, 'secret-edit-save').click(); await settled(b.page);
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('placeholder-location-not-allowed'); // weggehaald in Edit
    });

    it('Given een opgeslagen secret When alle portaalpagina\'s en API-antwoorden doorzocht Then komt de waarde nergens voor', async () => {
        for (const tab of ['secrets', 'tools', 'grants', 'audit', 'passkeys', 'settings']) {
            await tid(b.page, `tab-${tab}`).click(); await settled(b.page);
            await settled(b.page);
            pages[tab] = await b.page.content();
        }
        expect(b.responses.length).toBeGreaterThan(5);
        expect(findLeaks({ ...pages, api: b.responses.join('\n'), out: proc.output() }, [value, rotated])).toEqual([]);
    });

    it('Edit: hernoemen waarschuwt voor de plaatshouder; de toekenning gaat mee en de proxy werkt met de nieuwe naam', async () => {
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 'edit-github_token').click();
        expect(await tid(b.page, 'secret-edit-name-warning').isHidden()).toBe(true);
        await tid(b.page, 'secret-edit-name').fill('github_pat');
        expect(await tid(b.page, 'secret-edit-name-warning').textContent()).toContain('{{secret:github_token}}');
        await tid(b.page, 'secret-edit-save').click(); await settled(b.page);
        expect(await rows().first().textContent()).toContain('github_pat');
        expect(await rows().first().textContent()).toContain('1 grant');
        toolKey = await b.page.evaluate(async () => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            const tool = (await (await globalThis.portalFetch('/api/tools')).json()).find(x => x.name === 'mytool');
            return (await (await globalThis.portalFetch(`/api/tools/${tool.id}/rotate`, { method: 'POST', headers: h })).json()).key;
        });
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/user`, { headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:github_pat}}' } });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${rotated}`);
    });

    it('Delete: de toekenningen die meegaan staan erbij; het secret verdwijnt', async () => {
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 'revoke-github_pat').click();
        expect(await tid(b.page, 'ask-question').textContent()).toContain('github_pat');
        expect(await tid(b.page, 'ask-question').textContent()).toMatch(/cannot be undone|kan niet ongedaan/i);
        expect(await tid(b.page, 'ask-warning').textContent()).toContain('mytool → github_pat');
        await answerAsk(b.page);
        expect(await rows().count()).toBe(0);
        expect(await tid(b.page, 'secrets-empty').count()).toBe(1);
    });

    it('4.22: MOET weigeren: een Login-secret zonder wachtwoord opslaan', async () => {
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-pick-login').click();
        await tid(b.page, 's-name').fill('bad_login');
        await tid(b.page, 's-hosts').fill(upstream.origin);
        await tid(b.page, 's-username').fill('admin');
        await tid(b.page, 's-add').click();
        await tid(b.page, 'message').filter({ hasText: 'INVALID_VALUE' }).waitFor();
        await b.page.keyboard.press('Escape');
        await expect.poll(() => tid(b.page, 's-username').inputValue()).toBe('');
        await tid(b.page, 's-name').fill('');
    });

    it('4.22: een Login toevoegen toont soort Login met icoon #i-user, zonder waarde in het portaal', async () => {
        const loginPass = fakeSecret('loginpass');
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-pick-login').click();
        await tid(b.page, 's-name').fill('jira_login');
        await tid(b.page, 's-hosts').fill(upstream.origin);
        await tid(b.page, 's-username').fill('agent@example.com');
        await tid(b.page, 's-password').fill(loginPass);
        expect(await tid(b.page, 's-password').getAttribute('type')).toBe('password');
        await tid(b.page, 's-password-reveal').click();
        expect(await tid(b.page, 's-password').getAttribute('type')).toBe('text');
        await tid(b.page, 's-sensitive').uncheck();
        await tid(b.page, 's-add').click();
        await settled(b.page);

        expect(await rows().count()).toBe(1);
        const row = b.page.locator('[data-testid="secret-row-jira_login"]');
        expect(await row.textContent()).toContain('jira_login');
        expect(await row.locator('.row-icon use').getAttribute('href')).toBe('#i-user');
        const detailText = await detail().textContent();
        expect(detailText).toMatch(/Login\./i);
        expect(detailText).not.toContain(loginPass);

        // Geen van beide waarden lekt in de DOM of responses
        const content = await b.page.content();
        expect(findLeaks({ page: content }, [loginPass])).toEqual([]);

        // 4.22: proxy vult {{basic:jira_login}} in met base64(username:password)
        await b.page.evaluate(async origin => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            const tool = (await (await globalThis.portalFetch('/api/tools')).json()).find(x => x.name === 'mytool');
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'jira_login', host: origin }) });
        }, upstream.origin);

        const expectedBasic = Buffer.from(`agent@example.com:${loginPass}`).toString('base64');
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/api`, {
            headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Basic {{basic:jira_login}}' },
        });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Basic ${expectedBasic}`);

        // Opruimen
        await tid(b.page, 'revoke-jira_login').click();
        await answerAsk(b.page);
        await settled(b.page);
    });
});
