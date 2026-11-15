// De API van het portaal zonder browser: sessies, CSRF, foutcodes, grenzen. Wat in de browser-journeys niet langskomt,
// maar wel standaard dicht moet zijn. In-process (createApp) met echte HTTP; de klok is instelbaar voor de sessieduur.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { createApp } from '../../src/composition.js';
import { MIN_KDF } from '../../src/crypto/index.js';
import { tempHome } from '../helpers/journey.js';
import { fixedPort } from '../helpers/fixedPort.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';

let app;
let portal;
let now;
let events;
const clock = { now: () => now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };

beforeEach(async () => {
    now = Date.now();
    events = [];
    app = createApp({ home: tempHome(), proxyPort: 0, portalPort: 0, tray: 'none', window: 'none', kdf: MIN_KDF, clock, log: e => events.push(e) });
    const ports = await app.start();
    portal = `http://localhost:${ports.portalPort}`;
});
afterEach(() => app.stop());

function client() {
    let cookie = '';
    let csrf = null;
    let key = null; // met een software-passkey: een gevraagde aanraking volgt vanzelf (zoals de pagina)
    const call = async (method, path, body, opts = {}) => {
        const first = await send(method, path, body, opts);
        if (!key || first.data?.error?.code !== 'STEP_UP_REQUIRED') return first;
        return send(method, path, { ...body, stepUp: key.assert({ challenge: first.data.error.stepUp.challenge, origin: portal }) }, opts);
    };
    const send = async (method, path, body, { json = true, headers = {} } = {}) => {
        const h = { ...headers };
        if (cookie) h.cookie = cookie;
        if (method !== 'GET' && json) h['content-type'] = 'application/json';
        if (csrf && !('x-csrf-token' in headers)) h['x-csrf-token'] = csrf;
        const res = await fetch(`${portal}${path}`, { method, headers: h, body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body ?? {})) });
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
        if (data?.csrf) csrf = data.csrf;
        return { status: res.status, data, res };
    };
    /** Eerst zonder aanraking (MOET STEP_UP_REQUIRED geven), dan met een assertion van `key` op de gegeven challenge. */
    const touched = async (method, path, body, key) => {
        const first = await call(method, path, body);
        expect(first.data.error?.code).toBe('STEP_UP_REQUIRED');
        return call(method, path, { ...body, stepUp: key.assert({ challenge: first.data.error.stepUp.challenge, origin: portal }) });
    };
    /** Een software-passkey in de kluis zetten en voortaan gebruiken voor elke gevraagde aanraking. */
    const useKey = async () => { key = createSoftAuthenticator(); await app.vault.addCredential(key.credential); };
    return { call, touched, useKey, get cookie() { return cookie; } };
}

