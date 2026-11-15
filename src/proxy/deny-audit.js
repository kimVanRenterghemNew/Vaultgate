// Audit-coalescing voor herhaalde identieke weigeringen.
// Eerste weigering schrijven we meteen; herhalingen worden samengevoegd tot een tellerregel.

export function createDenyAudit({ record, clock, coalesceMs, rules }) {
    const groups = new Map();
    const setLater = clock?.setTimeout ?? setTimeout;
    const clearLater = clock?.clearTimeout ?? clearTimeout;

    const keyOf = entry => JSON.stringify([entry.rule, entry.status ?? '', entry.mode ?? '', entry.tool ?? '', entry.secret ?? '', entry.host ?? '', entry.client ?? '', entry.method ?? '']);

    async function flushOne(key) {
        const group = groups.get(key);
        if (!group) return true;
        groups.delete(key);
        if (group.timer) clearLater(group.timer);
        if (group.suppressed === 0) return true;
        return record({ ...group.entry, count: group.suppressed, detail: 'coalesced' });
    }

    async function flushPending() {
        for (const key of [...groups.keys()]) await flushOne(key);
        return true;
    }

    async function recordDenied(entry) {
        if (coalesceMs <= 0 || !rules.has(entry.rule)) return record(entry);
        const key = keyOf(entry);
        const group = groups.get(key);
        if (!group) {
            const ok = await record(entry);
            groups.set(key, { entry, suppressed: 0, timer: null });
            return ok;
        }
        group.entry = entry;
        group.suppressed += 1;
        if (group.timer) clearLater(group.timer);
        group.timer = setLater(() => { flushOne(key).catch(() => {}); }, coalesceMs);
        return true;
    }

    return Object.freeze({ recordDenied, flushPending });
}
