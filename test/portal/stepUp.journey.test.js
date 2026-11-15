// Wat meer toelaat, vraagt een verse aanraking van een passkey (step-up). Het echte proces, een software-passkey in de
// kluis en de portaal-API zoals de pagina ze gebruikt: zonder aanraking geweigerd met de naam van de regel, met een
// aanraking op precies die handeling toegestaan; wat minder toelaat, slaagt meteen. Een gestolen sessiecookie alleen
// opent geen sessie: het token van de pagina hoort erbij. In de browser vraagt dezelfde knop de passkey zelf.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';
import { openBrowser, setupPortal, addGrant, tid, settled } from '../helpers/browser.js';

const value = fakeSecret('stepup');

/** Een portaalclient zoals de pagina: cookie plus token, en een aanraking met de software-passkey als erom gevraagd wordt. */
function portalClient(portal, key) {
    let cookie = '';
    let token = null;
    async function raw(method, p, body, { withToken = true } = {}) {
        const headers = { origin: portal, ...(cookie ? { cookie } : {}), ...(withToken && token ? { 'x-csrf-token': token } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) };
        const res = await fetch(`${portal}${p}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const data = await res.json();
        if (data?.csrf) token = data.csrf;
        return { status: res.status, data };
    }
    /** Met aanraking: eerst zonder, dan met een assertion op de challenge die het portaal voor deze handeling gaf. */
    async function touched(method, p, body) {
        const first = await raw(method, p, body);
        if (first.data?.error?.code !== 'STEP_UP_REQUIRED') return { first, second: null };
        const stepUp = key.assert({ challenge: first.data.error.stepUp.challenge, origin: portal });
        return { first, second: await raw(method, p, { ...body, stepUp }) };
    }
    async function login() {
        const { data } = await raw('POST', '/api/webauthn/login/options');
        return raw('POST', '/api/webauthn/login/verify', { response: key.assert({ challenge: data.options.challenge, origin: portal }) });
    }
    return { raw, touched, login, get cookie() { return cookie; } };
}

describe.each(MODES)('portaal: aanraking voor wat meer toelaat, %s', (mode, start) => {
    let proc;
    let key;
    let c;
    let ids;
    let trayLog;
    const outputs = [];

    beforeAll(async () => {
        const home = tempHome();
        trayLog = path.join(home, 'tray.log');
        key = createSoftAuthenticator();
        ids = await seedVault(home, async ({ vault, registry }) => {
            await vault.addCredential(key.credential);
            await vault.addPasskey({ credentialId: key.credential.id, prfOutput: Buffer.alloc(32, 7) });
            const secret = await registry.addSecret({ name: 'gh', value, hosts: ['https://api.github.com'] });
            const { id: tool } = await registry.addTool({ name: 'agent' });
            const grant = await registry.addGrant({ toolId: tool, secretName: 'gh', host: 'https://api.github.com', origin: 'portal' });
            return { secret, tool, grant };
        });
        proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_LOG: trayLog } });
        c = portalClient(proc.portal, key);
        expect((await c.login()).status).toBe(200);
    });
    afterAll(() => proc?.stop());

    it('Given een sessie zonder aanraking When een nieuwe passkey registreren Then geweigerd tot een bestaande kluissleutel is aangeraakt; daarna een melding in de tray en new-passkey-added in de audit', async () => {
        const refused = await c.raw('POST', '/api/webauthn/register/options', {});
        expect(refused.status).toBe(403);
        expect(refused.data.error).toMatchObject({ code: 'STEP_UP_REQUIRED', rule: 'step-up-passkey-register' });
        expect(refused.data.error.stepUp.allowCredentials.map(k => k.id)).toEqual([key.credential.id]);
        expect(refused.data.options).toBeUndefined(); // geen registratie-challenge zonder aanraking

        const other = createSoftAuthenticator();
        const { second } = await c.touched('POST', '/api/webauthn/register/options', {});
        expect(second.status).toBe(200);
        const verified = await c.raw('POST', '/api/webauthn/register/verify', { response: other.register({ challenge: second.data.options.challenge, origin: proc.portal }) });
        expect(verified.status).toBe(200);
        expect(verified.data.registered).toBe(true);

        const audit = await c.raw('GET', '/api/audit');
        expect(audit.data.map(e => e.rule)).toContain('new-passkey-added');
        const deadline = Date.now() + 5000;
        while (!(fs.existsSync(trayLog) && fs.readFileSync(trayLog, 'utf8').includes('"notify"')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        expect(fs.readFileSync(trayLog, 'utf8')).toMatch(/"type":"notify"/);
        outputs.push(JSON.stringify(refused.data), JSON.stringify(second.data), JSON.stringify(audit.data));
    });

    it.each([
        ['een toekenning toevoegen', 'POST', '/api/grants', () => ({ toolId: ids.tool, secretName: 'gh', host: 'https://api.github.com', durationMs: 3_600_000 }), 'step-up-grant'],
        ['een toekenning verlengen', 'PUT', () => `/api/grants/${ids.grant}`, () => ({ durationMs: 4 * 3_600_000 }), 'step-up-grant'], // een handmatige key: hoogstens 4 uur
        ['een doelhost toevoegen', 'PUT', () => `/api/secrets/${ids.secret}/hosts`, () => ({ hosts: ['https://api.github.com', 'https://evil.example'] }), 'step-up-hosts'],
        ['een virtuele key maken', 'POST', '/api/tools', () => ({ name: 'nieuw' }), 'step-up-tool-create'],
        ['een secret hernoemen', 'PUT', () => `/api/secrets/${ids.secret}/name`, () => ({ name: 'github' }), 'step-up-secret-rename'],
        ['een extra luisteradres', 'PUT', '/api/settings', () => ({ listeners: [{ host: '127.0.0.2', port: 8499 }] }), 'step-up-listeners'],
    ])('Given een sessie zonder aanraking When %s Then geweigerd met de regel, en met een aanraking toegestaan', async (_, method, p, body, rule) => {
        const where = typeof p === 'function' ? p() : p;
        const { first, second } = await c.touched(method, where, body());
        expect(first.status).toBe(403);
        expect(first.data.error).toMatchObject({ code: 'STEP_UP_REQUIRED', rule });
        expect(second.status, JSON.stringify(second.data)).toBe(200);
    });

    it('MOET weigeren: een aanraking voor een andere handeling, een andere inhoud, of een tweede keer', async () => {
        const body = { hosts: ['https://api.github.com', 'https://evil.example', 'https://evil2.example'] };
        const first = await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, body);
        const stepUp = key.assert({ challenge: first.data.error.stepUp.challenge, origin: proc.portal });
        const elsewhere = await c.raw('POST', '/api/tools', { name: 'ander', stepUp });
        expect(elsewhere.status).toBe(401);
        expect(elsewhere.data.error.code).toBe('WEBAUTHN_FAILED');

        const again = await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, body);
        const otherBody = await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, { hosts: ['https://*.example'], stepUp: key.assert({ challenge: again.data.error.stepUp.challenge, origin: proc.portal }) });
        expect(otherBody.status).toBe(401);

        const once = await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, body);
        const assertion = key.assert({ challenge: once.data.error.stepUp.challenge, origin: proc.portal });
        expect((await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, { ...body, stepUp: assertion })).status).toBe(200);
        expect((await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, { hosts: ['https://api.github.com'], stepUp: assertion })).status).toBe(200); // minder hosts: geen aanraking nodig, de oude assertion speelt geen rol
        const replay = await c.raw('PUT', `/api/secrets/${ids.secret}/hosts`, { ...body, stepUp: assertion });
        expect(replay.status).toBe(401);
    });

    it('Given een verzoek dat minder toelaat When intrekken, een toekenning verwijderen, gevoelig aanzetten Then slaagt het meteen zonder aanraking', async () => {
        const { data: tools } = await c.raw('GET', '/api/tools');
        const tool = tools.find(t => t.name === 'agent');
        expect((await c.raw('PUT', `/api/secrets/${ids.secret}/sensitive`, { sensitive: true })).status).toBe(200);
        expect((await c.raw('DELETE', `/api/grants/${ids.grant}`)).status).toBe(200);
        expect((await c.raw('POST', `/api/tools/${tool.id}/revoke`)).status).toBe(200);
        const reactivate = await c.raw('POST', `/api/tools/${tool.id}/reactivate`);
        expect(reactivate.data.error).toMatchObject({ code: 'STEP_UP_REQUIRED', rule: 'step-up-tool-reactivate' });
        const off = await c.raw('PUT', `/api/secrets/${ids.secret}/sensitive`, { sensitive: false });
        expect(off.data.error).toMatchObject({ code: 'STEP_UP_REQUIRED', rule: 'step-up-sensitive-off' });
    });

    it('MOET weigeren: alleen het sessiecookie, zonder het token van de pagina, is geen sessie', async () => {
        const stolen = { origin: proc.portal, cookie: c.cookie };
        const state = await (await fetch(`${proc.portal}/api/state`, { headers: stolen })).json();
        expect(state).toMatchObject({ loggedIn: false, csrf: null });
        expect((await fetch(`${proc.portal}/api/secrets`, { headers: stolen })).status).toBe(401);
        expect((await c.raw('GET', '/api/secrets', undefined, { withToken: false })).status).toBe(401);
        expect((await c.raw('GET', '/api/secrets')).status).toBe(200);
    });

    it('nergens een waarde in wat het portaal teruggaf of het proces logde', () => {
        expect(findLeaks({ out: proc.output(), responses: outputs.join('\n') }, [value])).toEqual([]);
    });
});

describe('portaal: aanraking in de browser', () => {
    let proc;
    let b;
    afterAll(async () => { await b?.close(); await proc?.stop(); });

    it('Given een kluis met een passkey When de gebruiker een key maakt en een toekenning toevoegt Then vraagt de pagina zelf de aanraking, en herladen houdt de sessie', async () => {
        const home = tempHome();
        proc = await MODES[1][1](home, { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        const secret = fakeSecret('stepup-browser');
        await b.page.evaluate(async v => {
            const h = { 'content-type': 'application/json', 'x-csrf-token': globalThis.sessionStorage.getItem('vaultgate.session') };
            await fetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'demo', value: v, hosts: ['https://api.example.com'] }) });
        }, secret);
        const touches = () => proc.events.filter(e => e.event === 'step-up-confirmed').length;
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'key-way-manual').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('agent');
        await tid(b.page, 't-add').click();
        await tid(b.page, 't-key-box').waitFor();
        expect(touches()).toBe(1);
        await b.page.reload();
        await tid(b.page, 'view-main').waitFor();
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await addGrant(b.page, {});
        expect(touches()).toBe(2);
        expect(await b.page.locator('[data-testid^="grant-row-"]').count()).toBe(1);
        expect(findLeaks({ ...readTree(home), out: proc.output() }, [secret])).toEqual([]);
    }, 120_000);
});
