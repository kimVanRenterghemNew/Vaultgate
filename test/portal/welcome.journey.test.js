// Welkom in vier stappen, van een lege map tot een werkende virtuele key, in het echte proces en een echte browser:
// welkom, passkeys (de eerste maakt de kluis, zonder passphrase of herstelcode), een virtuele key, klaar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { tempHome, MODES, runLogin, readToolKey } from '../helpers/journey.js';
import { openBrowser, screenshot, tid, settled } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

/** Voert een opdracht uit zoals het portaal ze toont (via de shell), in `cwd`, met een eigen thuismap voor de client. */
const runShown = (command, { cwd, home }) => {
    let stderr = '';
    const result = new Promise(resolve => {
        const child = spawn(command, { cwd, shell: true, env: { ...process.env, VAULTGATE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stderr.on('data', d => { stderr += d; });
        child.on('exit', code => resolve({ code, stderr }));
    });
    Object.defineProperty(result, 'stderr', { get: () => stderr });
    return result;
};

// Het venster van het portaal is 1280×860 (src/window): binnen is dat ongeveer 1264×800. Het welkom past erin, zonder scrollen.
const WINDOW_INNER = { width: 1264, height: 800 };
const noScroll = async page => {
    await page.setViewportSize(WINDOW_INNER);
    return page.evaluate(() => globalThis.document.documentElement.scrollHeight <= globalThis.document.documentElement.clientHeight);
};

// De sluis-balk: een stap is bereikt als zijn label data-reached="true" heeft.
const step = async (page, n) => (await page.locator(`[data-testid="welcome-steps"] [data-step="${n}"]`).getAttribute('data-reached')) === 'true';

describe.each(MODES)('portaal: welkom zonder passphrase, %s', (mode, start) => {
    let proc;
    let b;
    let key;
    const shots = mode === 'proces';

    beforeAll(async () => {
        proc = await start(tempHome(), { unlock: false });
        b = await openBrowser();
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('stap 1: welkom met de belofte en drie stappen; geen kluis, geen passphrase-veld', async () => {
        await b.page.goto(proc.portal);
        await tid(b.page, 'view-welcome').waitFor();
        await settled(b.page);
        expect(await b.page.locator('[data-page="1"]').isVisible()).toBe(true);
        expect(await step(b.page, 1)).toBe(true);
        expect(await step(b.page, 2)).toBe(false);
        expect(await b.page.locator('input[type=password]:visible').count()).toBe(0);
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('none');
        expect((await tid(b.page, 'vault-state').textContent()).trim()).toBe('no vault yet'); // geen leeg bolletje
        // niets steekt rechts uit (ook de uitleg-tooltip van de kopbalk niet): geen horizontale scrollbalk
        expect(await b.page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBe(0);
        // geen kader rond het welkom: de tegel vult het venster, zonder rand, schaduw of ronde hoeken
        const tile = await b.page.evaluate(() => {
            const card = globalThis.document.querySelector('#view-welcome > .welcome-tile');
            const style = globalThis.getComputedStyle(card);
            return { width: card.getBoundingClientRect().width, viewport: globalThis.document.documentElement.clientWidth, shadow: style.boxShadow, radius: style.borderTopLeftRadius };
        });
        expect(tile).toEqual({ width: tile.viewport, viewport: tile.viewport, shadow: 'none', radius: '0px' });
        expect(await noScroll(b.page)).toBe(true);
        if (shots) await screenshot(b.page, 'portal-1-welcome');
    });

    it('stap 2: de eerste passkey maakt de kluis (open, ingelogd); de tweede wordt aangeraden', async () => {
        await tid(b.page, 'welcome-start').click();
        await settled(b.page);
        expect(await tid(b.page, 'welcome-passkeys-next').isDisabled()).toBe(true);
        // 4.45: het gaat over de kluis openen, niet over de techniek; de rail zegt "Unlock"
        expect(await b.page.locator('[data-page="2"] h1').textContent()).toBe('How do you want to unlock your vault?');
        expect(await b.page.locator('[data-testid="welcome-steps"] [data-step="2"]').textContent()).toBe('Unlock');
        await tid(b.page, 'pk-add').click();
        await settled(b.page);
        await tid(b.page, 'passkey-row').first().waitFor();
        expect(await tid(b.page, 'passkey-row').count()).toBe(1);
        expect(await tid(b.page, 'passkey-row').first().getAttribute('data-prf')).toBe('true');
        expect(await tid(b.page, 'pk-recommend').isVisible()).toBe(true);
        // 4.45: "minstens twee" is een echte waarschuwing; "kluis gemaakt" een melding die verdwijnt
        expect(await tid(b.page, 'welcome-two-keys').isVisible()).toBe(true);
        expect(await tid(b.page, 'welcome-vault-created').isVisible()).toBe(true);
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
        const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(state).toMatchObject({ vaultExists: true, unlocked: true, loggedIn: true, hasPassphrase: false, hasRecovery: false });

        // een tweede sleutel: een security key (een tweede authenticator, usb). De eerste blijft: een passkey erbij vraagt
        // eerst een aanraking van een bestaande (step-up).
        const usb = await b.addAuthenticator({ transport: 'usb', hasPrf: true });
        await tid(b.page, 'pk-add-external').click();
        await settled(b.page);
        await tid(b.page, 'passkey-row').nth(1).waitFor();
        expect(await tid(b.page, 'pk-recommend').isHidden()).toBe(true);
        expect(await tid(b.page, 'welcome-two-keys').isHidden()).toBe(true);
        if (shots) await screenshot(b.page, 'portal-2-passkeys');
        b.authenticatorId = usb;
        expect(await tid(b.page, 'welcome-passkeys-next').isDisabled()).toBe(false);
    });

    it('stap 3, zelf instellen: proxyadres en de key één keer, voor een tool waar je alleen een proxy en key kunt invullen', async () => {
        await tid(b.page, 'welcome-passkeys-next').click();
        await settled(b.page);
        expect(await step(b.page, 3)).toBe(true);
        // standaard staat koppelen open: de beste weg
        expect(await tid(b.page, 'key-way-pair').getAttribute('aria-selected')).toBe('true');
        expect(await tid(b.page, 'key-pair').isVisible()).toBe(true);
        await tid(b.page, 'key-way-manual').click();
        expect(await tid(b.page, 'key-way-manual').getAttribute('aria-selected')).toBe('true');
        expect(await tid(b.page, 'key-pair').isHidden()).toBe(true);
        await tid(b.page, 't-name').fill('proxy-only-tool');
        expect(await noScroll(b.page)).toBe(true);
        if (shots) await screenshot(b.page, 'portal-3-virtual-key-manual');
        await tid(b.page, 't-add').click();
        await settled(b.page);
        // 4.47: de key en de configuratie staan in de stap zelf (zoals de mockups), niet in een dialoog
        const dialog = b.page.locator('ks-key-create');
        await tid(dialog, 't-key-box').waitFor();
        expect(await b.page.evaluate(() => globalThis.document.querySelector('[data-testid="key-dialog"]').open)).toBe(false);
        key = (await tid(dialog, 't-key').textContent()).trim();
        expect(key).toMatch(/^ks_/);
        expect(await tid(dialog, 'key-config').textContent()).toContain(`${proc.proxy}/anthropic`);
        // in de smalle kolom van het welkom: niets afgekapt, en de keuzekaarten niet platgedrukt
        for (const id of ['t-key-box', 'key-config']) expect(await tid(dialog, id).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        for (const w of await dialog.locator('.choice-card').evaluateAll(cards => cards.filter(c => c.offsetParent).map(c => c.getBoundingClientRect().width))) expect(w).toBeGreaterThanOrEqual(200);
        expect(await tid(dialog, 'key-config').textContent()).toContain(key);
        // kopiëren: de key en de configuratie (zonder de commentaarregels) gaan naar het klembord
        await b.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await b.page.clock.install(); // nep-tijd die gewoon doorloopt; fastForward springt straks 60 s vooruit
        await tid(dialog, 'key-copy').click();
        await settled(b.page);
        expect(await b.page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe(key);
        await tid(dialog, 'config-copy').click();
        await settled(b.page);
        const copied = await b.page.evaluate(() => globalThis.navigator.clipboard.readText());
        expect(copied).toContain(`ANTHROPIC_BASE_URL=${proc.proxy}/anthropic`);
        expect(copied).toContain(`ANTHROPIC_API_KEY=${key}`);
        // na het kopiëren zegt een korte tekst wat er met het klembord gebeurt
        expect(await tid(dialog, 'key-copied-note').isVisible()).toBe(true);
        expect(await tid(dialog, 'key-copied-note').textContent()).toContain('60');
        // na 60 s staat de key niet meer op het klembord
        await b.page.clock.fastForward(60_000);
        await expect.poll(() => b.page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe('');
        // wat je intussen zelf kopieerde, blijft staan
        await tid(dialog, 'key-copy').click();
        await settled(b.page);
        await b.page.evaluate(() => globalThis.navigator.clipboard.writeText('iets anders van de gebruiker'));
        await b.page.clock.fastForward(60_000);
        await settled(b.page);
        expect(await b.page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe('iets anders van de gebruiker');
        if (shots) await screenshot(b.page, 'portal-3-virtual-key-dialog');
        // "Got it": de key staat nergens meer in de pagina, en het welkom gaat verder
        await tid(dialog, 'key-done').click();
        await settled(b.page);
        expect(await b.page.content()).not.toContain(key);
        expect(await b.page.content()).not.toMatch(/ks_[A-Za-z0-9_-]{20,}/);
        expect(await tid(b.page, 'welcome-key-next').isVisible()).toBe(true);
        const tools = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/tools')).json());
        // 4.29: de key krijgt geen "bij gebruik"/"geldig" meer; dat kies je per toekenning
        expect(tools).toMatchObject([{ name: 'proxy-only-tool', kind: 'web', onUse: 'silent', validMs: 0 }]);
    });

    it('stap 3, koppelen: de opdracht met de naam, de aanvraag verschijnt vanzelf in het welkom, toestaan geeft de tool haar key', async () => {
        await tid(b.page, 'key-way-pair').click();
        await tid(b.page, 't-name').fill('claude-code');
        const command = (await tid(b.page, 'key-pair-command').textContent()).trim();
        expect(command).toContain('login --name claude-code');
        // de opdracht zoals getoond, letterlijk, vanuit een andere map dan de repo (anders "Cannot find module")
        const clientHome = tempHome();
        const login = runShown(command, { cwd: clientHome, home: clientHome });
        // geen klik nodig: het welkom kijkt zelf of er een aanvraag wacht
        await tid(b.page, 'device-approve-claude-code').waitFor({ timeout: 45_000 });
        expect(await noScroll(b.page)).toBe(true);
        // ook niet in de breedte: niets valt rechts weg
        expect(await b.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth)).toBe(true);
        if (shots) await screenshot(b.page, 'portal-3-virtual-key-pair');
        const codeDeadline = Date.now() + 10_000;
        while (!/Your code: [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < codeDeadline) await new Promise(resolve => setTimeout(resolve, 20));
        const terminalCode = login.stderr.match(/Your code: ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
        expect(terminalCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        await tid(b.page, 'device-approve-claude-code').click();
        await tid(b.page, 'ask-input').fill(terminalCode);
        await tid(b.page, 'ask-ok').click();
        await settled(b.page);
        const result = await login;
        expect(result.code, result.stderr).toBe(0);
        expect(await readToolKey(clientHome, 'claude-code')).toMatch(/^ks_/);
        await tid(b.page, 'key-paired').waitFor();
        expect(await tid(b.page, 'key-paired').textContent()).toContain('claude-code');
    }, 60_000);

    it('stap 4: "Ready to start!"; daarna het portaal, bij Activity', async () => {
        await tid(b.page, 'welcome-key-next').click();
        await settled(b.page);
        expect(await step(b.page, 4)).toBe(true);
        // de samenvatting telt echte toestand: twee passkeys, twee tools
        expect(await tid(b.page, 'welcome-summary-passkeys').textContent()).toContain('2');
        expect(await tid(b.page, 'welcome-summary-tools').textContent()).toContain('claude-code');
        expect(await tid(b.page, 'welcome-summary-tools').textContent()).toContain('proxy-only-tool');
        expect(await b.page.locator('[data-page="4"] h1').textContent()).toBe('Ready to start!');
        expect(await tid(b.page, 'welcome-finish').textContent()).toBe('Open the portal');
        // wie de cryptografie wil zien, gaat naar de website (in de browser, niet in dit venster)
        const specs = tid(tid(b.page, 'view-welcome'), 'security-specs');
        expect(await specs.getAttribute('href')).toBe('https://vaultgate.github.io/Vaultgate/security.html#keys');
        expect(await specs.getAttribute('target')).toBe('_blank');
        expect(await specs.getAttribute('rel')).toBe('noopener noreferrer');
        if (shots) { await b.page.waitForTimeout(500); await screenshot(b.page, 'portal-4-done'); } // na de overgang
        await tid(b.page, 'welcome-finish').click();
        await settled(b.page);
        await tid(b.page, 'view-main').waitFor();
        expect(await tid(b.page, 'tab-audit').getAttribute('aria-current')).toBe('page');
    });

    it('Activity heeft geen kaart "Optional next steps" meer, maar wel "Waiting for you"', async () => {
        expect(await tid(b.page, 'followup-card').count()).toBe(0);
        await tid(b.page, 'waiting').waitFor();
        expect(await tid(b.page, 'tab-audit').getAttribute('aria-current')).toBe('page');
    });

    it('MOET weigeren: ontgrendelen met een passphrase op een kluis zonder passphrase, en een tweede opzet', async () => {
        const result = await b.page.evaluate(async () => {
            const { csrf } = await (await globalThis.portalFetch('/api/state')).json();
            const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf };
            const unlock = await globalThis.portalFetch('/api/unlock', { method: 'POST', headers, body: '{"passphrase":"raad maar"}' });
            const setup = await globalThis.portalFetch('/api/setup', { method: 'POST', headers, body: '{"passphrase":"tweede kluis"}' });
            return [unlock.status, setup.status];
        });
        expect(result).toEqual([401, 409]); // geen passphrase ingesteld; tweede kluis geweigerd
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
        // een kluis met alleen passkeys: één kaart met de passkey, geen herstelcode en geen passphrase (keuze van de product owner)
        expect(await tid(b.page, 'login-go').isVisible()).toBe(true);
        expect(await b.page.locator('#login-recover').isVisible()).toBe(false);
        expect(await tid(b.page, 'recover-code').isVisible()).toBe(false);
        expect(await tid(b.page, 'bootstrap-pass').isVisible()).toBe(false);
        expect(await b.page.locator('ks-login [data-layout="focus"]').count()).toBe(1);
        if (shots) await screenshot(b.page, 'portal-6-login');
    });

    it('opnieuw inloggen met de passkey opent de portalsessie; de kluis bleef open', async () => {
        await tid(b.page, 'view-login').waitFor();
        await tid(b.page, 'login-go').click();
        await settled(b.page);
        await tid(b.page, 'view-main').waitFor();
        expect(await tid(b.page, 'vault-state').getAttribute('data-state')).toBe('open');
    });

    it('de key staat nergens in de procesuitvoer', () => {
        expect(findLeaks({ out: proc.output() }, [key])).toEqual([]);
    });
});

describe('portaal: welkom en beweging', () => {
    const transitions = async (colorSchemeMotion) => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser();
        try {
            await b.page.emulateMedia({ reducedMotion: colorSchemeMotion });
            await b.page.goto(proc.portal);
            await tid(b.page, 'view-welcome').waitFor();
            // tel de overgangen; de toestand moet dezelfde zijn, met of zonder beweging
            await b.page.evaluate(() => {
                globalThis.__transitions = 0;
                const doc = globalThis.document;
                const original = doc.startViewTransition?.bind(doc);
                if (original) doc.startViewTransition = cb => { globalThis.__transitions++; return original(cb); };
            });
            await tid(b.page, 'welcome-start').click();
            await settled(b.page);
            await b.page.locator('[data-page="2"]').waitFor();
            return { count: await b.page.evaluate(() => globalThis.__transitions), reached: await step(b.page, 2), page1Hidden: await b.page.locator('[data-page="1"]').isHidden() };
        } finally {
            await b.close();
            await proc.stop();
        }
    };

    it('Given prefers-reduced-motion When de volgende stap Then geen overgang, wel dezelfde toestand', async () => {
        expect(await transitions('reduce')).toEqual({ count: 0, reached: true, page1Hidden: true });
    }, 60_000);

    it('Given gewone beweging When de volgende stap Then één overgang', async () => {
        expect(await transitions('no-preference')).toEqual({ count: 1, reached: true, page1Hidden: true });
    }, 60_000);
});

describe('portaal: welkom, een passkey die niet afraakt', () => {
    it('Given een browser die de ceremonie weigert When Telefoon Then zegt de melding welke stap faalde en na hoeveel seconden, en is er geen kluis', async () => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser();
        try {
            // de browser weigert de ceremonie, zoals bij een verlopen of afgebroken telefoon-sessie (NotAllowedError);
            // de virtuele authenticator kan dat niet nabootsen zonder 60 s te wachten
            await b.page.addInitScript(() => {
                globalThis.navigator.credentials.create = () => new Promise((_, reject) => setTimeout(() => reject(new globalThis.DOMException('The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.', 'NotAllowedError')), 1200));
            });
            await b.page.goto(proc.portal);
            await tid(b.page, 'welcome-start').click();
            await settled(b.page);
            await tid(b.page, 'pk-add-phone').click();
            await settled(b.page);
            const message = await tid(b.page, 'message').textContent();
            expect(message).toMatch(/creating the passkey/i);
            expect(message).toMatch(/\d+ s/);
            expect(message).not.toMatch(/w3\.org/); // geen ruwe browsertekst
            const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
            expect(state.vaultExists).toBe(false);
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 120_000);
});

describe('portaal: welkom, een passkey-knop toont dat de ceremonie loopt', () => {
    it('Given een ceremonie die even wacht When dubbelklik op Deze pc Then één create, de knop toont een laadteken, de andere zijn uit, en daarna geen fout', async () => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser();
        try {
            // de browser wacht ~1 s voor hij de (virtuele) authenticator vraagt, en telt de ceremonies
            await b.page.addInitScript(() => {
                const credentials = globalThis.navigator.credentials;
                const original = credentials.create.bind(credentials);
                globalThis.__creates = 0;
                credentials.create = options => { globalThis.__creates++; return new Promise(resolve => setTimeout(resolve, 1000)).then(() => original(options)); };
            });
            await b.page.goto(proc.portal);
            await tid(b.page, 'welcome-start').click();
            await settled(b.page);
            await tid(b.page, 'pk-add').dblclick();
            await b.page.waitForFunction(() => globalThis.__creates > 0);
            const during = await b.page.evaluate(() => {
                const el = id => globalThis.document.querySelector(`[data-testid="${id}"]`);
                return {
                    busy: el('pk-add').getAttribute('aria-busy'),
                    spinner: el('pk-add').querySelector('.loading.loading-spinner') !== null,
                    text: el('pk-add').textContent,
                    disabled: ['pk-add-external', 'pk-add-phone', 'pk-add'].map(id => el(id).disabled),
                };
            });
            expect(during).toEqual({ busy: 'true', spinner: true, text: expect.stringMatching(/waiting for your key/i), disabled: [true, true, true] });
            await settled(b.page);
            await tid(b.page, 'passkey-row').first().waitFor();
            const after = await b.page.evaluate(() => {
                const el = id => globalThis.document.querySelector(`[data-testid="${id}"]`);
                return {
                    creates: globalThis.__creates,
                    error: el('message').querySelector('.alert-error') !== null,
                    busy: el('pk-add').getAttribute('aria-busy'),
                    spinner: el('pk-add').querySelector('.loading') !== null,
                    disabled: ['pk-add-external', 'pk-add-phone', 'pk-add'].map(id => el(id).disabled),
                };
            });
            expect(after).toEqual({ creates: 1, error: false, busy: null, spinner: false, disabled: [false, false, false] });
            expect(await tid(b.page, 'pk-add').textContent()).toMatch(/this pc/i);
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 120_000);
});

describe('portaal: welkom, toestaan buiten het welkom',() => {
    it('Given een wachtende koppeling in stap 3 When de code is ingevoerd en ze buiten het welkom wordt toegestaan Then toont het welkom de tool als gekoppeld zonder herladen', async () => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser();
        try {
            await b.page.goto(proc.portal);
            await tid(b.page, 'welcome-start').click();
            await settled(b.page);
            await tid(b.page, 'pk-add').click();
            await settled(b.page);
            await tid(b.page, 'passkey-row').first().waitFor();
            await tid(b.page, 'welcome-passkeys-next').click();
            await settled(b.page);
            expect(await tid(b.page, 'welcome-key-next').isHidden()).toBe(true);
            const clientHome = tempHome();
            const login = runLogin({ proxy: proc.proxy, name: 'tray-tool', home: clientHome });
            await tid(b.page, 'device-approve-tray-tool').waitFor({ timeout: 45_000 });
            const codeDeadline = Date.now() + 10_000;
            while (!/Your code: [0-9A-Z]{4}-[0-9A-Z]{4}/.test(login.stderr) && Date.now() < codeDeadline) await new Promise(resolve => setTimeout(resolve, 20));
            const terminalCode = login.stderr.match(/Your code: ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
            const approved = await b.page.evaluate(async code => {
                const { csrf } = await (await globalThis.portalFetch('/api/state')).json();
                const post = (url, body = {}) => globalThis.portalFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
                const [pending] = await (await globalThis.portalFetch('/api/device')).json();
                const verified = await post(`/api/device/${pending.id}/verify`, { code });
                if (!verified.ok) return { verified: verified.status };
                const { touch } = await (await post(`/api/device/${pending.id}/approve`)).json();
                if (!touch) return { touch: false };
                const base = `/api/touch/${encodeURIComponent(touch)}`;
                const { options } = await (await post(`${base}/options`)).json();
                const assertion = await globalThis.navigator.credentials.get({ publicKey: globalThis.PublicKeyCredential.parseRequestOptionsFromJSON(options) });
                return { status: (await post(`${base}/verify`, { response: assertion.toJSON() })).status };
            }, terminalCode);
            expect(approved).toEqual({ status: 200 });
            const result = await login;
            expect(result.code, result.stderr).toBe(0);
            // zonder herladen: het welkom ziet de nieuwe tool zelf
            await tid(b.page, 'key-paired').getByText('tray-tool').waitFor({ timeout: 10_000 });
            await tid(b.page, 'welcome-key-next').waitFor({ state: 'visible', timeout: 10_000 });
            expect(await tid(b.page, 'key-paired').textContent()).toContain('tray-tool');
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 120_000);
});

describe('portaal: welkom met een sleutel zonder PRF', () => {
    it('MOET weigeren: een eerste passkey zonder PRF maakt geen kluis', async () => {
        const [, startInProcess] = MODES[1];
        const proc = await startInProcess(tempHome(), { unlock: false });
        const b = await openBrowser({ prf: false });
        try {
            await b.page.goto(proc.portal);
            await tid(b.page, 'welcome-start').click();
            await settled(b.page);
            await tid(b.page, 'pk-add').click();
            await settled(b.page);
            expect(await tid(b.page, 'message').textContent()).toMatch(/PRF/);
            const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
            expect(state.vaultExists).toBe(false);
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 60_000);
});