describe('portaal-API', () => {
    it('de pagina: CSP met een nonce per response, geen inline-script zonder nonce, beveiligingsheaders', async () => {
        const res = await fetch(`${portal}/`);
        const csp = res.headers.get('content-security-policy');
        const nonce = /'nonce-([^']+)'/.exec(csp)[1];
        const html = await res.text();
        expect(html).toContain(`<script nonce="${nonce}">`);
        expect(html.match(/<script/g)).toHaveLength(1);
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain('font-src data:'); // het lettertype staat in de pagina zelf, nooit van buiten
        expect(csp).not.toMatch(/font-src[^;]*(https?:|'self'|\*)/);
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        const again = (await fetch(`${portal}/`)).headers.get('content-security-policy');
        expect(again).not.toBe(csp);
    });

    it('Given de soort passkey When de opties gevraagd worden Then stuurt de server de juiste hint (telefoon = meteen de QR-code)', async () => {
        const c = client();
        const options = async attachment => (await c.call('POST', '/api/setup/passkey/options', { attachment })).data.options;
        const phone = await options('phone');
        expect(phone.hints).toEqual(['hybrid']);
        expect(phone.authenticatorSelection.authenticatorAttachment).toBe('cross-platform');
        expect((await options('security-key')).hints).toEqual(['security-key']);
        expect((await options('platform')).hints).toEqual(['client-device']);
        // MOET afwijzen: een onbekende soort geeft geen hint en geen beperking, in plaats van een verzonnen waarde
        const unknown = await options('anything');
        expect(unknown.hints ?? []).toEqual([]);
        expect(unknown.authenticatorSelection.authenticatorAttachment).toBeUndefined();
    });

    it('MOET weigeren: een vervalste registratie met een echte challenge maakt geen kluis, en de challenge is daarna op', async () => {
        const c = client();
        const { options } = (await c.call('POST', '/api/setup/passkey/options', { attachment: 'phone' })).data;
        const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: portal, crossOrigin: false })).toString('base64url');
        const forged = { id: 'AAAA', rawId: 'AAAA', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON, attestationObject: 'AAAA', transports: ['hybrid'] } };
        const first = await c.call('POST', '/api/setup/passkey/verify', { response: forged });
        expect(first.status).toBe(401);
        expect(JSON.stringify(first.data)).toContain('WEBAUTHN_FAILED');
        expect((await c.call('POST', '/api/setup/passkey/verify', { response: forged })).status).toBe(401); // eenmalig
        expect((await c.call('GET', '/api/state')).data.vaultExists).toBe(false);
    });

    it('MOET weigeren: een PRF-antwoord zonder passkey die erop wacht', async () => {
        const c = client();
        const r = await c.call('POST', '/api/setup/passkey/prf', { response: {}, prfOutput: 'AAAA' });
        expect(r.status).toBe(404);
        expect(JSON.stringify(r.data)).toContain('NOT_FOUND');
        expect((await c.call('GET', '/api/state')).data.vaultExists).toBe(false);
    });

    it('eerste opzet: alleen zolang er geen kluis is; geeft een sessie en een herstelcode', async () => {
        const c = client();
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ vaultExists: false, loggedIn: false });
        const setup = await c.call('POST', '/api/setup', { passphrase: 'p' });
        expect(setup.status).toBe(200);
        expect(setup.data.recoveryCode).toMatch(/-/);
        expect(c.cookie).toMatch(/^ks_session=/);
        expect(setup.res.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ vaultExists: true, unlocked: true, loggedIn: true, needsMorePasskeys: true });
        expect((await client().call('POST', '/api/setup', { passphrase: 'q' })).status).toBe(409);
    });

    it('MOET weigeren: geen JSON, ongeldige JSON, te groot, onbekende route, geen CSRF-token', async () => {
        const c = client();
        expect((await c.call('POST', '/api/setup', 'passphrase=x', { json: false })).status).toBe(403);
        expect((await c.call('POST', '/api/setup', '{kapot')).status).toBe(400);
        expect((await c.call('POST', '/api/setup', JSON.stringify({ p: 'x'.repeat(70_000) }))).status).toBe(413);
        expect((await c.call('GET', '/api/bestaat-niet')).status).toBe(404);
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        expect((await c.call('POST', '/api/lock', {}, { headers: { 'x-csrf-token': 'fout' } })).status).toBe(403);
        expect(app.vault.isUnlocked()).toBe(true);
    });

    it('Lock sluit de portalsessie en laat de kluis open; ontsluiten kan opnieuw via de bootstrap-login', async () => {
        expect((await client().call('GET', '/api/secrets')).status).toBe(401);
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        const locked = await c.call('POST', '/api/lock');
        expect(locked.data).toEqual({ loggedIn: false, unlocked: true });
        expect(app.vault.isUnlocked()).toBe(true);
        expect((await c.call('GET', '/api/secrets')).status).toBe(401);
        expect((await c.call('POST', '/api/unlock', { passphrase: 'fout' })).status).toBe(401);
        now += 2_000; // foutieve passphrase start een korte backoff
        expect((await c.call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(200);
        expect((await c.call('GET', '/api/secrets')).data).toEqual([]);
        expect((await app.audit.read()).map(entry => entry.rule)).toContain('portal-locked');
    });

    it('zodra er een passkey is: ontgrendelen zonder sessie kan niet meer (alleen inloggen met FIDO2)', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.vault.addCredential({ id: 'cred-1', publicKey: 'pk', counter: 0, transports: [] });
        await c.call('POST', '/api/logout');
        expect((await client().call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(401);
        expect((await c.call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(401); // Lock/log out heeft de sessie gesloten
    });

    it('Given automatisch vergrendelen na 30 min When de instelling bewaard wordt Then geldt ze meteen voor de sessie en de afteller, zonder herladen; daarna een Lock, de kluis blijft open', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey(); // een langere vergrendeltijd vraagt een aanraking
        expect((await c.call('GET', '/api/state')).data.lockInMs).toBe(15 * 60_000);
        expect((await c.call('PUT', '/api/settings', { autoLockMs: 30 * 60_000 })).status).toBe(200);
        expect((await c.call('GET', '/api/state')).data.lockInMs).toBe(30 * 60_000);
        now += 29 * 60_000;
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ loggedIn: true, unlocked: true });
        now += 31 * 60_000;
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ loggedIn: false, unlocked: true, lockInMs: 0 });
        now += 24 * 3_600_000;
        expect(app.vault.isUnlocked()).toBe(true);
    });

    it('Given een sessie die bijna haar maximale duur (2 u) bereikt When de afteller gevraagd wordt Then toont ze de kortste van de twee', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey();
        await c.call('PUT', '/api/settings', { autoLockMs: 60 * 60_000 });
        for (let i = 0; i < 3; i++) { now += 30 * 60_000; await c.call('GET', '/api/state'); }
        expect((await c.call('GET', '/api/state')).data.lockInMs).toBe(30 * 60_000);
    });

    it('sessies verlopen na 15 minuten inactiviteit; afmelden wist de sessie', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        now += 14 * 60_000;
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ loggedIn: true, unlocked: true, lockInMs: 15 * 60_000 });
        now += 16 * 60_000;
        expect((await c.call('GET', '/api/state')).data).toMatchObject({ loggedIn: false, unlocked: true }); // een Lock: de kluis blijft open
        await expect.poll(async () => (await app.audit.read()).map(entry => entry.rule)).toContain('portal-locked'); // de audit van het verlopen wacht niet
        const d = client();
        await d.call('POST', '/api/recover', { recoveryCode: 'fout', newPassphrase: 'x' }).then(r => expect(r.status).toBe(401));
        const e = client();
        app.vault.lock();
        now += 2_000; // de foute herstelpoging hierboven start een backoff van 1 s (begrensde pogingen)
        // nieuwe sessie via ontgrendelen zonder passkeys (bootstrap), dan afmelden
        expect((await e.call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(200);
        await e.call('POST', '/api/logout');
        expect((await e.call('GET', '/api/state')).data.loggedIn).toBe(false);
        expect(app.vault.isUnlocked()).toBe(false);
        await app.vault.unlockWithPassphrase('p');
        await expect.poll(async () => (await app.audit.read()).map(entry => entry.rule)).toContain('vault-closed'); // ook deze audit wacht niet op het antwoord
    });

    it('WebAuthn: zonder passkeys geen login-opties; rommel als antwoord geeft 401; een PRF-uitvoer van de verkeerde lengte 400', async () => {
        const c = client();
        expect((await c.call('POST', '/api/webauthn/login/options')).status).toBe(404);
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.vault.addCredential({ id: 'cred-1', publicKey: 'pk', counter: 0, transports: [] });
        const options = await client().call('POST', '/api/webauthn/login/options');
        expect(options.status).toBe(200);
        expect(options.data.options.allowCredentials).toEqual([expect.objectContaining({ id: 'cred-1' })]);
        expect((await client().call('POST', '/api/webauthn/login/verify', { response: { id: 'cred-1', response: { clientDataJSON: 'xx' } } })).status).toBe(401);
        expect((await c.call('POST', '/api/webauthn/register/verify', { response: {}, prfOutput: 'kort' })).status).toBe(400);
        expect((await c.call('POST', '/api/webauthn/register/verify', { response: {} })).status).toBe(401);
        expect((await c.call('POST', '/api/webauthn/prf-enroll/options', { credentialId: 'onbekend' })).status).toBe(404);
        const enroll = await c.call('POST', '/api/webauthn/prf-enroll/options', { credentialId: 'cred-1', prfSalt: 'c2FsdA' });
        expect(enroll.data.prfSalts).toEqual({ 'cred-1': 'c2FsdA' });
        expect((await c.call('POST', '/api/webauthn/prf-enroll/verify', { response: {} })).status).toBe(401);
        // Een passkey erbij vraagt een aanraking van een bestaande (step-up); hier een software-passkey naast cred-1.
        const key = createSoftAuthenticator();
        await app.vault.addCredential(key.credential);
        const reg = await c.touched('POST', '/api/webauthn/register/options', {}, key);
        expect(reg.data.prfSalt).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(reg.data.options.excludeCredentials).toEqual([expect.objectContaining({ id: 'cred-1' }), expect.objectContaining({ id: key.credential.id })]);
    });

    it('passkeys oplijsten en verwijderen; de laatste blijft', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.vault.addCredential({ id: 'a', publicKey: 'pa', counter: 0 });
        await app.vault.addCredential({ id: 'b', publicKey: 'pb', counter: 0 });
        await app.vault.addPasskey({ credentialId: 'a', prfOutput: Buffer.alloc(32, 1) });
        expect((await c.call('GET', '/api/passkeys')).data.map(p => [p.id, p.prf])).toEqual([['a', true], ['b', false]]);
        expect((await c.call('DELETE', '/api/passkeys/a')).status).toBe(200);
        expect((await c.call('DELETE', '/api/passkeys/b')).status).toBe(409);
    });

    it('passkey-blokkades tellen niet mee voor login; de laatste passkey blokkeren MOET geweigerd worden', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.vault.addCredential({ id: 'a', publicKey: 'pa', counter: 0 });
        await app.vault.addCredential({ id: 'b', publicKey: 'pb', counter: 0 });

        const blocked = await c.call('POST', '/api/blocks', { kind: 'passkey', passkeyId: 'a', durationMs: 60_000 });
        expect(blocked.status).toBe(200);

        const login = await c.call('POST', '/api/webauthn/login/options');
        expect(login.status).toBe(200);
        expect(login.data.options.allowCredentials.map(c => c.id)).toEqual(['b']);

        const last = await c.call('POST', '/api/blocks', { kind: 'passkey', passkeyId: 'b', durationMs: 60_000 });
        expect(last.status).toBe(409);
        expect(last.data.error.code).toBe('LAST_PASSKEY');
    });

    it('MOET weigeren: een handeling die een aanraking vraagt terwijl geen passkey ze mag geven (alleen intern, instelling extern); terug naar "any" kan wel', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        const key = createSoftAuthenticator(); // transport 'internal'
        await app.vault.addCredential(key.credential);
        expect((await c.call('PUT', '/api/settings', { touchAuthenticator: 'external' })).status).toBe(200); // minder toelaten
        const refused = await c.call('POST', '/api/tools', { name: 'nieuw' });
        expect(refused.status).toBe(409);
        expect(refused.data.error).toMatchObject({ code: 'STEP_UP_UNAVAILABLE', rule: 'step-up-unavailable' });
        expect((await c.call('GET', '/api/tools')).data).toEqual([]);
        expect((await c.touched('PUT', '/api/settings', { touchAuthenticator: 'any' }, key)).status).toBe(200);
        expect((await c.touched('POST', '/api/tools', { name: 'nieuw' }, key)).status).toBe(200);
    });

    it('elke blokkade en opheffing van een passkey komt in de audit', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.vault.addCredential({ id: 'a', publicKey: 'pa', counter: 0 });
        const key = createSoftAuthenticator();
        await app.vault.addCredential(key.credential);

        const create = await c.call('POST', '/api/blocks', { kind: 'passkey', passkeyId: 'a', durationMs: 60_000 });
        expect(create.status).toBe(200);
        // Opheffen laat meer toe: een aanraking (met de passkey die niet geblokkeerd is).
        expect((await c.touched('DELETE', `/api/blocks/${create.data.id}`, {}, key)).status).toBe(200);

        const entries = await app.audit.read({ limit: 10 });
        expect(entries.some(e => e.rule === 'passkey-blocked')).toBe(true);
        expect(entries.some(e => e.rule === 'passkey-unblocked')).toBe(true);
    });

    it('rustige uren: geldige vensters (ook over middernacht) bewaard; MOET weigeren: een ongeldig venster (400, niets veranderd)', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        expect((await c.call('PUT', '/api/settings', { quietHours: ['23:00-07:00', '12:00-13:00'] })).status).toBe(200);
        const bad = await c.call('PUT', '/api/settings', { quietHours: ['23:00-07:00', '12:00-13:00', '25:00-07:00'] });
        expect(bad.status).toBe(400);
        expect(bad.data.error.code).toBe('INVALID_QUIET_HOURS');
        expect((await c.call('GET', '/api/settings')).data.quietHours).toEqual(['23:00-07:00', '12:00-13:00']);
    });

    it('instellingen, wachtende goedkeuringen, foutcodes van de registry', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey();
        expect((await c.call('GET', '/api/settings')).data).toMatchObject({ approvalTimeoutMs: 30_000 });
        expect((await c.call('PUT', '/api/settings', { approvalTimeoutMs: 5000 })).data.approvalTimeoutMs).toBe(5000);
        expect((await c.call('PUT', '/api/settings', { approvalTimeoutMs: 1 })).status).toBe(400);
        expect((await c.call('GET', '/api/approvals')).data).toEqual([]);
        expect((await c.call('POST', '/api/secrets', { name: 'a', value: 'v', hosts: ['a.example'] })).status).toBe(200);
        expect((await c.call('POST', '/api/secrets', { name: 'a', value: 'v', hosts: ['a.example'] })).status).toBe(409);
        expect((await c.call('DELETE', '/api/grants/0123abcd')).status).toBe(404);
        const tool = await c.call('POST', '/api/tools', { name: 'mytool' });
        expect((await c.call('PUT', `/api/tools/${tool.data.id}/clients`, { clients: ['10.0.0.0/8'] })).status).toBe(200);
        expect((await c.call('GET', '/api/tools')).data[0].clients).toEqual(['10.0.0.0/8']);
        expect((await c.call('DELETE', `/api/tools/${tool.data.id}`)).status).toBe(200);
        const secrets = await c.call('GET', '/api/secrets');
        expect((await c.call('PUT', `/api/secrets/${secrets.data[0].id}/hosts`, { hosts: ['b.example'] })).status).toBe(200);
        expect((await c.call('GET', '/api/audit?decision=deny&limit=5')).data).toEqual([]);
    });

    it('past extra proxy-luisteradressen toe, slaat duplicaten over en meldt een bezette poort', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey();
        const reserve = () => new Promise(resolve => {
            const server = net.createServer();
            server.listen(0, '127.0.0.1', () => resolve(server));
        });
        const occupied = await reserve();
        const freePort = await fixedPort();
        const occupiedPort = occupied.address().port;
        const listeners = [
            { host: '127.0.0.1', port: freePort },
            { host: '127.0.0.1', port: occupiedPort },
        ];
        try {
            expect((await c.call('PUT', '/api/settings', { listeners })).status).toBe(200);
            expect(events).toContainEqual({ event: 'listening-extra', host: '127.0.0.1', port: freePort });
            expect(events).toContainEqual(expect.objectContaining({ event: 'listen-failed', code: 'EADDRINUSE', port: occupiedPort }));
            await c.call('PUT', '/api/settings', { listeners });
            expect(events.filter(e => e.event === 'listening-extra')).toHaveLength(1);
        } finally {
            await new Promise(resolve => occupied.close(resolve));
        }
    });
});

