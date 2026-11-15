// De herstelcode van een kluis met passphrase: 160 bit in Crockford base32 (geen I, L, O, U), in groepjes van 4.
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @param {(n: number) => Buffer} randomBytes */
export function newRecoveryCode(randomBytes) {
    const bytes = randomBytes(20); // 160 bit
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) { out += RECOVERY_ALPHABET[(value >> (bits - 5)) & 31]; bits -= 5; }
    }
    return out.match(/.{4}/g).join('-');
}

/** Hoofdletters, zonder streepjes; O wordt 0, I en L worden 1 (tikfouten die niets uitmaken). */
export const normalizeRecovery = code => String(code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
