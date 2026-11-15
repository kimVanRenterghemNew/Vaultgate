// Dunne laag over libsodium (sodium-native). Gedrag: wat versleuteld is, komt alleen terug met dezelfde sleutel én
// dezelfde context (AAD); alles wat niet klopt, faalt luid met een getagde fout.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createCrypto, DECRYPT_FAILED, KDF_TOO_WEAK, MIN_KDF } from '../../src/crypto/index.js';

const crypto = createCrypto();
const key = () => crypto.randomKey();

describe('crypto', () => {
    it('Given een veld When versleuteld en ontsleuteld met dezelfde sleutel en AAD Then komt de inhoud exact terug', () => {
        fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), fc.string(), (bytes, aad) => {
            const k = key();
            const enc = crypto.encrypt(k, Buffer.from(bytes), aad);
            expect(enc).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/);
            expect(crypto.decrypt(k, enc, aad).equals(Buffer.from(bytes))).toBe(true);
        }), { numRuns: 50 });
    });

    it('Given een versleuteld veld When de AAD, de sleutel of een byte verandert Then faalt ontsleutelen met DECRYPT_FAILED', () => {
        const k = key();
        const enc = crypto.encrypt(k, Buffer.from('waarde'), 'rec1|0|v1');
        const fails = fn => { try { fn(); return null; } catch (e) { return e.code; } };
        expect(fails(() => crypto.decrypt(k, enc, 'rec2|0|v1'))).toBe(DECRYPT_FAILED);
        expect(fails(() => crypto.decrypt(key(), enc, 'rec1|0|v1'))).toBe(DECRYPT_FAILED);
        const [v, n, c] = enc.split('.');
        const flipped = `${v}.${n}.${c.startsWith('A') ? 'B' : 'A'}${c.slice(1)}`;
        expect(fails(() => crypto.decrypt(k, flipped, 'rec1|0|v1'))).toBe(DECRYPT_FAILED);
        expect(fails(() => crypto.decrypt(k, 'v2.xx.yy', 'rec1|0|v1'))).toBe(DECRYPT_FAILED);
        expect(fails(() => crypto.decrypt(k, 'nonsense', 'rec1|0|v1'))).toBe(DECRYPT_FAILED);
        expect(fails(() => crypto.decrypt(k, 'v1.AAAA.' + c, 'rec1|0|v1'))).toBe(DECRYPT_FAILED); // nonce te kort
        expect(fails(() => crypto.decrypt(k, `v1.${n}.AAAA`, 'rec1|0|v1'))).toBe(DECRYPT_FAILED); // korter dan de tag
        expect(fails(() => crypto.decrypt(k, null, 'rec1|0|v1'))).toBe(DECRYPT_FAILED);
        expect(fails(() => crypto.openSealed(crypto.boxKeypair(), Buffer.alloc(10)))).toBe(DECRYPT_FAILED);
    });

    it('twee versleutelingen van dezelfde inhoud verschillen (willekeurige nonce)', () => {
        const k = key();
        expect(crypto.encrypt(k, Buffer.from('x'), 'a')).not.toBe(crypto.encrypt(k, Buffer.from('x'), 'a'));
    });

    it('Given een passphrase When Argon2id met dezelfde salt Then dezelfde sleutel; andere passphrase of salt: andere sleutel', async () => {
        const salt = crypto.randomSalt();
        const a = await crypto.deriveFromPassphrase('correct horse', salt, MIN_KDF);
        const b = await crypto.deriveFromPassphrase('correct horse', salt, MIN_KDF);
        const c = await crypto.deriveFromPassphrase('correct horsf', salt, MIN_KDF);
        const d = await crypto.deriveFromPassphrase('correct horse', crypto.randomSalt(), MIN_KDF);
        expect(crypto.equal(a, b)).toBe(true);
        expect(crypto.equal(a, c)).toBe(false);
        expect(crypto.equal(a, d)).toBe(false);
    });

    it('MOET weigeren: KDF-parameters onder het minimum (ops=2, mem=64 MiB)', async () => {
        await expect(crypto.deriveFromPassphrase('x', crypto.randomSalt(), { ops: 1, mem: MIN_KDF.mem })).rejects.toMatchObject({ code: KDF_TOO_WEAK });
        await expect(crypto.deriveFromPassphrase('x', crypto.randomSalt(), { ops: 2, mem: 1024 * 1024 })).rejects.toMatchObject({ code: KDF_TOO_WEAK });
        await expect(crypto.deriveFromPassphrase('x', crypto.randomSalt(), undefined)).rejects.toMatchObject({ code: KDF_TOO_WEAK });
    });

    it('subsleutels: deterministisch per (sleutel, id, context), verschillend bij een ander id of context', () => {
        const k = key();
        expect(crypto.equal(crypto.deriveSubkey(k, 1, 'ks-prf01'), crypto.deriveSubkey(k, 1, 'ks-prf01'))).toBe(true);
        expect(crypto.equal(crypto.deriveSubkey(k, 1, 'ks-prf01'), crypto.deriveSubkey(k, 2, 'ks-prf01'))).toBe(false);
        expect(crypto.equal(crypto.deriveSubkey(k, 1, 'ks-prf01'), crypto.deriveSubkey(k, 1, 'ks-tool1'))).toBe(false);
    });

    it('gesleutelde hash: zelfde sleutel zelfde hash, andere sleutel andere hash; geeft hex terug', () => {
        const k = key();
        expect(crypto.keyedHash(k, 'ks_abc')).toBe(crypto.keyedHash(k, 'ks_abc'));
        expect(crypto.keyedHash(k, 'ks_abc')).not.toBe(crypto.keyedHash(key(), 'ks_abc'));
        expect(crypto.keyedHash(k, 'ks_abc')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sleutelpaar: verzegelen naar de publieke sleutel opent alleen met het eigen paar', () => {
        const a = crypto.boxKeypair();
        const b = crypto.boxKeypair();
        const sealed = crypto.sealTo(a.publicKey, Buffer.from('vault key'));
        expect(crypto.openSealed(a, sealed).toString()).toBe('vault key');
        expect(() => crypto.openSealed(b, sealed)).toThrow(expect.objectContaining({ code: DECRYPT_FAILED }));
    });

    it('wipe zet een buffer op nullen; equal vergelijkt in constante tijd en is false bij verschillende lengte', () => {
        const k = key();
        crypto.wipe(k);
        expect(k.every(byte => byte === 0)).toBe(true);
        expect(crypto.equal(Buffer.from('ab'), Buffer.from('abc'))).toBe(false);
    });

    it('randomToken: url-veilig, 32 byte entropie, telkens anders', () => {
        const t = crypto.randomToken();
        expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(crypto.randomToken()).not.toBe(t);
    });
});
