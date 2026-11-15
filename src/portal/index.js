// Beheerportaal: alleen lokaal, inloggen met FIDO2, waarden na opslaan nooit meer terug.
//
// Verdediging:
//  - Host-header moet `localhost:<poort>` zijn (DNS-rebinding), het portaal luistert alleen op loopback.
//  - Sessie: HttpOnly-cookie, SameSite=Strict, automatisch vergrendelen na autoLockMs (standaard 15 min), max. 2 u, plus het token van de pagina in een header
//    bij elk request (sessions.js). Elke schrijfactie vraagt een JSON-body en (als de browser hem stuurt) dezelfde Origin.
//  - Wat meer toelaat, vraagt een verse aanraking van een passkey (step-up.js), ook met een geldige sessie.
//  - Zonder geregistreerde passkey kan alleen de eerste opzet: een kluis aanmaken, of met de passphrase ontgrendelen. Daarna
//    alleen inloggen met FIDO2 (of herstellen met de herstelcode).
//  - CSP zonder inline-script behalve met een nonce per response; geen externe bronnen.
//  - Aanraking: `/touch#<id>` en `/api/touch/<id>/…` gebruiken geen sessie (auth 'touch'); alleen een geldige
//    WebAuthn-assertie op de challenge van dat id bevestigt. Het id is willekeurig en eenmalig.
import { isLoopback } from '../policy/index.js';
import { createRelyingParty } from './webauthn.js';
import { renderPage, renderTouchPage } from './page.js';
import { touchRoutes } from './touch-routes.js';
import { setupRoutes } from './setup-routes.js';
import { manageRoutes, mcpRoutes } from './manage-routes.js';
import { activityRoutes } from './activity-routes.js';
import { renameMcpTool } from '../mcp/index.js';
import { passkeyRoutes } from './passkey-routes.js';
import { loginRoutes, accepts, acceptedRules } from './login-routes.js';
import { webauthnRoutes } from './webauthn-routes.js';
import { createStepUp } from './step-up.js';
import { createPolicyState } from './policy-state.js';
import { blockRoutes } from './block-routes.js';
import { vaultRoutes } from './vault-routes.js';
import { checkRoute } from './check-route.js';
import { createPortalSessions } from './sessions.js';
import { deviceRoutes } from './device-routes.js';
import { auditedRegistry, adminRecorder } from '../audit/index.js';
import { STATUS, httpError } from './errors.js';
import { createPush } from './push.js';

export { PUSH_KINDS } from './push.js';

export const PORTAL_NOT_LOCAL = 'PORTAL_NOT_LOCAL';

/** Het portaal draait nooit op een niet-lokaal adres; anders weigert het proces te starten. */
export function assertLocalPortalHost(host) {
    if (host === 'localhost' || isLoopback(host)) return host;
    throw Object.assign(new Error(`the portal may only listen on a loopback address (127.0.0.1, ::1 or localhost), not ${host}`), { code: PORTAL_NOT_LOCAL });
}

const IDLE_MS = 15 * 60_000; // tot de instellingen geladen zijn
const MAX_SESSION_MS = 2 * 60 * 60_000;
const MAX_BODY = 64 * 1024;

