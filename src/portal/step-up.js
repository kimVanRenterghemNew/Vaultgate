// Step-up: wat meer toelaat, vraagt een verse aanraking van een passkey, ook met een geldige sessie. Een gestolen
// sessiecookie of een agent die de pagina bedient (CDP, UI Automation) kan zo geen beleid verzwakken en geen eigen
// passkey koppelen. Welke handeling een aanraking vraagt, is een tabel met benoemde regels (eerste wint); de regelnaam
// staat in de weigering. De challenge is gebonden aan de sessie, de handeling (methode + pad) en de inhoud van de
// request (gesleutelde hash, nooit de inhoud zelf), eenmalig en 2 minuten geldig. Deel van het portaal (index.js).
import { decide, all, any } from '../decision/index.js';

export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';
export const STEP_UP_UNAVAILABLE = 'STEP_UP_UNAVAILABLE';

const SECRET = '/api/secrets/[0-9a-f]+';
const TOOL = '/api/tools/[0-9a-f]+';
const at = (method, pattern) => ctx => ctx.method === method && new RegExp(`^${pattern}$`).test(ctx.path);
const settingsPut = at('PUT', '/api/settings');

/** Staat er in `next` iets dat niet in `before` stond (volgens `key`)? */
const added = (next, before, key = JSON.stringify) => {
    const known = new Set((before ?? []).map(key));
    return Array.isArray(next) && next.some(item => !known.has(key(item)));
};
/** Ontbreekt er in `next` iets uit `before`? Alleen als het veld meegestuurd is. */
const removed = (next, before, key = JSON.stringify) => Array.isArray(next) && added(before, next, key);
const listenerKey = l => `${l?.host}:${l?.port}`;
const blockKey = b => String(b?.id);

const TOUCH = Object.freeze({ stepUp: true, credentials: 'touch' });

/** De handelingen die meer toelaten. Wat minder toelaat (intrekken, verwijderen, sluiten) valt onder `no-step-up`. */
export const STEP_UP_RULES = Object.freeze([
    // Een gevoelige wijziging vraagt altijd een hard bewijs (een passkey); een passphrase-sessie alleen is niet genoeg.
    // Enige uitzondering: de eerste passkey van een kluis met alleen een passphrase, anders komt er nooit een hard bewijs.
    { name: 'step-up-first-passkey', when: all(ctx => ctx.credentialCount === 0, at('POST', '/api/webauthn/register/options')), then: { stepUp: false } },
    { name: 'step-up-passkey-register', when: at('POST', '/api/webauthn/register/options'), then: { stepUp: true, credentials: 'unlockers' } },
    { name: 'step-up-grant', when: any(at('POST', '/api/grants'), at('PUT', '/api/grants/[0-9a-f]+')), then: TOUCH },
    { name: 'step-up-hosts', when: all(at('PUT', `${SECRET}/hosts`), ctx => added(ctx.body.hosts, ctx.secret?.hosts)), then: TOUCH },
    { name: 'step-up-inject', when: at('PUT', `${SECRET}/inject`), then: TOUCH },
    { name: 'step-up-sensitive-off', when: all(at('PUT', `${SECRET}/sensitive`), ctx => ctx.body.sensitive !== true), then: TOUCH },
    { name: 'step-up-secret-rotate', when: at('POST', `${SECRET}/rotate`), then: TOUCH },
    { name: 'step-up-secret-rename', when: at('PUT', `${SECRET}/name`), then: TOUCH },
    { name: 'step-up-tool-create', when: at('POST', '/api/tools'), then: TOUCH },
    { name: 'step-up-tool-rotate', when: at('POST', `${TOOL}/rotate`), then: TOUCH },
    { name: 'step-up-tool-reactivate', when: at('POST', `${TOOL}/reactivate`), then: TOUCH },
    // "Opnieuw om mijn passkey vragen" wijzigen: uitzetten of langer laat meer toe; altijd een aanraking (eenvoudig en veilig).
    { name: 'step-up-tool-reask', when: at('PUT', `${TOOL}/reask`), then: TOUCH },
    { name: 'step-up-tool-clients', when: all(at('PUT', `${TOOL}/clients`), ctx => added(ctx.body.clients, ctx.tool?.clients, String)), then: TOUCH },
    { name: 'step-up-tls-accept', when: at('POST', '/api/tls/accept'), then: TOUCH },
    { name: 'step-up-vault-delete', when: any(at('DELETE', '/api/vault'), at('POST', '/api/vault/delete')), then: TOUCH },
    { name: 'step-up-unblock', when: any(at('DELETE', '/api/blocks/[A-Za-z0-9_-]+'), all(settingsPut, ctx => removed(ctx.body.blocks, ctx.settings?.blocks, blockKey))), then: TOUCH },
    { name: 'step-up-quiet-hours', when: all(settingsPut, ctx => removed(ctx.body.quietHours, ctx.settings?.quietHours, String)), then: TOUCH },
    { name: 'step-up-listeners', when: all(settingsPut, ctx => added(ctx.body.listeners, ctx.settings?.listeners, listenerKey)), then: TOUCH },
    { name: 'step-up-routes', when: all(settingsPut, ctx => added(ctx.body.routes, ctx.settings?.routes)), then: TOUCH },
    { name: 'step-up-auto-lock', when: all(settingsPut, ctx => ctx.body.autoLockMs !== undefined && Number(ctx.body.autoLockMs) > (ctx.settings?.autoLockMs ?? 0)), then: TOUCH },
    // Terug naar `any`: met elke niet-geblokkeerde passkey, anders sluit `external` zonder externe sleutel je buiten.
    { name: 'step-up-touch-any', when: all(settingsPut, ctx => ctx.body.touchAuthenticator === 'any' && ctx.settings?.touchAuthenticator !== 'any'), then: { stepUp: true, credentials: 'unblocked' } },
    { name: 'no-step-up', when: () => true, then: { stepUp: false } },
]);

