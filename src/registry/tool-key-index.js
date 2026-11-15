// In-memory index van tool-key-hashes -> tool: de huidige sleutel, de vorige (genadeperiode) en de familie. Een sleutel
// van een bekende familie die geen van beide is, is een oude (ingetrokken) sleutel: `retired`. Op Log out wissen we de index.

/** Een lange sleutel met familie: `ks_<familie, 32 hex>_<willekeurig>`. Een oudere key zonder familie heeft geen match. */
const FAMILY = /^ks_([0-9a-f]{32})_/;
export const familyOf = key => FAMILY.exec(key)?.[1] ?? null;

/**
 * @param {{ vault: { onChange?: Function, toolKeyHash(key: string): string },
 *           load: () => Promise<{ id: string, keyHash?: string|null, prevKeyHash?: string|null, family?: string }[]> }} deps
 */
export function createToolKeyIndex({ vault, load }) {
    let index = null;

    const clear = () => { index = null; };
    if (typeof vault.onChange === 'function') {
        vault.onChange(state => {
            if (state?.unlocked === false) clear();
        });
    }

    async function ensure() {
        if (index) return index;
        const tools = await load();
        const byHash = new Map();
        for (const t of tools) {
            if (t.prevKeyHash) byHash.set(t.prevKeyHash, { id: t.id, which: 'prev' });
            if (t.keyHash) byHash.set(t.keyHash, { id: t.id, which: 'current' });
        }
        index = { byHash, byFamily: new Map(tools.filter(t => t.family).map(t => [t.family, t.id])) };
        return index;
    }

    /** `{ id, which: 'current'|'prev'|'retired' }` of null. */
    async function lookup(key) {
        if (typeof key !== 'string' || !key.startsWith('ks_')) return null;
        const { byHash, byFamily } = await ensure();
        const hit = byHash.get(vault.toolKeyHash(key));
        if (hit) return hit;
        const id = byFamily.get(familyOf(key));
        return id ? { id, which: 'retired' } : null;
    }

    return Object.freeze({ lookup, clear });
}
