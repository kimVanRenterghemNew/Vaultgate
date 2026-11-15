// Vertragen en melden aan de proxy-kant. Deel van de proxy (index.js).
//  - 9.13: na foute pogingen (FAILURE_RULES) een blokkade per client-adres of per tool; geblokkeerd = de verbinding
//    vasthouden (tarpit) en daarna 429 `throttled`. Eén audit-regel en één melding per blokkade, niet per request.
//  - 3.4: een toekenning met de soort "melding": hoogstens één melding per toekenning per minuut.
import { FAILURE_RULES } from '../throttle/index.js';

/** Hoeveel verbindingen de tarpit tegelijk vasthoudt; daarboven meteen 429 (de tarpit mag zelf geen DoS worden). */
const TARPIT_MAX = 64;
const NOTIFY_EVERY_MS = 60_000;

/**
 * @param {{ throttle: object|null, tarpitMs: number, notify: (n: { title, text }) => void, log: (e: object) => void,
 *           record: (entry: object) => Promise<boolean> }} deps
 */
export function createGuard({ throttle, tarpitMs, notify, log, record, t = key => key }) {
    let tarpitHeld = 0;
    const lastNotified = new Map(); // grant-id -> tijdstip

    /** Met een geldige key telt de tool, anders het client-adres (lawaai op dezelfde pc houdt een echte tool niet op). */
    const keyFor = (tool, client) => (tool ? `tool:${tool.id}` : `client:${client}`);

    const check = key => throttle?.check(key) ?? { blocked: false };
    const succeed = key => throttle?.succeed(key);

    /** Na een weigering: telt ze als foute poging, en start ze een blokkade? */
    async function afterDeny(key, rule, entry) {
        if (!throttle || !FAILURE_RULES.has(rule)) return;
        const { blockedNow, retryAfterMs } = throttle.fail(key);
        if (!blockedNow) return;
        await record({ ...entry, allow: false, rule: 'throttled', status: 429 });
        log({ event: 'throttled', key: key.split(':')[0], retryAfterMs });
        const actor = entry.tool
            ? t('tray.notify.actor.tool', { tool: entry.tool })
            : t('tray.notify.actor.client', { client: entry.client });
        notify({
            title: t('tray.notify.delayed.title'),
            text: t('tray.notify.delayed.text', { actor, seconds: Math.round(retryAfterMs / 1000) }),
        });
    }

    /** Geblokkeerd: de verbinding vasthouden, daarna 429. Geen audit per request (de blokkade zelf staat erin). */
    async function tarpit(req, res, { retryAfterMs }) {
        const answer = () => {
            if (res.headersSent || res.destroyed) return;
            res.writeHead(429, { 'content-type': 'application/json', 'x-vault-gate-rule': 'throttled', 'retry-after': String(Math.ceil(retryAfterMs / 1000)), 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: { type: 'vaultgate', rule: 'throttled', message: 'throttled' } }));
        };
        if (tarpitHeld >= TARPIT_MAX) return answer();
        tarpitHeld += 1;
        await new Promise(resolve => { const t = setTimeout(resolve, Math.min(retryAfterMs, tarpitMs)); req.once('close', () => { clearTimeout(t); resolve(); }); });
        tarpitHeld -= 1;
        return answer();
    }

    /** 3.4: doorgelaten onder een toekenning met de soort "melding". */
    function notifyUse(grant, { tool, secret, host, shownHost }) {
        const now = Date.now();
        if (now - (lastNotified.get(grant.id) ?? -Infinity) < NOTIFY_EVERY_MS) return;
        lastNotified.set(grant.id, now);
        log({ event: 'grant-notified', tool, secret, host });
        notify({
            title: t('tray.notify.used.title'),
            text: t('tray.notify.used.text', { tool, secret, host: shownHost }),
        });
    }

    return Object.freeze({ keyFor, check, succeed, afterDeny, tarpit, notifyUse });
}