/**
 * @param {{ rp: object, vault: object, registry: object, crypto: object, policy: object, auditAdmin: Function,
 *           touchCredentials: () => object[], log: Function, httpError: Function }} deps
 *   touchCredentials: de passkeys die een aanraking mogen geven (instelling touchAuthenticator, zonder blokkades).
 */
export function createStepUp({ rp, vault, registry, crypto, policy, auditAdmin, touchCredentials, log, httpError }) {
    const bindKey = crypto.randomBytes(32);

    const sets = {
        touch: () => touchCredentials(),
        // "Die de kluis kan openen": met PRF, en volgens touchAuthenticator. Laat die instelling geen enkele toe
        // (`external` zonder externe sleutel), dan elke niet-geblokkeerde: anders kun je de externe sleutel nooit toevoegen. Heeft geen
        // passkey PRF (kluis met passphrase), dan wat er is.
        unlockers: () => {
            const prf = new Set(vault.passkeySalts().map(p => p.credentialId));
            const pick = list => (prf.size > 0 ? list.filter(c => prf.has(c.id)) : list);
            const touch = pick(touchCredentials());
            return touch.length > 0 ? touch : pick(policy.availableCredentials(vault.listCredentials()));
        },
        unblocked: () => policy.availableCredentials(vault.listCredentials()),
    };

    async function context(method, path, body) {
        const secretId = /^\/api\/secrets\/([0-9a-f]+)\/hosts$/.exec(path)?.[1];
        const toolId = /^\/api\/tools\/([0-9a-f]+)\/clients$/.exec(path)?.[1];
        return {
            method, path, body, credentialCount: vault.listCredentials().length,
            secret: secretId ? (await registry.listSecrets()).find(s => s.id === secretId) ?? null : null,
            tool: toolId ? { clients: ((await registry.listTools()).find(t => t.id === toolId)?.clients ?? []).map(c => c.text ?? String(c)) } : null,
            settings: settingsPut({ method, path }) ? await registry.getSettings() : null,
        };
    }

    /**
     * Laat een schrijfactie door, of weigert ze met de opties voor een aanraking op precies deze handeling.
     * Geeft de body zonder `stepUp` terug (de handler ziet de assertion nooit).
     */
    async function guard({ method, path, body, session }) {
        const { stepUp: assertion, ...rest } = body;
        const ctx = await context(method, path, rest);
        const decision = decide(ctx, STEP_UP_RULES);
        if (!decision.stepUp) return rest;
        const credentials = sets[decision.credentials]();
        if (credentials.length === 0) throw Object.assign(httpError(STEP_UP_UNAVAILABLE, 'no passkey can confirm this change'), { rule: 'step-up-unavailable' });
        const kind = `step-up:${crypto.keyedHash(bindKey, JSON.stringify([session.id, method, path, rest]))}`;
        if (!assertion) {
            const { options } = await rp.authenticationOptions({ credentials, prfSalts: {}, kind });
            throw Object.assign(httpError(STEP_UP_REQUIRED, 'touch your passkey to confirm this change'), { rule: decision.rule, stepUp: options });
        }
        const { credentialId, newCounter } = await rp.verifyAuthentication(assertion, credentials, kind);
        await vault.updateCredentialCounter(credentialId, newCounter);
        log({ event: 'step-up-confirmed', rule: decision.rule });
        await auditAdmin('step-up-confirmed', { detail: decision.rule });
        return rest;
    }

    return Object.freeze({ guard });
}
