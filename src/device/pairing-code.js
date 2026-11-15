// De koppelcode: de tool toont ze in de terminal, de gebruiker typt ze in het portaal. Pas na een juiste code
// kan een aanvraag goedgekeurd worden. Vergelijken in constante tijd (op hashes); elke verkeerde code telt mee voor de
// throttle per client-adres, zodat raden (32^8 codes) niet loont.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: geen I, L, O, U
const tagged = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param {{ crypto: { randomBytes(n: number): Uint8Array, equal(a: Buffer, b: Buffer): boolean },
 *           hash: (text: string) => string, throttle?: { check, fail, succeed } | null }} deps
 *   hash: gesleutelde hash (hex) van de device flow; throttle: optioneel (zonder: geen remming).
 */
export function createPairingCode({ crypto, hash, throttle }) {
    /** Een nieuwe code `ABCD-EFGH` (8 tekens, 40 bit). */
    const create = () => {
        const chars = [...crypto.randomBytes(8)].map(byte => CODE_ALPHABET[byte & 31]).join('');
        return `${chars.slice(0, 4)}-${chars.slice(4)}`;
    };

    /**
     * Controleert de ingetypte code van aanvraag `id` (hoofdletters, spaties en streepje maken niet uit) en markeert de
     * aanvraag als `codeVerified`. Gooit DEVICE_CODE_INVALID (`device-code-invalid`) of TOO_MANY_REQUESTS
     * (`device-code-throttled`, met `retryAfterMs`).
     * @param {string} id
     * @param {unknown} supplied
     * @param {{ find: (id: string) => [string, object], requests: Map<string, object> }} store de aanvragen van de device flow
     * @returns {{ verified: true }}
     */
    function verify(id, supplied, { find, requests }) {
        const [key, request] = find(id);
        const throttleKey = `device-code:${request.client}`;
        const blocked = throttle?.check(throttleKey);
        if (blocked?.blocked) throw Object.assign(tagged('TOO_MANY_REQUESTS', 'too many incorrect pairing codes'), { retryAfterMs: blocked.retryAfterMs, rule: 'device-code-throttled' });
        const normalized = typeof supplied === 'string' ? supplied.toUpperCase().replace(/[\s-]/g, '') : '';
        const wellFormed = /^[0-9A-HJKMNP-TV-Z]{8}$/.test(normalized);
        const actual = Buffer.from(hash(normalized), 'hex');
        const expected = Buffer.from(hash(request.userCode.replace('-', '')), 'hex');
        if (!wellFormed || !crypto.equal(actual, expected)) {
            const failure = throttle?.fail(throttleKey);
            const error = tagged(failure?.blockedNow ? 'TOO_MANY_REQUESTS' : 'DEVICE_CODE_INVALID', 'the pairing code is incorrect');
            Object.assign(error, failure?.blockedNow ? { retryAfterMs: failure.retryAfterMs, rule: 'device-code-throttled' } : { rule: 'device-code-invalid' });
            throw error;
        }
        throttle?.succeed(throttleKey);
        requests.set(key, { ...request, codeVerified: true });
        return { verified: true };
    }

    return Object.freeze({ create, verify });
}
