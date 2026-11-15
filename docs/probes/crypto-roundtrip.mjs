// Probe: de gekozen bibliotheek (sodium-native) kan alles wat de kluis nodig heeft.
// Geen productcode: dit toont alleen dat de primitieven er zijn en zich gedragen zoals het ontwerp aanneemt.
// Faalt (exitcode 1) zodra één controle niet klopt, en controleert ook wat hij MOET afwijzen (gewijzigde AAD, andere sleutel).
import sodium from 'sodium-native';

const failures = [];
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failures.push(name); };
const random = n => { const b = Buffer.alloc(n); sodium.randombytes_buf(b); return b; };
const rejects = fn => { try { fn(); return false; } catch { return true; } };

const NONCE = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
const TAG = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
const seal = (key, plain, aad) => {
    const nonce = random(NONCE);
    const cipher = Buffer.alloc(plain.length + TAG);
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(cipher, plain, aad, null, nonce, key);
    return { nonce, cipher };
};
const open = (key, { nonce, cipher }, aad) => {
    const plain = Buffer.alloc(cipher.length - TAG);
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, cipher, aad, nonce, key);
    return plain;
};

// 1. passphrase -> KEK (Argon2id, async: de event loop blijft draaien)
const salt = random(sodium.crypto_pwhash_SALTBYTES);
const kek = sodium.sodium_malloc(32);
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 5);
await sodium.crypto_pwhash_async(kek, Buffer.from('correct horse battery staple'), salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE, sodium.crypto_pwhash_ALG_ARGON2ID13);
clearInterval(timer);
check(`Argon2id async blokkeert de event loop niet (${ticks} timer-ticks tijdens de afleiding)`, ticks > 0);

// 2. vault key inpakken met de KEK, AAD bindt de context
const vaultKey = sodium.sodium_malloc(32);
sodium.randombytes_buf(vaultKey);
const aad = Buffer.from('vault|vault-key|passphrase|v1');
const wrapped = seal(kek, vaultKey, aad);
check('vault key uitpakken met dezelfde AAD geeft dezelfde sleutel', sodium.sodium_memcmp(open(kek, wrapped, aad), vaultKey));
check('uitpakken met een gewijzigde AAD faalt', rejects(() => open(kek, wrapped, Buffer.from('vault|vault-key|passkey-1|v1'))));
check('uitpakken met een andere sleutel faalt', rejects(() => open(random(32), wrapped, aad)));

// 3. ontgrendelmethode als sleutelpaar: vault key verzegeld naar de publieke sleutel
const pk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
const sk = sodium.sodium_malloc(sodium.crypto_box_SECRETKEYBYTES);
sodium.crypto_box_keypair(pk, sk);
const sealed = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES);
sodium.crypto_box_seal(sealed, vaultKey, pk);
const unsealed = sodium.sodium_malloc(32);
check('crypto_box_seal_open geeft de vault key terug', sodium.crypto_box_seal_open(unsealed, sealed, pk, sk) && sodium.sodium_memcmp(unsealed, vaultKey));
const otherPk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
const otherSk = sodium.sodium_malloc(sodium.crypto_box_SECRETKEYBYTES);
sodium.crypto_box_keypair(otherPk, otherSk);
check('openen met een ander sleutelpaar faalt', !sodium.crypto_box_seal_open(Buffer.alloc(32), sealed, otherPk, otherSk));

// 4. PRF-uitvoer -> KEK zonder HKDF (die zit niet in de binding): crypto_kdf_derive_from_key
const prf = random(32);
const derive = (input, context) => { const out = Buffer.alloc(32); sodium.crypto_kdf_derive_from_key(out, 1, Buffer.from(context), input); return out; };
check('PRF-afleiding is deterministisch', derive(prf, 'ks-prf01').equals(derive(prf, 'ks-prf01')));
check('andere PRF-uitvoer geeft een andere KEK', !derive(prf, 'ks-prf01').equals(derive(random(32), 'ks-prf01')));
check('andere context geeft een andere KEK', !derive(prf, 'ks-prf01').equals(derive(prf, 'ks-aud01')));

// 5. gesleutelde hash (tool-key-hash, manifest-MAC)
const hash = (key, input) => { const out = Buffer.alloc(32); sodium.crypto_generichash(out, Buffer.from(input), key); return out; };
const hashKey = random(32);
check('gesleutelde hash is deterministisch met dezelfde sleutel', hash(hashKey, 'ks_tool').equals(hash(hashKey, 'ks_tool')));
check('gesleutelde hash verschilt met een andere sleutel', !hash(hashKey, 'ks_tool').equals(hash(random(32), 'ks_tool')));

// 6. wissen
sodium.sodium_memzero(vaultKey);
check('memzero wist de vault key', vaultKey.every(byte => byte === 0));
for (const buffer of [kek, sk, otherSk, unsealed, prf]) sodium.sodium_memzero(buffer);

if (failures.length) {
    console.error(`\n${failures.length} controle(s) gefaald`);
    process.exit(1);
}
console.log('\nalle controles geslaagd');
