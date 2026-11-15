export const INVALID_QUIET_HOURS = 'INVALID_QUIET_HOURS';
export const LAST_PASSKEY = 'LAST_PASSKEY';

const invalidQuietHours = (text, why) => Object.assign(new Error(`invalid quiet-hours window ${JSON.stringify(text)}: ${why}`), { code: INVALID_QUIET_HOURS });
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parseMinutes = text => {
    const m = HHMM.exec(String(text));
    if (!m) throw invalidQuietHours(text, 'use HH:MM (24h)');
    return Number(m[1]) * 60 + Number(m[2]);
};

/** Rustige uren als vensters `HH:MM-HH:MM`; meerdere vensters zijn toegestaan, over middernacht ook. */
export function parseQuietHours(windows) {
    if (!Array.isArray(windows)) throw invalidQuietHours(windows, 'expected a list of HH:MM-HH:MM windows');
    return Object.freeze(windows.map(text => {
        const [startText, endText, ...rest] = String(text).split('-');
        if (rest.length || !startText || !endText) throw invalidQuietHours(text, 'use HH:MM-HH:MM');
        const start = parseMinutes(startText);
        const end = parseMinutes(endText);
        if (start === end) throw invalidQuietHours(text, 'start and end may not be equal');
        return Object.freeze({ start, end, text: `${startText}-${endText}` });
    }));
}

/** Is het lokale tijdstip (minuten sinds 00:00) in een van de rustige vensters? */
export function inQuietHours(localMinutes, windows) {
    if (!Number.isInteger(localMinutes) || localMinutes < 0 || localMinutes > 1439) return false;
    return (windows ?? []).some(({ start, end }) => (start < end ? (localMinutes >= start && localMinutes < end) : (localMinutes >= start || localMinutes < end)));
}

const activeUntil = (until, now) => until === null || until === undefined || now < until;

/** Tijdelijke blokkade voor een combinatie. Volgorde: grant > secret > tool > passkey. */
export function blockRuleFor({ now, toolId, secretName, host, passkeyId }, blocks) {
    const list = blocks ?? [];
    const active = b => activeUntil(b.until, now);
    const match = {
        grant: b => b.kind === 'grant' && b.toolId === toolId && b.secretName === secretName && b.host === host,
        secret: b => b.kind === 'secret' && b.secretName === secretName,
        tool: b => b.kind === 'tool' && b.toolId === toolId,
        passkey: b => b.kind === 'passkey' && b.passkeyId === passkeyId,
    };
    if (list.some(b => active(b) && match.grant(b))) return 'grant-blocked';
    if (list.some(b => active(b) && match.secret(b))) return 'secret-blocked';
    if (list.some(b => active(b) && match.tool(b))) return 'tool-blocked';
    if (list.some(b => active(b) && match.passkey(b))) return 'passkey-blocked';
    return null;
}

/** Een passkey blokkeren mag nooit alle passkeys tegelijk blokkeren. */
export function ensureNotLastPasskey({ passkeyId, passkeys, blockedPasskeys }) {
    const blocked = new Set((blockedPasskeys ?? []).map(b => (typeof b === 'string' ? b : b?.passkeyId)).filter(Boolean));
    const ids = [...(passkeys ?? [])];
    const remaining = ids.filter(id => id !== passkeyId && !blocked.has(id));
    if (remaining.length === 0) throw Object.assign(new Error('cannot block the last passkey'), { code: LAST_PASSKEY });
    return true;
}