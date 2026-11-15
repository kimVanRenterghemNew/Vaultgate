// Tool-keys die vanzelf roteren: refresh-token-rotatie met hergebruikdetectie (OAuth 2.1, RFC 9700 §4.14). De helper van
// een gekoppelde tool biedt haar lange sleutel aan en krijgt een token van 10 minuten plus een nieuwe lange sleutel; de
// oude is daarna ongeldig. Elke sleutel draagt de familie van de tool; een sleutel van die familie die niet de huidige of
// de vorige is, is een kopie: de tool wordt ingetrokken, zonder iets te ontsleutelen. De vorige sleutel blijft geldig tot
// de nieuwe één keer gebruikt is (genade bij een crash tussen uitgeven en bewaren). Ontwerp: docs/security-model.md §3.1.
// Deel van de registry (index.js).
import { decide } from '../decision/index.js';
import { clientAllowed, parseClientRules } from '../policy/index.js';
import { createToolSessions, TOKEN_MS } from './tool-sessions.js';
import { createToolKeyIndex } from './tool-key-index.js';

/** Uitwisselen: eerste regel die past wint (docs/architecture.md §5). */
export const EXCHANGE_RULES = Object.freeze([
    { name: 'no-tool-key', when: ctx => !ctx.match || !ctx.tool, then: { allow: false, status: 401 } },
    { name: 'tool-key-revoked', when: ctx => ctx.tool.revoked === true, then: { allow: false, status: 401 } },
    { name: 'client-not-allowed', when: ctx => !clientAllowed(ctx.client, parseClientRules(ctx.tool.clients)), then: { allow: false, status: 403 } },
    { name: 'key-reuse-detected', when: ctx => ctx.match.which === 'retired', then: { allow: false, status: 401 } },
    { name: 'key-exchanged', when: () => true, then: { allow: true, status: 200 } },
]);

/**
 * @param {{ vault, clock: { now(): number }, crypto, all: Function, toolView: Function, toolFields: string[] }} deps
 */
export function createKeyRotation({ vault, clock, crypto, all, toolView, toolFields }) {
    const keys = createToolKeyIndex({ vault, load: () => all('tool', ['keyHash', 'prevKeyHash', 'family']) });
    const sessions = createToolSessions({ crypto, clock, vault });
    const locks = new Map(); // tool-id -> de laatste uitwisseling: na elkaar, nooit twee opvolgers van dezelfde sleutel tegelijk

    /** Een nieuwe lange sleutel van een familie (zonder familie: een nieuwe). */
    const newFamilyKey = (family = crypto.randomId()) => ({ family, key: `ks_${family}_${crypto.randomToken()}` });

    async function readTool(id, fields) {
        try {
            if ((await vault.get(id, ['kind'])).kind !== 'tool') return null;
            return await vault.get(id, fields);
        } catch (error) {
            if (error.code === 'RECORD_NOT_FOUND') return null;
            throw error;
        }
    }

    function serial(id, work) {
        const run = (locks.get(id) ?? Promise.resolve()).then(work, work);
        locks.set(id, run.catch(() => {}));
        return run;
    }

    /** De tool bij een token (`via: 'token'`) of een geldige lange sleutel (`via: 'key'`); ook ingetrokken (dan wint die regel). */
    async function findToolByKey(key) {
        const session = sessions.find(key);
        const hit = session ? { id: session.toolId } : await keys.lookup(key);
        if (!hit || hit.which === 'retired') return null;
        const found = await readTool(hit.id, toolFields);
        if (!found) { keys.clear(); return null; }
        return { ...toolView({ id: hit.id, ...found }), via: session ? 'token' : 'key' };
    }

    /** Hergebruik: de tool dicht, alle sleutels en tokens ongeldig; de familie blijft bekend (elke latere kopie valt op). */
    async function closeFamily(id, record) {
        await vault.put({ ...record, revoked: true, keyHash: null, prevKeyHash: null }, id);
        sessions.dropTool(id);
        keys.clear();
    }

    /**
     * Lange sleutel in, token en nieuwe lange sleutel uit. `confirm(tool)`: een aanraking als de tool "opnieuw vragen elke
     * N uur" heeft en die tijd voorbij is ('ok' | 'denied' | 'timeout' | 'unavailable').
     * @returns {Promise<{ allow: boolean, rule: string, status: number, tool?: { id, name }, token?, key?, expiresIn?, generation?, grace? }>}
     */
    async function exchangeToolKey(key, { client, confirm = async () => 'unavailable' } = {}) {
        const first = await keys.lookup(key);
        if (!first) return decide({ match: null }, EXCHANGE_RULES);
        return serial(first.id, async () => {
            const match = await keys.lookup(key); // opnieuw, binnen de beurt: een vorige uitwisseling kan alles veranderd hebben
            const record = match ? await readTool(match.id) : null;
            const decision = decide({ match, tool: record, client }, EXCHANGE_RULES);
            const tool = record ? { id: match.id, name: record.name } : undefined;
            if (decision.rule === 'key-reuse-detected') await closeFamily(match.id, record);
            if (!decision.allow) return { ...decision, tool };
            const now = clock.now();
            const touched = record.reaskMs > 0 && now - (record.touchedAt ?? 0) >= record.reaskMs;
            if (touched) {
                const answer = await confirm(tool);
                if (answer !== 'ok') return { allow: false, rule: `touch-${answer}`, status: 403, tool };
            }
            const grace = match.which === 'prev';
            const next = newFamilyKey(record.family ?? undefined);
            const generation = (record.generation ?? 0) + 1;
            // Met de vorige sleutel (genade): de vorige blijft de vorige, de onbenutte huidige vervalt.
            await vault.put({ ...record, family: next.family, keyHash: vault.toolKeyHash(next.key), prevKeyHash: grace ? record.prevKeyHash : record.keyHash,
                generation, rotating: true, ...(touched ? { touchedAt: now } : {}) }, match.id);
            keys.clear();
            return { ...decision, tool, token: sessions.issue(match.id), key: next.key, expiresIn: TOKEN_MS / 1000, generation, grace };
        });
    }

    return Object.freeze({ newFamilyKey, findToolByKey, exchangeToolKey, readTool, dropSessions: sessions.dropTool, clearKeys: keys.clear });
}