export function createPortal({ vault, registry, audit, approval, device = null, tlsTrust = null, touch = null, touchCredentials = () => vault.listCredentials(), crypto, clock, log = () => {}, afterUnlock = unlock => unlock(), afterSettings = async () => {}, notify = () => {}, translate = key => key, mainScript = null, policyState = () => ({}), home = null, env = {} }) {
    let [port, proxyPort, origin] = [null, null, null];
    const rp = createRelyingParty({ crypto, clock });
    const sessions = new Map(); // id -> { created, lastSeen, csrf }

    const { newSession, currentSession, endSession, hasSessionCookie, liveSessionId, isLive, createTicket, redeemTicket } = createPortalSessions({ sessions, crypto, clock, audit, log, idleMs: () => policyState().autoLockMs ?? IDLE_MS, maxSessionMs: MAX_SESSION_MS });

    /** Na herstel of het verwijderen van een passkey: alleen de huidige sessie blijft geldig (review 2026-10-09, bevinding 2). */
    function endOtherSessions(keepId) {
        for (const id of sessions.keys()) if (id !== keepId) sessions.delete(id);
        push.sessionsEnded();
    }

    // Passphrase-afleidingen zonder sessie (Argon2id, 256 MiB): één tegelijk, en na een fout een oplopende wachttijd
    // (1 s, 2 s, 4 s, ... max. 30 s). Tegen een geheugen-DoS door een lokaal proces (review 2026-10-09, bevinding 3).
    let kdfBusy = false;
    let kdfFailures = 0;
    let kdfNotBefore = 0;
    async function kdfGate(task) {
        const now = clock.now();
        if (kdfBusy || now < kdfNotBefore) {
            throw Object.assign(httpError('TOO_MANY_ATTEMPTS', 'another attempt is running or the previous one failed; try again later'), { retryAfterMs: Math.max(kdfNotBefore - now, 1000) });
        }
        kdfBusy = true;
        try {
            const result = await task();
            kdfFailures = 0;
            return result;
        } catch (error) {
            if (error.code === 'WRONG_CREDENTIALS') {
                kdfFailures += 1;
                kdfNotBefore = clock.now() + Math.min(1000 * 2 ** (kdfFailures - 1), 30_000);
            }
            throw error;
        } finally {
            kdfBusy = false;
        }
    }

    // ---- invoer en uitvoer --------------------------------------------------------------------------------------

    const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-frame-options': 'DENY' };
    const push = createPush({ crypto, clock, log, liveSessionId, isLive, headers: SECURITY_HEADERS });
    const settingsChanged = async () => { await afterSettings(); push.publish('settings'); };

    function send(res, status, body) {
        res.writeHead(status, { 'content-type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify(body));
    }

    function readJson(req) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            // Te groot: meteen 413, de rest laten weglopen (zodat de client het antwoord ziet); boven 1 MB de verbinding verbreken.
            req.on('data', c => {
                size += c.length;
                if (size > MAX_BODY) { reject(httpError('TOO_LARGE', 'body too large')); if (size > 1024 * 1024) req.destroy(); } else chunks.push(c);
            });
            req.on('end', () => {
                if (chunks.length === 0) { resolve({}); return; }
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError('BAD_REQUEST', 'invalid JSON')); }
            });
            req.on('error', reject);
        });
    }

    const prfBuffer = text => {
        if (text === undefined || text === null) return null;
        const buf = Buffer.from(String(text), 'base64url');
        if (buf.length !== 32) throw httpError('INVALID_PRF', 'PRF output must be 32 bytes');
        return buf;
    };

    // ---- de API -------------------------------------------------------------------------------------------------

    const auditPortal = rule => audit.append({ mode: 'portal', method: 'POST', allow: true, rule, status: 200 }).catch(error => log({ event: 'audit-failed', code: error.code ?? 'unknown' }));
    // Ook voor het tray-menu: Lock = alle portaalsessies dicht, de kluis blijft open; Log out = ook de kluis dicht.
    const lockPortal = () => { sessions.clear(); push.sessionsEnded(); auditPortal('portal-locked'); };
    const closeVault = () => { vault.lock(); sessions.clear(); push.sessionsEnded(); auditPortal('vault-closed'); };
    // Beheer: elke wijziging komt in de audit (mode 'admin', herkomst portal); de registry-routes krijgen de geauditeerde registry.
    const [managed, auditAdmin] = [auditedRegistry(registry, { audit, origin: 'portal' }), adminRecorder(audit, 'portal')];
    const requireUnlocked = () => { if (!vault.isUnlocked()) throw Object.assign(httpError('VAULT_LOCKED', 'vault is locked'), { rule: 'vault-locked' }); };
    const policy = createPolicyState({ clock, policyState, vault });
    const stepUp = createStepUp({ rp, vault, registry, crypto, policy, auditAdmin, touchCredentials: () => policy.availableCredentials(touchCredentials()), log, httpError });

    function state(session) {
        const s = vault.status();
        return {
            vaultExists: s.exists,
            unlocked: vault.isUnlocked(),
            loggedIn: Boolean(session),
            csrf: null, // alleen in het antwoord van aanmelden: een cookie alleen geeft het token niet
            credentialCount: s.credentialCount,
            passkeyCount: s.passkeyCount,
            needsMorePasskeys: s.credentialCount < 2,
            hasPassphrase: s.hasPassphrase === true,
            hasRecovery: s.hasRecovery === true,
            rolledBack: s.rolledBack === true, codeChanged: s.codeChanged ?? [], // gewijzigde eigen bestanden (rode balk)
            lockInMs: session?.lockInMs ?? 0, // tot automatisch vergrendelen (een Lock: alleen het portaal)
            mainScript,
            pendingApprovals: session ? approval.pending().length : 0,
            proxyPort,
        };
    }

    /** Routes: [methode, pad-regex, { auth: 'none'|'session'|'unlocked' }, handler(ctx)]. */
    const ROUTES = [
        ['GET', /^\/api\/state$/, 'none', ({ session }) => state(session)],

        // Eerste opzet: alleen zolang er geen kluis is.
        ['POST', /^\/api\/setup$/, 'none', async ({ body, res }) => {
            if (vault.status().exists) throw httpError('VAULT_EXISTS', 'a vault already exists');
            const { recoveryCode } = await vault.create({ passphrase: body.passphrase });
            await afterUnlock(async () => {});
            const session = newSession(res);
            log({ event: 'portal-setup' });
            return { recoveryCode, csrf: session.csrf };
        }],

        // Ontgrendelen met de passphrase: met een sessie, of zonder zolang er nog geen passkey is (eerste registratie).
        ['POST', /^\/api\/unlock$/, 'none', async ({ body, session, res }) => {
            const bootstrap = vault.status().credentialCount === 0;
            if (!session && !bootstrap) throw httpError('UNAUTHENTICATED', 'log in with a passkey first');
            // De bewuste bevestigingen (oudere kopie, gewijzigde eigen code) staan in de audit.
            const unlock = () => afterUnlock(() => vault.unlockWithPassphrase(body.passphrase, accepts(body)));
            for (const rule of acceptedRules(await (session ? unlock() : kdfGate(unlock)))) auditPortal(rule);
            const s = session ?? newSession(res);
            return { unlocked: true, csrf: s.csrf };
        }],

        ['POST', /^\/api\/recover$/, 'none', async ({ body, session, res }) => {
            const { recoveryCode } = await kdfGate(() => afterUnlock(() => vault.recover({ recoveryCode: body.recoveryCode, newPassphrase: body.newPassphrase })));
            const s = session ?? newSession(res);
            endOtherSessions(s.id);
            log({ event: 'portal-recovered' });
            await auditAdmin('vault-recovered');
            return { recoveryCode, csrf: s.csrf };
        }],

        // Lock sluit alleen het beheerportaal; tools blijven de open kluis gebruiken. Log out sluit ook de kluis.
        // Eerst sluiten, dan auditen zonder wachten (review 2026-10-21). Log out ook zonder geldige sessie ('none'): met een
        // verlopen sessie sluit de knop nog de kluis; Origin- en JSON-controle blijven gelden, sluiten is de veilige richting.
        ['POST', /^\/api\/lock$/, 'session', ({ req, res }) => { endSession(req, res); push.sessionsEnded(); auditPortal('portal-locked'); return { loggedIn: false, unlocked: vault.isUnlocked() }; }],
        ['POST', /^\/api\/logout$/, 'none', ({ req, res }) => { endSession(req, res); closeVault(); return { loggedIn: false, unlocked: false }; }],

        // FIDO2: registreren (met step-up) en PRF later inschrijven; inloggen (zonder sessie, met anti-rollback).
        ...webauthnRoutes({ rp, vault, auditAdmin, notify, translate, log, httpError, prfBuffer }),
        ...loginRoutes({ rp, vault, registry, policy, newSession, afterUnlock, auditPortal, log, httpError, prfBuffer, redeemTicket }),
        ...passkeyRoutes({ vault, registry: managed, policy, endOtherSessions, httpError }),
        ...touchRoutes({ touch, rp, vault, touchCredentials: () => policy.availableCredentials(touchCredentials()), log, httpError }),
        ...setupRoutes({ vault, rp, newSession, afterUnlock, log, httpError, prfBuffer }),
        ...manageRoutes({ registry: managed, clock, onToolRenamed: ({ oldName, newName }) => renameMcpTool({ oldName, newName, vaultHome: home, env }) }), ...mcpRoutes({ registry, vault, home, proxyUrl: () => `http://127.0.0.1:${proxyPort}`, auditAdmin, httpError, env }),
        ...activityRoutes({ audit }),
        ['GET', /^\/api\/approvals$/, 'session', () => approval.pending()],
        ['POST', /^\/api\/push\/ticket$/, 'session', ({ session }) => push.ticket(session)], // het pushkanaal (push.js)
        ...deviceRoutes({ device, log }),
        ['GET', /^\/api\/settings$/, 'unlocked', () => registry.getSettings()],
        ...blockRoutes({ registry, auditAdmin, crypto, afterSettings: settingsChanged, httpError, policy }),
        // Gewijzigde certificaatketens zien en de nieuwe keten vertrouwen (alleen met een ontgrendelde kluis).
        ['GET', /^\/api\/tls$/, 'session', () => (tlsTrust ? tlsTrust.pendingChanges() : [])],
        ['GET', /^\/api\/tls\/trusted$/, 'session', async () => (tlsTrust?.trustedRoots ? tlsTrust.trustedRoots() : [])],
        ['GET', /^\/api\/tls\/added-roots$/, 'session', async () => (tlsTrust?.addedRoots ? tlsTrust.addedRoots() : [])],
        ['POST', /^\/api\/tls\/accept$/, 'unlocked', async ({ body }) => { await tlsTrust.accept(body.origin, { scope: body.scope ?? 'host' }); return { accepted: true }; }],
        ['POST', /^\/api\/tls\/revoke$/, 'unlocked', async ({ body }) => { await tlsTrust.revoke(body.origin || body.root); return { revoked: true }; }],
        ...vaultRoutes({ vault, auditAdmin, endSession, endOtherSessions, push }),
        checkRoute({ registry, policy, httpError }),
        ['PUT', /^\/api\/settings$/, 'unlocked', async ({ body }) => { const next = await managed.updateSettings(body); await settingsChanged(); return next; }],
    ];

    // ---- de handler ---------------------------------------------------------------------------------------------

    async function handle(req, res) {
        // DNS-rebinding: alleen requests voor onze eigen origin.
        if (req.headers.host !== `localhost:${port}`) {
            res.writeHead(421, { 'content-type': 'text/plain', ...SECURITY_HEADERS });
            res.end('wrong host: open the portal at http://localhost:' + port);
            return;
        }
        const url = new URL(req.url, origin);
        const render = { '/': renderPage, '/index.html': renderPage, '/touch': renderTouchPage }[url.pathname];
        if (req.method === 'GET' && render) {
            const nonce = crypto.randomToken();
            res.writeHead(200, {
                'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS,
                'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; font-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
            });
            res.end(render({ nonce }));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/api/push') { push.open(req, res, url.searchParams.get('ticket')); return; }
        const route = ROUTES.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
        try {
            if (!route) throw httpError('ROUTE', 'not found'); const [, pattern, auth, handler] = route;
            const session = auth === 'touch' ? null : await currentSession(req, res);
            if (req.method !== 'GET') {
                if (req.headers.origin && req.headers.origin !== origin) throw httpError('CSRF', 'cross-origin request');
                if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw httpError('CSRF', 'JSON required');
            }
            if (auth !== 'none' && auth !== 'touch' && !session) throw req.method !== 'GET' && hasSessionCookie(req) ? httpError('CSRF', 'missing or wrong CSRF token') : httpError('UNAUTHENTICATED', 'log in first');
            if (auth === 'unlocked') requireUnlocked();
            const raw = req.method === 'GET' ? {} : await readJson(req);
            const body = auth === 'unlocked' && req.method !== 'GET' ? await stepUp.guard({ method: req.method, path: url.pathname, body: raw, session }) : raw;
            const result = await handler({ req, res, body, session, match: pattern.exec(url.pathname), query: url.searchParams });
            send(res, 200, result);
        } catch (error) {
            const status = STATUS[error.code] ?? 500;
            if (error.retryAfterMs) res.setHeader('retry-after', String(Math.ceil(error.retryAfterMs / 1000)));
            if (status === 500) log({ event: 'portal-error', code: error.code ?? 'unknown' });
            // Nooit de oorspronkelijke melding van een onverwachte fout naar buiten; bekende fouten noemen alleen namen.
            send(res, status, { error: { code: error.code ?? 'INTERNAL', message: status === 500 ? 'internal error' : error.message, ...(error.rule ? { rule: error.rule } : {}), ...(error.stepUp ? { stepUp: error.stepUp } : {}), ...(error.files ? { files: error.files } : {}), ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) } });
        }
    }

    return Object.freeze({
        setPort: p => { port = p; origin = `http://localhost:${p}`; rp.setOrigin(origin); },
        setProxyPort: p => { proxyPort = p; },
        lockPortal, publish: push.publish, closeVault, handle,
        sessionUrl: () => (vault.isUnlocked() ? `${origin}/#session=${createTicket()}` : `${origin}/`),
    });
}
