// Pushkanaal van het portaal naar de pagina (Server-Sent Events, `GET /api/push`). Een bericht noemt alleen de soort
// van wat veranderde (`data: audit`); de pagina haalt de gegevens zelf op via de gewone API, met sessie en token.
//
// Overdracht van de sessie: EventSource kan geen header sturen, dus geen `x-csrf-token`. De pagina haalt daarom eerst met
// cookie en token een kaartje (`POST /api/push/ticket`): willekeurig, eenmalig (verbruikt zodra het aangeboden wordt),
// 30 s geldig en gebonden aan die sessie. De stroom vraagt het kaartje én het cookie van dezelfde lopende sessie. Een cookie
// alleen (een andere localhost-dienst) of een kaartje alleen (bv. uit een log) opent niets. Het token staat nooit in een URL.
// De stroom verlengt de sessie niet; ze sluit zodra de sessie niet meer geldig is (Lock, Log out, automatisch vergrendelen).
import { decide } from '../decision/index.js';

/** De soorten die gepusht mogen worden; iets anders is een programmeerfout. */
export const PUSH_KINDS = Object.freeze(['audit', 'approvals', 'device', 'admin', 'settings', 'lock']);

const TICKET_MS = 30_000;
const HEARTBEAT_MS = 15_000; // ping en controle van de sessie

const RULES = Object.freeze([
    { name: 'push-no-session', when: ctx => !ctx.sessionId, then: { allow: false } },
    { name: 'push-ticket-invalid', when: ctx => !ctx.ticket || ctx.ticket.sessionId !== ctx.sessionId || ctx.now > ctx.ticket.expires, then: { allow: false } },
    { name: 'push-allowed', when: () => true, then: { allow: true } },
]);

/**
 * @param {object} deps
 * @param {{randomToken: () => string}} deps.crypto
 * @param {{now: () => number}} deps.clock
 * @param {(event: object) => void} deps.log
 * @param {(req: object) => string|null} deps.liveSessionId het id van de lopende sessie van het cookie, of null
 * @param {(id: string) => boolean} deps.isLive
 * @param {object} deps.headers vaste beveiligingsheaders
 */
export function createPush({ crypto, clock, log, liveSessionId, isLive, headers }) {
    const tickets = new Map(); // kaartje -> { sessionId, expires }
    const streams = new Set(); // { sessionId, res }

    /** Een kaartje voor de sessie van dit request (de route vraagt al sessie en token). */
    function ticket(session) {
        const now = clock.now();
        for (const [t, v] of tickets) if (now > v.expires) tickets.delete(t);
        const value = crypto.randomToken();
        tickets.set(value, { sessionId: session.id, expires: now + TICKET_MS });
        return { ticket: value };
    }

    /** Sluit elke stroom waarvan de sessie niet meer geldig is. */
    function prune() {
        for (const s of streams) if (!isLive(s.sessionId)) { streams.delete(s); s.res.end(); }
    }

    /** `GET /api/push?ticket=…`: 401 zonder geldige sessie en kaartje, anders een open stroom. */
    function open(req, res, value) {
        const presented = value ? tickets.get(value) : undefined;
        if (value) tickets.delete(value);
        const verdict = decide({ sessionId: liveSessionId(req), ticket: presented, now: clock.now() }, RULES);
        if (!verdict.allow) {
            log({ event: 'push-refused', rule: verdict.rule });
            res.writeHead(401, { 'content-type': 'application/json', ...headers });
            res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'open the push channel with a fresh ticket', rule: verdict.rule } }));
            return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
        res.write(': open\n\n');
        const stream = { sessionId: presented.sessionId, res };
        streams.add(stream);
        const beat = setInterval(() => { if (isLive(stream.sessionId)) res.write(': ping\n\n'); else prune(); }, HEARTBEAT_MS);
        beat.unref?.();
        res.on('close', () => { clearInterval(beat); streams.delete(stream); });
    }

    /** Meldt aan elke open stroom dat `kind` veranderde, en zet dat in de log (alleen de soort). */
    function publish(kind) {
        if (!PUSH_KINDS.includes(kind)) throw Object.assign(new Error('unknown push kind'), { code: 'UNKNOWN_PUSH_KIND' });
        if (streams.size === 0) return;
        for (const s of streams) s.res.write(`data: ${kind}\n\n`);
        log({ event: 'ui-push', kind });
    }

    /** Na het beëindigen van sessies: de pagina's horen het (`lock`), daarna sluiten de stromen zonder geldige sessie. */
    function sessionsEnded() {
        publish('lock');
        prune();
    }

    return Object.freeze({ ticket, open, publish, sessionsEnded });
}
