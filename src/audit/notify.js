// Een melding in de tray bij elke beheerwijziging (een auditregel met mode 'admin'): een zin per regelnaam met alleen
// namen (tool, secret, host), de herkomst in de titel, nooit een waarde of het detail van de regel. Blokkeert niets.
// Stil tijdens sluimeren en rustige uren. Gelijke wijzigingen (zelfde regel, zelfde onderwerp) binnen een minuut worden
// één melding plus een samenvatting; een key-rotatie hoogstens één ballon per tool per `rotationNoticeMs` (standaard
// 8 uur), de eerste na koppelen (generatie 1) of na een herstart altijd. Deel van de audit (index.js).
import { parseQuietHours, inQuietHours } from '../policy/index.js';

export const NOTICE_COALESCE_MS = 60_000;
export const ROTATION_NOTICE_MS = 8 * 60 * 60_000;

/** De beheerregels die Vaultgate schrijft; elk heeft een zin in i18n (`tray.notify.admin.rules.<regel>`). */
export const ADMIN_NOTICE_RULES = Object.freeze([
    'secret-added', 'secret-rotated', 'secret-hosts-changed', 'secret-places-changed', 'secret-sensitive-changed', 'secret-renamed', 'secret-removed',
    'tool-added', 'tool-renamed', 'tool-clients-changed', 'tool-defaults-changed', 'tool-reask-changed', 'tool-key-rotated', 'tool-key-repaired',
    'tool-revoked', 'tool-reactivated', 'tool-removed', 'key-rotated',
    'grant-added', 'grant-changed', 'grant-removed', 'passkey-renamed', 'passkey-removed', 'new-passkey-added', 'passkey-prf-enrolled',
    'settings-changed', 'tool-blocked', 'tool-unblocked', 'secret-blocked', 'secret-unblocked', 'grant-blocked', 'grant-unblocked', 'passkey-blocked', 'passkey-unblocked',
    'notifications-snoozed', 'notifications-resumed', 'grant-notifications-snoozed', 'grant-notifications-resumed',
    'vault-recovered', 'tls-chain-accepted', 'tls-untrusted-accepted',
]);
/** Geen wijziging op zich: hoort altijd bij een andere beheerregel (die meldt al). */
const NOT_A_CHANGE = new Set(['step-up-confirmed']);
const ORIGINS = new Set(['portal', 'tray', 'device', 'proxy']);

const localMinutes = now => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); };
const silenced = (state, now) => (state.notificationSnooze?.globalUntil ?? 0) > now || inQuietHours(localMinutes(now), parseQuietHours(state.quietHours ?? []));

/**
 * @param {{ notify: (n: { title: string, text: string }) => void, translate: (key: string, params?: object) => string,
 *           clock: { now(): number, setTimeout?: Function }, policyState: () => object }} deps
 * @returns {{ notice: (entry: object) => void }}
 */
export function createAdminNotices({ notify, translate: t, clock, policyState = () => ({}) }) {
    const later = clock.setTimeout ?? setTimeout;
    const groups = new Map(); // regel|onderwerp -> { entry, more }
    const rotated = new Map(); // tool -> laatste ballon (in het geheugen: een herstart meldt opnieuw)

    function sentence(entry) {
        const names = { tool: entry.tool ?? '', secret: entry.secret ?? '', host: entry.host ?? '', rule: entry.rule };
        const key = ADMIN_NOTICE_RULES.includes(entry.rule) ? `tray.notify.admin.rules.${entry.rule}` : 'tray.notify.admin.rules.other';
        return t(key, names);
    }

    function show(entry, more = 0) {
        const now = clock.now();
        if (silenced(policyState() ?? {}, now)) return;
        const title = t(`tray.notify.admin.title.${ORIGINS.has(entry.origin) ? entry.origin : 'other'}`);
        notify({ title, text: more ? t('tray.notify.admin.more', { count: more, text: sentence(entry) }) : sentence(entry) });
    }

    function rotation(entry) {
        const now = clock.now();
        const every = policyState()?.rotationNoticeMs ?? ROTATION_NOTICE_MS;
        const last = rotated.get(entry.tool);
        if (last !== undefined && !/^generation 1\b/.test(entry.detail ?? '') && now - last < every) return;
        rotated.set(entry.tool, now);
        show(entry);
    }

    function notice(entry) {
        if (entry?.mode !== 'admin' || NOT_A_CHANGE.has(entry.rule)) return;
        if (entry.rule === 'key-rotated') return rotation(entry);
        const key = JSON.stringify([entry.rule, entry.tool ?? '', entry.secret ?? '', entry.host ?? '']);
        const group = groups.get(key);
        if (group) { group.entry = entry; group.more += 1; return; }
        groups.set(key, { entry, more: 0 });
        later(() => { const g = groups.get(key); groups.delete(key); if (g?.more) show(g.entry, g.more); }, NOTICE_COALESCE_MS)?.unref?.(); // houdt het proces niet open
        show(entry);
    }

    return Object.freeze({ notice });
}
