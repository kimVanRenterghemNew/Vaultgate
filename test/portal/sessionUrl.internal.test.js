// Eenmalige sessie-URL vanuit de tray naar het portaal (CPS-optie).
// Alleen als de kluis al ontgrendeld is; een kortlevend kaartje in het hash-fragment (#session=...),
// zonder geheimen in de URL. Het kaartje is eenmalig bruikbaar en vervalt na 30 s.
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/composition.js';
import { createPortalSessions } from '../../src/portal/sessions.js';
import { tempHome, seedVault, PASSPHRASE } from '../helpers/journey.js';
import { openBrowser, tid } from '../helpers/browser.js';

describe('eenmalige sessie-URL vanuit tray naar portaal (9.10 CPS)', () => {
    it('gesloten kluis: de tray opent het portaal zonder sessiekaartje in de URL', async () => {
        const home = tempHome();
        await seedVault(home);
        const opened = [];
        const app = createApp({
            home, proxyPort: 0, portalPort: 0, tray: 'none', window: 'custom',
            openWindow: args => { opened.push(args); return { browser: 'edge', extensions: [] }; },
        });
        const { portalPort } = await app.start();
        try {
            expect(app.vault.isUnlocked()).toBe(false);
            app.openPortal();
            expect(opened.length).toBe(1);
            expect(opened[0].url).toBe(`http://localhost:${portalPort}/`);
            expect(opened[0].url).not.toContain('#session=');
        } finally {
            await app.stop();
        }
    });

    it('geopende kluis: eenmalig kaartje in het hash-fragment, inwisselen voor geldige sessie', async () => {
        const home = tempHome();
        await seedVault(home);
        const opened = [];
        const app = createApp({
            home, proxyPort: 0, portalPort: 0, tray: 'none', window: 'custom',
            openWindow: args => { opened.push(args); return { browser: 'edge', extensions: [] }; },
        });
        const { portalPort } = await app.start();
        try {
            await app.unlockWithPassphrase(PASSPHRASE);
            expect(app.vault.isUnlocked()).toBe(true);

            // Fetch /api/state vóór inwisselen: niet ingelogd
            const unauth = await (await fetch(`http://localhost:${portalPort}/api/state`)).json();
            expect(unauth.loggedIn).toBe(false);

            // Tray opent portaal bij geopende kluis: krijgt eenmalige sessie-URL in hash
            app.openPortal();
            expect(opened.length).toBe(1);
            const targetUrl = opened[0].url;
            expect(targetUrl).toMatch(/^http:\/\/localhost:\d+\/#session=[A-Za-z0-9_-]+$/);
            // Geen geheimen in de URL (geen passphrase, geen kluissleutel)
            expect(targetUrl).not.toContain(PASSPHRASE);

            const ticket = targetUrl.split('#session=')[1];
            expect(ticket.length).toBeGreaterThan(10);

            // Wissel het kaartje in via POST /api/session/redeem
            const redeemRes = await fetch(`http://localhost:${portalPort}/api/session/redeem`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: `http://localhost:${portalPort}` },
                body: JSON.stringify({ ticket }),
            });
            expect(redeemRes.status).toBe(200);
            const cookie = redeemRes.headers.get('set-cookie');
            expect(cookie).toMatch(/ks_session=[A-Za-z0-9_-]+.*HttpOnly/);
            const data = await redeemRes.json();
            expect(data).toMatchObject({ loggedIn: true, unlocked: true });
            expect(data.csrf).toBeTruthy();

            // Met dit cookie en token is het portaal ingelogd
            const stateRes = await fetch(`http://localhost:${portalPort}/api/state`, {
                headers: { cookie: cookie.split(';')[0], 'x-csrf-token': data.csrf },
            });
            expect(stateRes.status).toBe(200);
            const state = await stateRes.json();
            expect(state.loggedIn).toBe(true);
            expect(state.unlocked).toBe(true);

            // MOET weigeren: hetzelfde kaartje een tweede keer inwisselen faalt (eenmalig)
            const replayRes = await fetch(`http://localhost:${portalPort}/api/session/redeem`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: `http://localhost:${portalPort}` },
                body: JSON.stringify({ ticket }),
            });
            expect(replayRes.status).toBe(401);
        } finally {
            await app.stop();
        }
    });

    it('MOET weigeren: een verzonnen ticket of inwisselen terwijl de kluis vergrendeld is', async () => {
        const home = tempHome();
        await seedVault(home);
        const opened = [];
        const app = createApp({
            home, proxyPort: 0, portalPort: 0, tray: 'none', window: 'custom',
            openWindow: args => { opened.push(args); return { browser: 'edge', extensions: [] }; },
        });
        const { portalPort } = await app.start();
        try {
            await app.unlockWithPassphrase(PASSPHRASE);
            app.openPortal();
            const ticket = opened[0].url.split('#session=')[1];

            // Verzonnen kaartje
            const fake = await fetch(`http://localhost:${portalPort}/api/session/redeem`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: `http://localhost:${portalPort}` },
                body: JSON.stringify({ ticket: 'fake-ticket-123' }),
            });
            expect(fake.status).toBe(401);

            // Kluis vergrendelen tussen aanmaken en inwisselen
            app.vault.lock();
            expect(app.vault.isUnlocked()).toBe(false);

            const lockedRedeem = await fetch(`http://localhost:${portalPort}/api/session/redeem`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: `http://localhost:${portalPort}` },
                body: JSON.stringify({ ticket }),
            });
            expect(lockedRedeem.status).toBe(401);
        } finally {
            await app.stop();
        }
    });

    it('browser: met #session=<ticket> logt de browser automatisch in en toont direct view-main', async () => {
        const home = tempHome();
        await seedVault(home);
        const opened = [];
        const app = createApp({
            home, proxyPort: 0, portalPort: 0, tray: 'none', window: 'custom',
            openWindow: args => { opened.push(args); return { browser: 'edge', extensions: [] }; },
        });
        const { portalPort } = await app.start();
        const b = await openBrowser();
        try {
            await app.unlockWithPassphrase(PASSPHRASE);
            app.openPortal();
            const targetUrl = opened[0].url;
            expect(targetUrl).toContain(`:${portalPort}/`);

            await b.page.goto(targetUrl);
            await tid(b.page, 'view-main').waitFor({ state: 'visible' });
            expect(await b.page.evaluate(() => globalThis.location.hash)).toBe('');
            expect(await b.page.evaluate(() => Boolean(globalThis.sessionStorage.getItem('vaultgate.session')))).toBe(true);
        } finally {
            await b.close();
            await app.stop();
        }
    });

    it('createPortalSessions: kaartje verloopt na 30 s en wordt opgeruimd bij nieuw kaartje', () => {
        let time = 1000;
        const sessions = new Map();
        const crypto = { randomToken: () => 'tok-' + ++time };
        const clock = { now: () => time };
        const ps = createPortalSessions({ sessions, crypto, clock, audit: { append: async () => {} }, idleMs: () => 10_000, maxSessionMs: 60_000 });
        const t1 = ps.createTicket();
        time += 31_000;
        const dummyRes = { setHeader: () => {} };
        expect(ps.redeemTicket(t1, dummyRes)).toBeNull();
        const t2 = ps.createTicket();
        expect(ps.redeemTicket(t2, dummyRes)).toBeTruthy();
        expect(ps.redeemTicket('onbekend', dummyRes)).toBeNull();
    });
});