describe('portaal-API: de tellers van vandaag (dashboard)', () => {
    it('Given doorgelaten, tegengehouden en gescrubde calls van vandaag en gisteren When /api/stats Then alleen vandaag, met het aantal tools en secrets', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await app.audit.append({ tool: 'oud', secret: 's0', allow: true, rule: 'granted' }); // vóór middernacht
        now += 1000;
        const midnight = now;
        await app.audit.append({ tool: 'a', secret: 's1', allow: true, rule: 'granted' });
        await app.audit.append({ tool: 'b', secret: 's2', allow: true, rule: 'approved-once' });
        await app.audit.append({ tool: 'a', secret: 's1', allow: false, rule: 'target-host-not-allowed' });
        await app.audit.append({ tool: 'a', secret: 's1', allow: false, rule: 'response-scrubbed', count: 3 });
        const { status, data } = await c.call('GET', `/api/stats?since=${midnight}`);
        expect(status).toBe(200);
        expect(data).toEqual({ allowed: 2, stopped: 1, scrubbed: 3, tools: 2, secrets: 2 });
    });

    it('MOET weigeren: zonder sessie', async () => {
        expect((await client().call('GET', '/api/stats')).status).toBe(401);
    });
});

describe('portaal-API: review 2026-10-09 (bevindingen 2 en 3)', () => {
    it('na herstel met de herstelcode zijn alle andere sessies ongeldig (401)', async () => {
        const a = client();
        const { data } = await a.call('POST', '/api/setup', { passphrase: 'p' });
        expect((await a.call('GET', '/api/secrets')).status).toBe(200);
        const b = client();
        expect((await b.call('POST', '/api/recover', { recoveryCode: data.recoveryCode, newPassphrase: 'nieuw' })).status).toBe(200);
        expect((await a.call('GET', '/api/secrets')).status).toBe(401);
        expect((await b.call('GET', '/api/secrets')).status).toBe(200);
    });

    it('na het verwijderen van een passkey zijn alle andere sessies ongeldig; de sessie die verwijderde, blijft', async () => {
        const a = client();
        await a.call('POST', '/api/setup', { passphrase: 'p' });
        app.vault.lock();
        const b = client(); // tweede sessie: ontgrendelen zonder passkeys (eerste opzet)
        expect((await b.call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(200);
        await app.vault.addCredential({ id: 'x', publicKey: 'px', counter: 0 });
        await app.vault.addCredential({ id: 'y', publicKey: 'py', counter: 0 });
        expect((await a.call('DELETE', '/api/passkeys/x')).status).toBe(200);
        expect((await b.call('GET', '/api/secrets')).status).toBe(401);
        expect((await a.call('GET', '/api/secrets')).status).toBe(200);
    });

    it('MOET weigeren: twee gelijktijdige passphrase-pogingen zonder sessie; de tweede krijgt 429', async () => {
        const setup = client();
        await setup.call('POST', '/api/setup', { passphrase: 'p' });
        app.vault.lock();
        const [x, y] = await Promise.all([client().call('POST', '/api/unlock', { passphrase: 'fout1' }), client().call('POST', '/api/unlock', { passphrase: 'fout2' })]);
        expect([x.status, y.status].sort()).toEqual([401, 429]);
        expect([x, y].find(r => r.status === 429).data.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('na een mislukte poging zonder sessie volgt een korte wachttijd (backoff), daarna lukt het', async () => {
        const setup = client();
        await setup.call('POST', '/api/setup', { passphrase: 'p' });
        app.vault.lock();
        expect((await client().call('POST', '/api/unlock', { passphrase: 'fout' })).status).toBe(401);
        const tooSoon = await client().call('POST', '/api/unlock', { passphrase: 'p' });
        expect(tooSoon.status).toBe(429);
        expect(tooSoon.data.error.retryAfterMs).toBeGreaterThan(0);
        now += 2_000;
        expect((await client().call('POST', '/api/unlock', { passphrase: 'p' })).status).toBe(200);
    });
});

describe('portaal-API: begeleide eerste keer', () => {
    it('de toestand noemt de proxy-poort (voor het configuratievoorbeeld)', async () => {
        const c = client();
        expect((await c.call('GET', '/api/state')).data.proxyPort).toBeGreaterThan(0);
    });

    it('controle zonder echte call: welke regel zou een call van deze tool met dit secret krijgen', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.call('POST', '/api/secrets', { name: 'demo', value: 'v', hosts: ['api.example.com'] });
        // MOET weigeren: met alleen een passphrase is er geen hard bewijs voor een gevoelige wijziging
        expect((await c.call('POST', '/api/tools', { name: 'mytool' })).data.error).toMatchObject({ code: 'STEP_UP_UNAVAILABLE', rule: 'step-up-unavailable' });
        await c.useKey();
        const tool = (await c.call('POST', '/api/tools', { name: 'mytool' })).data;
        expect((await c.call('POST', '/api/check', { toolId: tool.id, secretName: 'demo' })).data).toEqual({ rule: 'needs-approval', host: 'https://api.example.com' });
        await c.call('POST', '/api/grants', { toolId: tool.id, secretName: 'demo', host: 'https://api.example.com' });
        expect((await c.call('POST', '/api/check', { toolId: tool.id, secretName: 'demo' })).data).toEqual({ rule: 'granted', host: 'https://api.example.com' });
        expect((await c.call('POST', '/api/check', { toolId: tool.id, secretName: 'bestaat_niet' })).data).toEqual({ rule: 'unknown-secret', host: null });
        await c.call('POST', `/api/tools/${tool.id}/revoke`);
        expect((await c.call('POST', '/api/check', { toolId: tool.id, secretName: 'demo' })).data.rule).toBe('tool-key-revoked'); // eerste regel wint
        expect((await c.call('POST', '/api/check', { toolId: 'onbekend', secretName: 'demo' })).status).toBe(404);
    });

    it('MOET weigeren: "always" voor een handmatige key (roteert niet); zonder keuze hoogstens 4 uur; "elke keer vragen" mag zonder einde', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey();
        await c.call('POST', '/api/secrets', { name: 'demo', value: 'v', hosts: ['api.example.com'] });
        const tool = (await c.call('POST', '/api/tools', { name: 'manual' })).data;
        const always = await c.call('POST', '/api/grants', { toolId: tool.id, secretName: 'demo', host: 'https://api.example.com', durationMs: 0 });
        expect(always.status).toBe(400);
        expect(always.data.error).toMatchObject({ rule: 'grant-always-needs-rotating-key' });
        expect((await c.call('GET', '/api/grants')).data).toEqual([]);
        await c.call('POST', '/api/grants', { toolId: tool.id, secretName: 'demo', host: 'https://api.example.com' });
        const [grant] = (await c.call('GET', '/api/grants')).data;
        expect(grant.expiresAt).toBe(now + 4 * 3_600_000);
        expect((await c.call('PUT', `/api/grants/${grant.id}`, { durationMs: 0 })).data.error).toMatchObject({ rule: 'grant-always-needs-rotating-key' });
        expect((await c.call('PUT', `/api/grants/${grant.id}`, { mode: 'confirm', durationMs: 0 })).status).toBe(200);
    });

    it('tls endpoints: /api/tls/trusted, /api/tls/added-roots, /api/tls/revoke', async () => {
        const c = client();
        await c.call('POST', '/api/setup', { passphrase: 'p' });
        await c.useKey();
        expect((await c.call('GET', '/api/tls/trusted')).data).toEqual([]);
        expect((await c.call('GET', '/api/tls/added-roots')).data).toEqual([]);
        expect((await c.call('POST', '/api/tls/revoke', { origin: 'https://none.example' })).data).toEqual({ revoked: true });
        expect((await c.call('POST', '/api/tls/revoke', { root: 'ROOT_NONE' })).data).toEqual({ revoked: true });
    });
});
