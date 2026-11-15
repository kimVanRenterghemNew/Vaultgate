// Ontgrendelmethodes van de kluis: per methode een sleutelpaar (pk, sk); sk ingepakt met de KEK van de methode
// (passphrase/herstelcode: Argon2id; passkey: PRF -> crypto_kdf), de vault key verzegeld naar pk (docs/security-model.md §2).

const b64 = buf => Buffer.from(buf).toString('base64');
const unb64 = text => Buffer.from(text, 'base64');

/**
 * @param {{ crypto: ReturnType<import('../crypto/index.js').createCrypto>, kdf: { ops: number, mem: number }, format: number,
 *           requireKey: () => Buffer, wrong: () => Error, weak: () => Error }} deps
 */
export function createMethods({ crypto, kdf, format, requireKey, wrong, weak }) {
    const methodAad = m => `method|${m.id}|${m.type}|v${format}`;

    /** Nieuwe methode: sleutelpaar, sk ingepakt met de KEK, vault key verzegeld naar pk. */
    function newMethod(type, kek, extra) {
        const id = crypto.randomId();
        const { publicKey, secretKey } = crypto.boxKeypair();
        const m = { id, type, ...extra, publicKey: b64(publicKey) };
        try {
            return {
                ...m,
                wrappedSecretKey: crypto.encrypt(kek, secretKey, methodAad(m)),
                sealedVaultKey: b64(crypto.sealTo(publicKey, requireKey())),
            };
        } finally {
            crypto.wipe(secretKey);
        }
    }

    /** Opent de vault key met de KEK van een methode; elke fout wordt WRONG_CREDENTIALS (geen orakel). */
    function openWithKek(m, kek) {
        let secretKey = null;
        try {
            secretKey = crypto.decrypt(kek, m.wrappedSecretKey, methodAad(m));
            const opened = crypto.openSealed({ publicKey: unb64(m.publicKey), secretKey }, unb64(m.sealedVaultKey));
            return crypto.toSecure(opened);
        } catch {
            throw wrong();
        } finally {
            crypto.wipe(secretKey);
        }
    }

    async function passphraseKek(passphrase, m) {
        return crypto.deriveFromPassphrase(passphrase, unb64(m.salt), m.kdf);
    }

    const kdfRecord = () => ({ alg: 'argon2id13', ops: kdf.ops, mem: kdf.mem });

    async function passphraseMethod(type, passphrase) {
        if (typeof passphrase !== 'string' || passphrase.length === 0) throw weak();
        const salt = crypto.randomSalt();
        const m = { salt: b64(salt), kdf: kdfRecord() };
        const kek = await crypto.deriveFromPassphrase(passphrase, salt, m.kdf);
        try { return newMethod(type, kek, m); } finally { crypto.wipe(kek); }
    }

    return Object.freeze({ newMethod, openWithKek, passphraseKek, passphraseMethod });
}
