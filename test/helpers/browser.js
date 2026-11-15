/**
 * Browser voor portaal-journeys: Playwright + de virtuele authenticator van Chromium via CDP. Lokaal op Windows
 * de geïnstalleerde Chrome (PW_CHANNEL, standaard 'chrome'); elders Playwrights eigen Chromium.
 * Screenshots alleen met KS_SCREENSHOTS=1: `npm run screenshots` naar docs/screenshots/, `npm run look` naar
 * KS_SCREENSHOTS_DIR (outputs/look/), met per scherm een nakijkrapport (KS_LOOK_REPORT) en het thema uit KS_COLOR_SCHEME.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { inspect } from './look.js';

const SCREENSHOTS = process.env.KS_SCREENSHOTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'screenshots');
const LOOK_REPORT = process.env.KS_LOOK_REPORT;
// Bij `npm run look` de maat van het portaalvenster (1280x860, binnen ongeveer 1264x800), zodat een scrollbalk opvalt.
const VIEWPORT = LOOK_REPORT ? { width: 1264, height: 800 } : { width: 1180, height: 760 };
const pageErrors = new WeakMap();

export const AUTHENTICATOR = Object.freeze({
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
});

export async function openBrowser({ prf = true, colorScheme = process.env.KS_COLOR_SCHEME ?? 'dark', locale = 'en-US', appWindow = process.env.KS_SCREENSHOTS === '1' } = {}) {
    const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : '');
    const browser = await chromium.launch({ headless: true, args: ['--disable-features=OverlayScrollbar'], ...(channel ? { channel } : {}) });
    const context = await browser.newContext({ viewport: VIEWPORT, locale, timezoneId: 'Europe/Brussels', colorScheme });
    // Screenshots tonen wat de gebruiker in het eigen app-venster ziet (display-mode standalone
    // in Edge app-modus). Een gewone headless-tab heeft dat niet; hier nagebootst, alleen voor screenshots.
    if (appWindow) {
        await context.addInitScript(() => {
            const original = globalThis.matchMedia.bind(globalThis);
            globalThis.matchMedia = query => (query.includes('display-mode: standalone') ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : original(query));
        });
    }
    // Voor tests die iets klaarzetten via de API in de pagina: `portalFetch` doet wat de pagina doet (core/api.js): het
    // token uit sessionStorage meesturen, en bij STEP_UP_REQUIRED de (virtuele) passkey vragen en opnieuw sturen.
    await context.addInitScript(() => {
        globalThis.portalFetch = async (url, init = {}) => {
            const withToken = extra => ({ ...init, ...extra, headers: { ...(init.headers ?? {}), 'x-csrf-token': globalThis.sessionStorage.getItem('vaultgate.session') ?? '' } });
            const res = await fetch(url, withToken({}));
            if (res.status !== 403) return res;
            const data = await res.clone().json();
            if (data.error?.code !== 'STEP_UP_REQUIRED') return res;
            const assertion = await globalThis.navigator.credentials.get({ publicKey: globalThis.PublicKeyCredential.parseRequestOptionsFromJSON(data.error.stepUp) });
            return fetch(url, withToken({ body: JSON.stringify({ ...JSON.parse(init.body ?? '{}'), stepUp: assertion.toJSON() }) }));
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    pageErrors.set(page, errors);
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...AUTHENTICATOR, hasPrf: prf } });
    const responses = [];
    page.on('response', async res => {
        try { if (res.url().includes('/api/')) responses.push(`${res.request().method()} ${res.url()} ${await res.text()}`); } catch { /* bv. omleiding */ }
    });
    return {
        browser, page, cdp, authenticatorId, responses,
        async addAuthenticator(options) { return (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...AUTHENTICATOR, ...options } })).authenticatorId; },
        async removeAuthenticator(id) { await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: id }); },
        close: () => browser.close(),
    };
}

/** Screenshot naar docs/screenshots/<naam>.png, alleen als KS_SCREENSHOTS=1. */
export async function screenshot(page, name) {
    if (process.env.KS_SCREENSHOTS !== '1') return;
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    await page.waitForTimeout(400); // een dialoog die opent of sluit: na de overgang
    await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
    if (!LOOK_REPORT) return;
    const errors = pageErrors.get(page) ?? [];
    fs.appendFileSync(LOOK_REPORT, `${JSON.stringify({ scheme: process.env.KS_COLOR_SCHEME ?? 'dark', name, problems: await inspect(page, { errors }) })}\n`);
    errors.length = 0;
}

const byTestId = (page, id) => page.locator(`[data-testid="${id}"]`);

/** Wacht tot de pagina elke lopende handeling afgerond heeft (document.body.dataset.busy === '0'). */
export const settled = page => page.waitForFunction(() => globalThis.document.body.dataset.busy === '0');

/** Klik en wacht tot de handeling (API-call + herladen van de lijst) klaar is. */
export async function act(page, id) {
    await byTestId(page, id).click();
    await settled(page);
}
export { byTestId as tid };

