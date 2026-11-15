// Dunne laag over libsodium. Alleen libsodium-primitieven, geen eigen
// cryptografie: XChaCha20-Poly1305 (AEAD) voor velden en ingepakte sleutels, Argon2id voor passphrase en herstelcode,
// crypto_kdf (BLAKE2b) voor subsleutels en PRF -> KEK, gesleutelde BLAKE2b voor tool-key-hashes, crypto_box_seal voor
// ontgrendelmethodes en audit. Fouten zijn getagd; een mislukte ontsleuteling zegt nooit iets over de inhoud.
import sodium from 'sodium-native';

export const DECRYPT_FAILED = 'DECRYPT_FAILED';
export const KDF_TOO_WEAK = 'KDF_TOO_WEAK';

/** Minimum dat de kluis afdwingt: libsodium INTERACTIVE, boven OWASP (19 MiB, t=2). */
export const MIN_KDF = Object.freeze({ ops: 2, mem: 64 * 1024 * 1024 });
/** Standaard voor nieuwe kluizen: libsodium MODERATE, ±0,4-0,7 s op de ontwikkelmachine. */
export const DEFAULT_KDF = Object.freeze({ ops: 3, mem: 256 * 1024 * 1024 });

const KEY_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
const NONCE_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
const TAG_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
const FORMAT = 'v1';

const decryptFailed = () => Object.assign(new Error('decryption failed'), { code: DECRYPT_FAILED });
const kdfTooWeak = (kdf) => Object.assign(new Error(`KDF parameters below minimum (ops ${kdf.ops} < ${MIN_KDF.ops} or mem ${kdf.mem} < ${MIN_KDF.mem})`), { code: KDF_TOO_WEAK });

const b64 = buf => Buffer.from(buf).toString('base64url');
const unb64 = text => Buffer.from(text, 'base64url');
const toBuffer = data => (Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));

export function createCrypto() {
    const randomBytes = n => { const b = Buffer.alloc(n); sodium.randombytes_buf(b); return b; };
    /** Sleutel in beveiligd geheugen (sodium_malloc: mlock + guard pages). */
    const secureBuffer = n => sodium.sodium_malloc(n);
    const randomKey = () => { const k = secureBuffer(KEY_BYTES); sodium.randombytes_buf(k); return k; };

    /** `v1.<nonce>.<ciphertext>` (base64url), zoals een Bitwarden-EncString. AAD bindt de context (record, veld, versie). */
    function encrypt(key, data, aad) {
        const plain = toBuffer(data);
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = Buffer.alloc(plain.length + TAG_BYTES);
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(cipher, plain, Buffer.from(aad), null, nonce, key);
        return `${FORMAT}.${b64(nonce)}.${b64(cipher)}`;
    }

    function decrypt(key, enc, aad) {
        const parts = typeof enc === 'string' ? enc.split('.') : [];
        if (parts.length !== 3 || parts[0] !== FORMAT) throw decryptFailed();
        const nonce = unb64(parts[1]);
        const cipher = unb64(parts[2]);
        if (nonce.length !== NONCE_BYTES || cipher.length < TAG_BYTES) throw decryptFailed();
        const plain = Buffer.alloc(cipher.length - TAG_BYTES);
        try {
            sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, cipher, Buffer.from(aad), nonce, key);
        } catch {
            throw decryptFailed();
        }
        return plain;
    }

    /** Argon2id, asynchroon (blokkeert de proxy niet). Weigert parameters onder MIN_KDF. */
    async function deriveFromPassphrase(passphrase, salt, kdf) {
        if (!(kdf?.ops >= MIN_KDF.ops && kdf?.mem >= MIN_KDF.mem)) throw kdfTooWeak(kdf ?? {});
        const out = secureBuffer(KEY_BYTES);
        const pass = Buffer.from(String(passphrase).normalize('NFC'), 'utf8');
        try {
            await sodium.crypto_pwhash_async(out, pass, salt, kdf.ops, kdf.mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
        } finally {
            sodium.sodium_memzero(pass);
        }
        return out;
    }

    /** crypto_kdf_derive_from_key: subsleutel `id` in context (precies 8 tekens). Ook PRF-uitvoer -> KEK (geen HKDF in de binding). */
    function deriveSubkey(key, id, context) {
        const out = secureBuffer(KEY_BYTES);
        sodium.crypto_kdf_derive_from_key(out, id, Buffer.from(context.padEnd(8, '_').slice(0, 8)), key);
        return out;
    }

    function keyedHash(key, data) {
        const out = Buffer.alloc(32);
        sodium.crypto_generichash(out, toBuffer(data), key);
        return out.toString('hex');
    }

    function boxKeypair() {
        const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
        const secretKey = secureBuffer(sodium.crypto_box_SECRETKEYBYTES);
        sodium.crypto_box_keypair(publicKey, secretKey);
        return { publicKey, secretKey };
    }

    function sealTo(publicKey, data) {
        const plain = toBuffer(data);
        const out = Buffer.alloc(plain.length + sodium.crypto_box_SEALBYTES);
        sodium.crypto_box_seal(out, plain, publicKey);
        return out;
    }

    function openSealed({ publicKey, secretKey }, sealed) {
        if (sealed.length < sodium.crypto_box_SEALBYTES) throw decryptFailed();
        const out = Buffer.alloc(sealed.length - sodium.crypto_box_SEALBYTES);
        if (!sodium.crypto_box_seal_open(out, sealed, publicKey, secretKey)) throw decryptFailed();
        return out;
    }

    return Object.freeze({
        KEY_BYTES,
        randomBytes,
        randomKey,
        secureBuffer,
        randomSalt: () => randomBytes(sodium.crypto_pwhash_SALTBYTES),
        randomToken: () => b64(randomBytes(32)),
        randomId: () => randomBytes(16).toString('hex'),
        encrypt,
        decrypt,
        deriveFromPassphrase,
        deriveSubkey,
        keyedHash,
        boxKeypair,
        sealTo,
        openSealed,
        wipe: buf => { if (buf) sodium.sodium_memzero(buf); },
        equal: (a, b) => a.length === b.length && sodium.sodium_memcmp(a, b),
        /** Kopie van een gewone buffer in beveiligd geheugen (bv. PRF-uitvoer); de bron wordt gewist. */
        toSecure: (buf) => { const out = secureBuffer(buf.length); buf.copy(out); sodium.sodium_memzero(buf); return out; },
    });
}
