// Vertragen na foute pogingen. De product owner: "5 foute pogingen in 3 min, dan niet meer antwoorden tot ze zelf in
// time-out gaan, en een melding". Per sleutel (`client:<adres>` of `tool:<id>`) houden we de tijdstippen van foute
// pogingen bij in een glijdend venster; boven de drempel is de sleutel geblokkeerd. Elke volgende blokkade (zonder
// geslaagde call ertussen) duurt dubbel zo lang, tot een maximum. Alles in het geheugen, begrensd in aantal sleutels.

/**
 * Weigeringen die op raden of aftasten wijzen. Een beslissing van de gebruiker (weigeren, time-out) telt niet.
 * `bad-target` (een gecodeerd pad onder een pad-prefix of een onleesbaar doel) maakt een werkende tool niet herhaaldelijk.
 */
export const FAILURE_RULES = Object.freeze(new Set([
    'no-tool-key', 'tool-key-revoked', 'client-not-allowed', 'no-placeholder',
    'unknown-secret', 'target-host-not-allowed', 'placeholder-location-not-allowed', 'bad-target',
]));

/**
 * @param {{ clock: { now() }, threshold?: number, windowMs?: number, blockMs?: number, maxBlockMs?: number, maxKeys?: number }} deps
 */
export function createThrottle({ clock, threshold = 5, windowMs = 180_000, blockMs = 60_000, maxBlockMs = 15 * 60_000, maxKeys = 10_000 }) {
    const keys = new Map(); // sleutel -> { failures: number[], blockedUntil, blocks }

    function entry(key) {
        let e = keys.get(key);
        if (!e) {
            if (keys.size >= maxKeys) keys.delete(keys.keys().next().value); // de oudste eruit
            e = { failures: [], blockedUntil: 0, blocks: 0 };
            keys.set(key, e);
        }
        return e;
    }

    function check(key) {
        const e = keys.get(key);
        const left = e ? e.blockedUntil - clock.now() : 0;
        return left > 0 ? { blocked: true, retryAfterMs: left } : { blocked: false };
    }

    /** Een foute poging. `blockedNow` alleen bij de poging die de blokkade start (dan één melding). */
    function fail(key) {
        const now = clock.now();
        const e = entry(key);
        if (e.blockedUntil > now) return { blockedNow: false };
        e.failures = [...e.failures.filter(t => now - t < windowMs), now];
        if (e.failures.length < threshold) return { blockedNow: false };
        const duration = Math.min(blockMs * 2 ** e.blocks, maxBlockMs);
        e.blocks += 1;
        e.blockedUntil = now + duration;
        e.failures = [];
        return { blockedNow: true, retryAfterMs: duration };
    }

    const succeed = key => { keys.delete(key); };

    return Object.freeze({ check, fail, succeed, size: () => keys.size });
}
