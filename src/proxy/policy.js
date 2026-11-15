import { parseQuietHours, inQuietHours } from '../policy/index.js';

const activeUntil = (until, now) => until === null || until === undefined || now < until;

const localMinutes = now => {
    const d = new Date(now);
    return d.getHours() * 60 + d.getMinutes();
};

export const realClock = Object.freeze({ now: () => Date.now() });

const STATUS_FOR = Object.freeze({ 'unknown-route': 404, 'tunnel-not-supported': 405, 'bad-target': 400, 'upstream-error': 502, 'unsupported-encoding': 502 });

/**
 * Wat de tool van een weigering ziet. Een gesloten kluis (`vault-locked`) antwoordt na de goedkeurings-time-out zoals
 * een uitgebleven goedkeuring, zodat de tool niet ziet dat ze dicht is: `closed` zegt te wachten.
 * @returns {{ rule: string, status: number, closed: boolean }}
 */
export function answerFor(decision) {
    if (decision.rule === 'vault-locked') return { rule: 'approval-timeout', status: 401, closed: true };
    return { rule: decision.rule, status: decision.status ?? STATUS_FOR[decision.rule] ?? 403, closed: false };
}

export function readPolicyState(clock, policyState) {
    const now = clock.now();
    const state = policyState() ?? {};
    const quietWindows = parseQuietHours(state.quietHours ?? []);
    return {
        now,
        state,
        quietHours: inQuietHours(localMinutes(now), quietWindows),
        blocks: state.blocks ?? [],
    };
}

export function notificationSnoozed(state, grantId, now) {
    const snooze = state?.notificationSnooze ?? { globalUntil: null, grants: [] };
    if (snooze.globalUntil !== null && snooze.globalUntil !== undefined && now < snooze.globalUntil) return true;
    return (snooze.grants ?? []).some(g => g.grantId === grantId && activeUntil(g.until, now));
}

/** Wat de audit extra zegt over een toegestane call: geleerde plekken, een tijdelijke regel, de certificaat-root. */
export function auditDetail(approved) {
    const learned = approved.flatMap(a => a.learn ?? []);
    const roots = approved.filter(a => a.certRoot).map(a => `root ${a.certRoot}`); // een nieuw subdomein: zelfde certificaat-root?
    const parts = [...(learned.length ? ['learned ' + learned.join(',')] : []), ...(approved.some(a => a.temporary) ? ['temporary'] : []), ...roots];
    return parts.length ? { detail: parts.join('; ') } : {};
}