/**
 * Beantwoordt de dialoog van het portaal (geen browser-pop-up): met `value` vult ze eerst het invoerveld; met
 * `cancel` annuleert ze. Wacht daarna tot de handeling klaar is. Geeft het soort invoerveld terug (text/password).
 */
/**
 * Een toekenning toevoegen zoals de gebruiker: de dialoog openen en tool, secret en domein kiezen (zonder label: de
 * eerste keuze). `mode` en `duration` alleen als de test ze wil zetten.
 */
export async function addGrant(page, { tool, secret, host, mode, duration } = {}) {
    await byTestId(page, 'g-open').click();
    const pick = async (id, label) => {
        const select = byTestId(page, id);
        if (label) await select.selectOption({ label });
        else await select.selectOption({ index: 1 }); // 0 is de lege keuze ("Choose a …")
    };
    await pick('g-tool', tool);
    await pick('g-secret', secret);
    if (host) await byTestId(page, 'g-host').selectOption(host); else await pick('g-host');
    if (mode) await byTestId(page, 'g-mode').selectOption(mode);
    if (duration !== undefined) await byTestId(page, 'g-duration').selectOption(String(duration));
    await byTestId(page, 'g-add').click();
    await settled(page);
}

export async function answerAsk(page, { value, cancel = false } = {}) {
    const dialog = byTestId(page, 'ask-dialog');
    await page.waitForFunction(() => globalThis.document.querySelector('[data-testid="ask-dialog"]')?.open === true);
    const input = byTestId(dialog, 'ask-input');
    const type = await input.getAttribute('type');
    if (value !== undefined) await input.fill(value);
    await byTestId(dialog, cancel ? 'ask-cancel' : 'ask-ok').click();
    await settled(page);
    return type;
}

/** De melding "Vaultgate paste deze bestanden aan": geeft de getoonde regels en sluit ze met OK. */
export async function closeChangedFiles(page, { shot } = {}) {
    await page.waitForFunction(() => globalThis.document.querySelector('[data-testid="ask-dialog"]')?.open === true);
    if (shot) await screenshot(page, shot);
    const dialog = byTestId(page, 'ask-dialog');
    const lines = await byTestId(dialog, 'ask-item').allTextContents();
    await byTestId(dialog, 'ask-ok').click();
    await settled(page);
    return lines;
}

/**
 * Eerste opzet via het portaal zoals een gebruiker het doet: het welkom, de eerste passkey (die maakt de kluis, zonder
 * passphrase), de virtuele key overslaan, klaar. Eindigt in het portaal.
 */
export async function setupPortal(page, portal) {
    await page.goto(portal);
    await byTestId(page, 'view-welcome').waitFor();
    await act(page, 'welcome-start');
    await act(page, 'pk-add');
    await byTestId(page, 'passkey-row').first().waitFor();
    await act(page, 'welcome-passkeys-next');
    await act(page, 'welcome-key-skip');
    await act(page, 'welcome-finish');
    await byTestId(page, 'view-main').waitFor();
    return {};
}

/**
 * Een oudere kluis met passphrase en herstelcode (zoals vóór het welkom zonder passphrase): aangemaakt via de API van
 * het portaal, daarna een passkey in het tabblad Passkeys. Geeft passphrase en herstelcode terug.
 */
export async function setupLegacyPortal(page, portal, { passphrase = 'portaal passphrase' } = {}) {
    await page.goto(portal);
    await byTestId(page, 'view-welcome').waitFor();
    const { recoveryCode } = await page.evaluate(async p => {
        const data = await (await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: p }) })).json();
        globalThis.sessionStorage.setItem('vaultgate.session', data.csrf); // zoals de pagina het token bewaart
        return data;
    }, passphrase);
    await page.reload();
    await byTestId(page, 'view-main').waitFor();
    await settled(page);
    await act(page, 'tab-passkeys');
    await byTestId(page, 'pk-open').click();
    await act(page, 'pk-add');
    await byTestId(page, 'passkey-row').first().waitFor();
    return { recoveryCode, passphrase };
}

/**
 * Wacht op de n-de aanraakvraag in de log van het proces (`touch-requested`), open het portaalvenster op die
 * vraag in deze pagina (met de virtuele authenticator) en bevestig (of weiger) ze. Geeft het id terug.
 */
export async function answerTouch(page, proc, n, { confirm = true, open = true } = {}) {
    const touches = () => proc.events.filter(e => e.event === 'touch-requested');
    const deadline = Date.now() + 20_000;
    while (touches().length < n && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    const entry = touches()[n - 1];
    if (!entry) throw new Error(`no touch-requested #${n} within 20 s`);
    await page.goto(`${proc.portal}/touch#${entry.id}`);
    await byTestId(page, 'touch-question').waitFor();
    if (!open) return entry.id;
    await byTestId(page, confirm ? 'touch-confirm' : 'touch-deny').click();
    await byTestId(page, 'touch-done').waitFor();
    return entry.id;
}
