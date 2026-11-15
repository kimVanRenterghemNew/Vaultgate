// Het echte portaal in een echte browser met een virtuele authenticator.
// Eerste opzet zonder passkey, registreren met PRF, inloggen = ontgrendelen, terugval op de passphrase zonder PRF, herstel
// met de herstelcode. Plus de verdediging: geen tweede registratie zonder sessie, CSRF, host-check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupLegacyPortal, screenshot, tid, settled, answerAsk } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

describe.each(MODES)('portaal: inloggen met FIDO2, %s', (mode, start) => {
    let proc;
    let b;
    let setup;
    const shots = mode === 'proces';

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
        setup = await setupLegacyPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('na de opzet: één passkey met PRF, en een waarschuwing dat er een tweede moet komen', async () => {
        const rows = tid(b.page, 'passkey-row');
        expect(await rows.count()).toBe(1);
        expect(await rows.first().getAttribute('data-prf')).toBe('true');
        if (shots) await screenshot(b.page, 'portal-5-passkeys');
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        // "Getting started" in de stijl van v23: een paneel, alleen de passkey gedaan, de volgende stap met één knop
        const wizard = tid(b.page, 'wizard');
        expect(await wizard.isVisible()).toBe(true);
        expect(await wizard.locator('.panel').count()).toBe(1);
        expect(await wizard.locator('.card, .steps').count()).toBe(0);
        expect(await wizard.locator('[data-step]').evaluateAll(n => n.map(x => [x.dataset.step, x.dataset.done]))).toEqual([['passkey', 'true'], ['tool', 'false'], ['secret', 'false'], ['grant', 'false']]);
        expect((await tid(b.page, 'wizard-go').textContent()).trim()).not.toBe('');
        if (shots) await screenshot(b.page, 'portal-5d-getting-started');
        expect(await tid(b.page, 'waiting-passkeys').textContent()).toContain('second');
        expect(await tid(b.page, 'passkey-warning').count()).toBe(0); // niet meer boven elk scherm
    });

    it('Given een nep-authenticator When Lock en Log out Then sluit Lock alleen de portalsessie en sluit Log out ook de kluis', async () => {
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
        await tid(b.page, 'login-go').click();
        await tid(b.page, 'view-main').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
        await tid(b.page, 'logout').click();
        await tid(b.page, 'view-login').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('locked');
        if (shots) await screenshot(b.page, 'portal-6-sign-in');
        await tid(b.page, 'login-go').click();
        await tid(b.page, 'view-main').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
    });

    it('een tweede registratie zonder sessie wordt geweigerd (401), ook met een geldige Host', async () => {
        const res = await fetch(`${proc.portal}/api/webauthn/register/options`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(401);
    });

    it('MOET weigeren: een schrijfactie zonder CSRF-token, een vreemde Origin, of een andere Host (DNS-rebinding)', async () => {
        const status = await b.page.evaluate(async () => (await fetch('/api/lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
        expect(status).toBe(403);
        const port = new URL(proc.portal).port;
        const foreign = await fetch(`${proc.portal}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{"passphrase":"x"}' });
        expect(foreign.status).toBe(403);
        const rebinding = await fetch(`http://127.0.0.1:${port}/api/state`);
        expect(rebinding.status).toBe(421);
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open'); // niets veranderd
    });

    it('zonder PRF (andere authenticator): inloggen geeft een sessie, ontgrendelen vraagt de passphrase', async () => {
        const noPrf = await b.addAuthenticator({ hasPrf: false, transport: 'usb' }); // een security key zonder PRF
        await tid(b.page, 'tab-passkeys').click(); await settled(b.page);
        // nieuwe passkey op de authenticator zonder PRF; de eerste blijft tot daarna, want een passkey erbij vraagt eerst een
        // aanraking van een bestaande (step-up). Daarna de eerste weg.
        await tid(b.page, 'pk-open').click();
        await tid(b.page, 'pk-add-external').click();
        await tid(b.page, 'passkey-row').nth(1).waitFor();
        await b.removeAuthenticator(b.authenticatorId);
        expect(await tid(b.page, 'passkey-row').nth(1).getAttribute('data-prf')).toBe('false');
        // Authentication zegt welke sleutel de kluis opent en welke alleen aanmeldt
        expect(await tid(b.page, 'passkey-row').nth(0).textContent()).toContain('opens the vault');
        expect(await tid(b.page, 'passkey-row').nth(1).textContent()).toContain('does not open the vault');
        expect(await tid(b.page, 'pk-summary').textContent()).toContain('1 key opens the vault. 1 without PRF only sign you in');
        expect(await tid(b.page, 'pk-dialog').evaluate(d => d.open)).toBe(false); // de dialoog sloot na het toevoegen
        // een eigen naam, en "laatst gebruikt" na een aanmelding
        await tid(b.page, 'passkey-row').nth(1).click();
        expect(await tid(b.page, 'passkey-detail').textContent()).toContain('cannot open the vault'); // zonder PRF: alleen aanmelden
        await tid(b.page, 'passkey-rename').click();
        await answerAsk(b.page, { value: 'YubiKey keyring' });
        expect(await tid(b.page, 'passkey-name').nth(1).textContent()).toBe('YubiKey keyring');
        expect(await tid(b.page, 'passkey-row').nth(1).textContent()).toContain('Security key');
        expect(await tid(b.page, 'passkey-row').nth(0).textContent()).toMatch(/last used/);
        if (shots) await screenshot(b.page, 'portal-5c-authentication');
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        expect(await tid(b.page, 'waiting-passkeys').count()).toBe(0); // twee passkeys: niets meer te doen
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        await tid(b.page, 'login-go').click();
        await tid(b.page, 'view-main').waitFor();
        await tid(b.page, 'logout').click();
        await tid(b.page, 'login-go').click();
        await tid(b.page, 'view-unlock').waitFor();
        if (shots) await screenshot(b.page, 'portal-7-unlock-passphrase');
        await tid(b.page, 'unlock-pass').fill(setup.passphrase);
        await tid(b.page, 'unlock-go').click();
        await tid(b.page, 'view-main').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
        await b.removeAuthenticator(noPrf);
    });

    it('Given twee passkeys When er een verwijderen Then vraagt een dialoog van het portaal het; annuleren laat haar staan, bevestigen verwijdert ze', async () => {
        let native = 0;
        const count = () => { native += 1; };
        b.page.on('dialog', count);
        await tid(b.page, 'tab-passkeys').click(); await settled(b.page);
        const rows = tid(b.page, 'passkey-row');
        expect(await rows.count()).toBe(2);
        const dialog = tid(b.page, 'ask-dialog');
        const isOpen = () => b.page.evaluate(() => globalThis.document.querySelector('[data-testid="ask-dialog"]').open);
        await rows.nth(1).click();
        await tid(b.page, 'passkey-remove').click();
        await dialog.waitFor();
        expect(await isOpen()).toBe(true);
        expect(await tid(dialog, 'ask-question').textContent()).toContain('Remove');
        expect(await tid(dialog, 'ask-input').isHidden()).toBe(true); // een vraag, geen invoer
        if (mode === 'proces') await screenshot(b.page, 'portal-5b-passkey-remove-dialog');
        await tid(dialog, 'ask-cancel').click();
        await settled(b.page);
        expect(await isOpen()).toBe(false);
        expect(await rows.count()).toBe(2);
        await tid(b.page, 'passkey-remove').click(); // dezelfde passkey staat nog gekozen
        await tid(dialog, 'ask-ok').click();
        await settled(b.page);
        await expect.poll(() => rows.count()).toBe(1);
        expect(await rows.first().getAttribute('data-prf')).toBe('true'); // de passkey met PRF blijft
        b.page.off('dialog', count);
        expect(native).toBe(0); // geen browser-pop-up
    });

    it('herstel met de herstelcode: nieuwe passphrase verplicht, nieuwe herstelcode eenmalig getoond', async () => {
        await tid(b.page, 'logout').click();
        await tid(b.page, 'view-login').waitFor();
        await b.page.locator('#login-recover summary').click();
        await tid(b.page, 'recover-code').fill(setup.recoveryCode);
        await tid(b.page, 'recover-pass').fill('nieuwe passphrase');
        await tid(b.page, 'recover-go').click();
        await tid(b.page, 'view-recovery').waitFor();
        const next = (await tid(b.page, 'recovery-code').textContent()).trim();
        expect(next).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
        expect(next).not.toBe(setup.recoveryCode);
        expect(await tid(b.page, 'recovery-done').isDisabled()).toBe(true); // 4.7: eerst bevestigen
        await tid(b.page, 'recovery-confirm').fill(next.slice(-4));
        await tid(b.page, 'recovery-done').click();
        await tid(b.page, 'view-main').waitFor();
    });

    it('geen geheim in de procesuitvoer (passphrase, herstelcode)', () => {
        expect(findLeaks({ out: proc.output() }, [setup.passphrase, setup.recoveryCode, 'nieuwe passphrase'])).toEqual([]);
    });
});

describe('waarschuwing in een gewone browser', () => {
    it('een gewone browsertab toont de waarschuwing om het eigen venster te gebruiken', async () => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser({ appWindow: false });
        try {
            await b.page.goto(proc.portal);
            await tid(b.page, 'view-welcome').waitFor();
            expect(await tid(b.page, 'window-warning').isVisible()).toBe(true);
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 60_000);
});
