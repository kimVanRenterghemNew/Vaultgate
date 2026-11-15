// Een tool opnieuw koppelen na Rotate. Rotate geeft een nieuwe key en zet de tool 10 minuten open voor een
// koppeling met dezelfde naam (code en aanraking blijven nodig). Daarna, of als de tool ingetrokken is, is ze dicht:
// een koppeling met die naam is dan "naam bezet". Een oud record zonder einddatum is dicht (standaard dicht).
const tagged = (code, message) => Object.assign(new Error(message), { code });

/** Hoelang een tool na Rotate open staat voor een nieuwe koppeling. */
export const PAIRABLE_MS = 10 * 60_000;

/**
 * Staat deze tool (het kluisrecord) nu open voor een koppeling met dezelfde naam?
 * @param {{ pairableAfterRotate?: boolean, pairableUntil?: number, revoked?: boolean }} tool
 * @param {number} now
 */
export const isPairable = (tool, now) => tool.pairableAfterRotate === true && tool.revoked !== true && now < (tool.pairableUntil ?? 0);

/**
 * @param {{ vault, clock: { now(): number }, must: (kind: string, id: string) => Promise<object>,
 *           updateTool: (id: string, patch: object) => Promise<string>, newFamilyKey: () => { key: string, family: string } }} deps
 */
export function createToolPairing({ vault, clock, must, updateTool, newFamilyKey }) {
    // Een nieuwe key begint een nieuwe familie: handmatig tot de helper ze uitwisselt; de oude sleutels zijn onbekend.
    const fresh = () => { const { key, family } = newFamilyKey(); return { key, patch: { keyHash: vault.toolKeyHash(key), family, prevKeyHash: null, generation: 0, rotating: false } }; };
    /** Nieuwe key; de tool staat {@link PAIRABLE_MS} open voor een koppeling met dezelfde naam. */
    async function rotateToolKey(id) {
        const { key, patch } = fresh();
        await updateTool(id, { ...patch, pairableAfterRotate: true, pairableUntil: clock.now() + PAIRABLE_MS });
        return { id, key };
    }

    /** De key voor een goedgekeurde koppeling; NOT_FOUND als de tool niet (meer) open staat of ingetrokken is. */
    async function rePairToolKey(id) {
        const current = await must('tool', id);
        if (!isPairable(current, clock.now())) throw tagged('NOT_FOUND', 'tool is not waiting for a new pairing');
        const { key, patch } = fresh();
        await updateTool(id, { ...patch, pairableAfterRotate: false, pairableUntil: 0 });
        return { id, key };
    }

    return Object.freeze({ rotateToolKey, rePairToolKey });
}
