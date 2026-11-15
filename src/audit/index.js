// Audit-log: append-only segmenten `audit/<nr>.log`, één regel per beslissing, elke regel apart verzegeld
// (crypto_box_seal) naar de audit-sleutel van de kluis. Schrijven kan dus ook vergrendeld; lezen alleen ontgrendeld.
// Alleen velden uit een vaste lijst worden bewaard: namen en beslissingen, nooit waarden, body's of headers.

import { VAULT_LOCKED } from '../vault/index.js';

export { auditedRegistry, adminRecorder, describeChange } from './admin.js';
export { createAdminNotices, ADMIN_NOTICE_RULES, NOTICE_COALESCE_MS, ROTATION_NOTICE_MS } from './notify.js';

const FIELDS = Object.freeze(['t', 'requestId', 'mode', 'tool', 'secret', 'host', 'client', 'method', 'allow', 'rule', 'status', 'origin', 'detail', 'count', 'grantRemainingMs', 'inspected']);
const MAX_FIELD = 200;
const PREFIX = 'audit/';

const segmentName = n => `${PREFIX}${String(n).padStart(8, '0')}.log`;
const segmentNumber = name => Number(/(\d+)\.log$/.exec(name)?.[1] ?? 0);

function clean(entry, now) {
    const out = { t: now };
    for (const key of FIELDS) {
        const value = entry[key];
        if (value === undefined || value === null || key === 't') continue;
        if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
        else out[key] = String(value).slice(0, MAX_FIELD);
    }
    return out;
}

export function createAudit({ vault, store, clock, maxSegmentBytes = 1024 * 1024, maxSegments = 20 }) {
    let current = null; // { n, bytes }
    let queue = Promise.resolve();
    let unreadable = 0;

    async function currentSegment() {
        if (current) return current;
        const names = await store.list(PREFIX);
        const last = names.at(-1);
        current = last ? { n: segmentNumber(last), bytes: (await store.read(last))?.length ?? 0 } : { n: 1, bytes: 0 };
        return current;
    }

    async function rotate() {
        current = { n: current.n + 1, bytes: 0 };
        const names = await store.list(PREFIX);
        // Na de rotatie komt er één segment bij; houd er maxSegments in totaal.
        for (const old of names.slice(0, Math.max(0, names.length + 1 - maxSegments))) await store.remove(old);
    }

    function append(entry) {
        const run = queue.then(async () => {
            const line = Buffer.from(`${vault.sealAudit(Buffer.from(JSON.stringify(clean(entry, clock.now())))).toString('base64')}\n`);
            const segment = await currentSegment();
            if (segment.bytes > 0 && segment.bytes + line.length > maxSegmentBytes) await rotate();
            await store.append(segmentName(current.n), line);
            current.bytes += line.length;
        });
        queue = run.catch(() => {});
        return run;
    }

    // Beheer (mode 'admin') is een eigen soort: niet toegestaan of tegengehouden, maar een wijziging.
    const decided = (e, decision) => (decision === 'admin' ? e.mode === 'admin' : e.mode !== 'admin' && (decision === 'allow') === (e.allow === true));
    const matches = (e, f) => (!f.tool || e.tool === f.tool) && (!f.secret || e.secret === f.secret) && (!f.host || e.host === f.host)
        && (!f.decision || decided(e, f.decision)) && (!f.rule || e.rule === f.rule);

    /** Laatste eerst. Vereist een ontgrendelde kluis (de audit-sleutel zit erin). */
    async function read(filter = {}) {
        const limit = filter.limit ?? 500;
        const out = [];
        let skipped = 0;
        const names = (await store.list(PREFIX)).reverse();
        if (!vault.isUnlocked()) throw Object.assign(new Error('vault is locked'), { code: VAULT_LOCKED, rule: 'vault-locked' });
        for (const name of names) {
            const lines = (await store.read(name)).toString('utf8').split('\n').filter(Boolean).reverse();
            for (const line of lines) {
                let entry;
                try {
                    entry = JSON.parse(vault.openAudit(Buffer.from(line, 'base64')).toString('utf8'));
                } catch (error) {
                    if (error.code === VAULT_LOCKED) throw error;
                    skipped++;
                    continue;
                }
                // Nieuwste eerst: vanaf de eerste regel vóór `since` komt er niets meer bij.
                if (filter.since && entry.t < filter.since) { unreadable = skipped; return out; }
                if (matches(entry, filter)) out.push(entry);
                if (out.length >= limit) { unreadable = skipped; return out; }
            }
        }
        unreadable = skipped;
        return out;
    }

    return Object.freeze({ append, read, stats: () => ({ unreadable }) });
}
