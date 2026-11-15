// Kortlevende tokens van tools (10 minuten), uitgegeven bij een uitwisseling van de lange sleutel. Alleen in het geheugen
// en alleen als gesleutelde hash (sleutel per proces): een herstart of Log out (de kluis sluit) wist ze allemaal, en de
// helper wisselt dan opnieuw uit met de lange sleutel. Deel van de registry (index.js).

/** Hoelang een token geldt. */
export const TOKEN_MS = 10 * 60_000;

/**
 * @param {{ crypto: { randomKey(): Buffer, randomToken(): string, keyedHash(key: Buffer, data: string): string },
 *           clock: { now(): number }, vault: { onChange?: Function } }} deps
 */
export function createToolSessions({ crypto, clock, vault }) {
    let hashKey = null; // pas bij het eerste token
    const tokens = new Map(); // hash(token) -> { toolId, expiresAt }
    const hash = token => crypto.keyedHash(hashKey ??= crypto.randomKey(), token);
    vault.onChange?.(state => { if (state?.unlocked === false) tokens.clear(); });

    const sweep = now => { for (const [h, s] of tokens) if (now >= s.expiresAt) tokens.delete(h); };

    /** Een nieuw token voor deze tool; de waarde verlaat deze functie alleen naar de aanroeper (het antwoord aan de helper). */
    function issue(toolId) {
        const now = clock.now();
        sweep(now);
        const token = `ks_${crypto.randomToken()}`;
        tokens.set(hash(token), { toolId, expiresAt: now + TOKEN_MS });
        return token;
    }

    /** De tool van een geldig token, of null (onbekend of verlopen). */
    function find(token) {
        if (typeof token !== 'string' || !token.startsWith('ks_')) return null;
        const h = hash(token);
        const session = tokens.get(h);
        if (!session) return null;
        if (clock.now() >= session.expiresAt) { tokens.delete(h); return null; }
        return session;
    }

    /** Alle tokens van een tool meteen ongeldig (Rotate, Revoke, verwijderen, hergebruik). */
    function dropTool(toolId) {
        for (const [h, s] of tokens) if (s.toolId === toolId) tokens.delete(h);
    }

    return Object.freeze({ issue, find, dropTool });
}
