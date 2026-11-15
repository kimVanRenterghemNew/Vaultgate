// Portaalsessies: een willekeurig id in een HttpOnly/SameSite=Strict-cookie, plus een token per sessie dat alleen de pagina
// kent (sessionStorage: per origin, dus per poort, anders dan een cookie op localhost) en bij elk request in de header
// `x-csrf-token` meestuurt. Een cookie zonder dat token is geen sessie: een andere localhost-dienst die het cookie
// ontvangt, kan er niets mee lezen of wijzigen.
// Een sessie verloopt na `idleMs()` zonder portaalhandeling of na `maxSessionMs` totaal: dat is het automatisch
// vergrendelen (een Lock, zoals een vergrendelde pc die doorwerkt; de kluis blijft open). `idleMs()` wordt bij elk request
// gelezen, dus een andere instelling geldt meteen. Proxy-calls tellen niet: een tool houdt het portaal niet open.
// Een request met `x-portal-refresh: 1` (de pagina die na een push opnieuw ophaalt) telt niet als handeling: anders houdt
// een tool via het pushkanaal het portaal toch open. De vlag kan een sessie alleen niet verlengen.
// Een falende audit houdt een request nooit tegen: de fout gaat naar de log, zonder inhoud.

const cookieId = req => /(?:^|;\s*)ks_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1];

/**
 * @param {object} deps
 * @param {Map<string, {created: number, lastSeen: number, csrf: string}>} deps.sessions gedeelde sessietabel (id -> sessie)
 * @param {{randomToken: () => string}} deps.crypto
 * @param {{now: () => number}} deps.clock
 * @param {{append: (entry: object) => Promise<void>}} deps.audit
 * @param {(event: object) => void} [deps.log]
 * @param {() => number} deps.idleMs de ingestelde tijd voor automatisch vergrendelen
 * @param {number} deps.maxSessionMs
 */
export function createPortalSessions({ sessions, crypto, clock, audit, log = () => {}, idleMs, maxSessionMs }) {
    /** Hoe lang de sessie nog geldig is zonder portaalhandeling (0 = verlopen): de kortste van de twee grenzen. */
    const remaining = (session, now) => Math.max(0, Math.min(idleMs() - (now - session.lastSeen), maxSessionMs - (now - session.created)));

    /** Maakt een nieuwe sessie, ruimt verlopen sessies op en zet het cookie. Geeft de sessie met haar id. */
    function newSession(res) {
        const now = clock.now();
        for (const [id, session] of sessions) if (remaining(session, now) === 0) sessions.delete(id);
        const id = crypto.randomToken();
        const session = { created: now, lastSeen: now, csrf: crypto.randomToken() };
        sessions.set(id, session);
        res.setHeader('set-cookie', `ks_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
        return { ...session, id };
    }

    /**
     * De geldige sessie van dit request (cookie én token), met `lockInMs` (tijd tot automatisch vergrendelen), of null.
     * Een verlopen sessie wordt gewist en geaudit (`portal-locked`, `idle-expiry`); de audit wacht niet.
     * Bij een geldige sessie krijgt het antwoord `x-lock-in-ms`, zodat de afteller in de kopbalk na elke handeling opnieuw begint.
     */
    async function currentSession(req, res) {
        const id = cookieId(req);
        const session = id && sessions.get(id);
        if (!session) return null;
        const now = clock.now();
        if (remaining(session, now) === 0) {
            sessions.delete(id);
            audit.append({ mode: 'portal', method: 'SESSION', allow: true, rule: 'portal-locked', status: 200, detail: 'idle-expiry' })
                .catch(error => log({ event: 'audit-failed', code: error.code ?? 'unknown' }));
            return null;
        }
        if (req.headers['x-csrf-token'] !== session.csrf) return null;
        if (req.headers['x-portal-refresh'] !== '1') session.lastSeen = now;
        const lockInMs = remaining(session, now);
        res?.setHeader('x-lock-in-ms', String(lockInMs));
        return { ...session, id, lockInMs };
    }

    /** Hoort het cookie bij een lopende sessie (los van het token)? Een schrijfactie zonder token is dan een CSRF-poging. */
    const hasSessionCookie = req => sessions.has(cookieId(req) ?? '');

    /** Is de sessie met dit id nog geldig? Verlengt niets. */
    const isLive = id => { const session = sessions.get(id); return Boolean(session) && remaining(session, clock.now()) > 0; };

    /** Het id van de lopende sessie van dit cookie (zonder token, zonder te verlengen), of null. Voor het pushkanaal. */
    const liveSessionId = req => { const id = cookieId(req); return id && isLive(id) ? id : null; };

    /** Wist de sessie van dit request (als er een is) en het cookie. */
    function endSession(req, res) {
        const id = cookieId(req);
        if (id) sessions.delete(id);
        res.setHeader('set-cookie', 'ks_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    }

    const tickets = new Map(); // ticket -> expires
    const TICKET_MS = 30_000;

    /** Maakt een eenmalig, kortlevend kaartje voor de sessie-URL uit de tray. */
    function createTicket() {
        const now = clock.now();
        for (const [t, exp] of tickets) if (now > exp) tickets.delete(t);
        const ticket = crypto.randomToken();
        tickets.set(ticket, now + TICKET_MS);
        return ticket;
    }

    /** Wisselt een eenmalig kaartje in voor een echte sessie; eenmalig bruikbaar. */
    function redeemTicket(ticket, res) {
        const expires = tickets.get(ticket);
        tickets.delete(ticket);
        if (!expires || clock.now() > expires) return null;
        return newSession(res);
    }

    return Object.freeze({ newSession, currentSession, endSession, hasSessionCookie, liveSessionId, isLive, createTicket, redeemTicket });
}
