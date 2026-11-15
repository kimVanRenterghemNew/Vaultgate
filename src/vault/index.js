// Kluis. Sleutelhiërarchie naar het model van Bitwarden:
//
//   VAULT KEY (32 B, willekeurig) ── verzegeld (crypto_box_seal) naar de publieke sleutel van elke ontgrendelmethode
//   methode m: (pk_m, sk_m); sk_m ingepakt met KEK_m (passphrase: Argon2id; passkey: PRF -> crypto_kdf; herstelcode: Argon2id)
//   ITEM KEY per record-versie, ingepakt met de vault key; elk veld apart versleuteld met de item key.
//
// Op schijf (store): `vault.json` (header, open: formaatversie, KDF-parameters, salts, ingepakte sleutels, publieke sleutels,
// het manifest {recordId: versie} en MAC's) en `records/<id>.<versie>.json`: de item key, de namenlijst en elk veld apart
// versleuteld (ook veldnamen en soort zijn dus niet leesbaar).
// Het manifest is het commit-punt: eerst de nieuwe recordversie, dan de header, dan de oude versie weg. Zijn MAC (sleutel
// afgeleid van de vault key) maakt een teruggezet of verwijderd record, en een onderschoven publieke sleutel, zichtbaar.
// Een teruggezette kopie van de hele map valt op aan de teller (epoch) buiten de kluismap: zie ./rollback.js. Gewijzigde
// eigen code (tray-script, portaal, ...) valt op aan de versleutelde lijst van hashes in de header: zie ./code-check.js.
//
// Wat ontgrendeld in het geheugen staat: alleen de vault key (beveiligd geheugen). Item keys en waarden bestaan alleen
// tijdens één get/put en worden daarna gewist (Buffers; een JS-string kan niet gewist worden, zie docs/security-model.md).

import { signHeader, verifyHeader } from './integrity.js';
import { newRecoveryCode, normalizeRecovery } from './recovery-code.js';
import { createEpochGuard, VAULT_ROLLED_BACK } from './rollback.js';
import { createMethods } from './methods.js';
import { checkCode, sealCode, codeChangedError } from './code-check.js';
import { createCredentials } from './credentials.js';

export { VAULT_ROLLED_BACK, epochLocation } from './rollback.js';
export { CODE_CHANGED } from './code-check.js';

export const VAULT_LOCKED = 'VAULT_LOCKED', VAULT_EXISTS = 'VAULT_EXISTS', VAULT_MISSING = 'VAULT_MISSING',
    VAULT_CORRUPT = 'VAULT_CORRUPT', VAULT_TAMPERED = 'VAULT_TAMPERED', WRONG_CREDENTIALS = 'WRONG_CREDENTIALS',
    WEAK_PASSPHRASE = 'WEAK_PASSPHRASE', INVALID_PRF = 'INVALID_PRF', RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
    LAST_METHOD = 'LAST_METHOD';

const FORMAT = 1;
const HEADER = 'vault.json';
const RECORDS = 'records/';
// Subsleutels van de vault key (crypto_kdf: id + context van 8 tekens).
const SUBKEY = Object.freeze({ mac: [1, 'ks-mac01'], toolKey: [2, 'ks-tool1'] });
const PRF_CONTEXT = [1, 'ks-prf01'];

const tagged = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const locked = () => tagged(VAULT_LOCKED, 'vault is locked', { rule: 'vault-locked' });
const wrong = () => tagged(WRONG_CREDENTIALS, 'wrong credentials', { rule: 'vault-locked' });
const tampered = what => tagged(VAULT_TAMPERED, `vault integrity check failed: ${what}`, { rule: 'vault-locked' });
const rolledBackError = () => tagged(VAULT_ROLLED_BACK, 'this is an older copy of the vault than the last one opened here; confirm to restore it', { rule: 'vault-rolled-back' });
const b64 = buf => Buffer.from(buf).toString('base64');
const unb64 = text => Buffer.from(text, 'base64');

/**
 * @param {{ store: import('../store/index.js').Store, crypto: ReturnType<import('../crypto/index.js').createCrypto>,
 *           clock: { now(): number }, kdf: { ops: number, mem: number },
 *           epoch?: { store: import('../store/index.js').Store, name: string }, code?: Record<string, string> }} deps
 *        epoch: de teller buiten de kluismap; code: de hashes van de eigen bestanden bij de start (zonder: geen controle)
 */
export function createVault({ store, crypto, clock, kdf, epoch, code }) {
    const epochGuard = createEpochGuard(epoch);
    let header = null; // laatst gelezen of geschreven header (open velden)
    let vaultKey = null; // Buffer in beveiligd geheugen, alleen als ontgrendeld
    let rolledBack = false; // de laatste poging botste op een oudere kopie (het portaal toont dan de bevestiging)
    let codeChanged = []; // de laatste poging botste op gewijzigde eigen bestanden (idem)
    let queue = Promise.resolve();
    const listeners = new Set();
    // Cache van ruwe recordbestanden (nog versleuteld): een proxy-request leest anders elk record van schijf. Geen waarde
    // staat hier ontsleuteld in; de cache verdwijnt bij vergrendelen.
    const rawCache = new Map();

    // Alles wat de header wijzigt, na elkaar: twee gelijktijdige writes mogen het manifest niet half overschrijven.
    const serialized = task => { const run = queue.then(task, task); queue = run.catch(() => {}); return run; };

    const notify = () => { const state = status(); for (const fn of listeners) fn(state); };

    // ---- vergrendelen ---------------------------------------------------------------------------------------------

    function lock() {
        if (!vaultKey) return;
        crypto.wipe(vaultKey);
        vaultKey = null;
        rawCache.clear();
        notify();
    }

    // De kluis sluit niet vanzelf: automatisch vergrendelen beëindigt alleen de portaalsessie (src/portal/sessions.js).
    // Alleen lock() wist de vault key: Log out (portaal of tray-menu), de audit-lockdown en stoppen.
    const isUnlocked = () => vaultKey !== null;

    /** Geeft de vault key als de kluis open is, anders VAULT_LOCKED. */
    const requireKey = () => { if (!isUnlocked()) throw locked(); return vaultKey; };

    function withSubkey([id, context], fn) {
        const sub = crypto.deriveSubkey(requireKey(), id, context);
        try { return fn(sub); } finally { crypto.wipe(sub); }
    }

    // ---- header en MAC's ------------------------------------------------------------------------------------------

    /** Herberekent alle MAC's met de (open) vault key en verhoogt de teller; alleen mogelijk als ontgrendeld. */
    const sign = h => withSubkey(SUBKEY.mac, mac => signHeader({ ...h, epoch: (h.epoch ?? 0) + 1 }, mac, crypto));

    function verify(h, key) {
        const mac = crypto.deriveSubkey(key, ...SUBKEY.mac);
        try { verifyHeader(h, mac, crypto, tampered); } finally { crypto.wipe(mac); }
    }

    async function writeHeader(h) {
        await store.write(HEADER, Buffer.from(JSON.stringify(h, null, 1)));
        header = h;
        if (h.epoch !== undefined) await epochGuard.record(h.epoch); // na de header: een crash ertussen is geen vals alarm
    }

    async function load() {
        const raw = await store.read(HEADER);
        if (!raw) { header = null; return status(); }
        try {
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed.format !== FORMAT || !Array.isArray(parsed.methods) || !parsed.manifest?.records) throw new Error('shape');
            header = parsed;
        } catch {
            const moved = await store.quarantine(HEADER);
            header = null;
            throw tagged(VAULT_CORRUPT, `vault header is unreadable; moved to ${moved}, nothing was overwritten`, { quarantined: moved });
        }
        return status();
    }

    // ---- ontgrendelmethodes ---------------------------------------------------------------------------------------

    const { newMethod, openWithKek, passphraseKek, passphraseMethod } = createMethods({ crypto, kdf, format: FORMAT, requireKey, wrong,
        weak: () => tagged(WEAK_PASSPHRASE, 'passphrase must not be empty') });

    /** MAC's, de teller (anti-rollback) en de eigen code: pas daarna open. Een kluis zonder teller krijgt er een.
     *  queue: na lopende updates, op de huidige header. Geeft de regelnamen [teller, code]. */
    async function becomeUnlocked(key, h, { acceptRollback, acceptCodeChange } = {}, queue = serialized) {
        let verdict, codeVerdict;
        try {
            verify(h, key);
            verdict = await epochGuard.check(h.epoch ?? 0, acceptRollback === true);
            rolledBack = !verdict.allow;
            if (rolledBack) throw rolledBackError();
            codeVerdict = checkCode({ key, sealed: h.code, current: code, accept: acceptCodeChange === true, crypto, tampered });
            codeChanged = codeVerdict.allow ? [] : codeVerdict.changed;
            if (!codeVerdict.allow) throw codeChangedError(codeChanged);
        } catch (error) {
            crypto.wipe(key);
            throw error;
        }
        vaultKey = key;
        try {
            const sealed = codeVerdict.rewrite ? { code: sealCode(key, code, crypto) } : {};
            if (verdict.rewrite || codeVerdict.rewrite || h.epoch === undefined) await queue(() => writeHeader(sign({ ...header, ...sealed, epoch: Math.max(verdict.known, h.epoch ?? 0) })));
            else await epochGuard.record(h.epoch);
        } catch (error) {
            lock();
            throw error;
        }
        notify();
        await queue(cleanupStaleRecords); // niet tijdens een update: haar nieuwe versie staat nog niet in het manifest
        return [verdict.rule, codeVerdict.rule];
    }

    /** Probeert elke methode van een type; de eerste die opent, wint. */
    async function unlockWith(type, kekFor) {
        if (!header) throw tagged(VAULT_MISSING, 'no vault');
        for (const m of header.methods.filter(x => x.type === type)) {
            const kek = await kekFor(m);
            if (!kek) continue;
            try {
                const key = openWithKek(m, kek);
                return { key, method: m };
            } catch {
                // volgende methode
            } finally {
                crypto.wipe(kek);
            }
        }
        throw wrong();
    }

    /** Nieuwe kluis: vault key, audit-sleutel en de eerste methodes (`methods()` draait met de vault key al open). */
    async function createVault(methods, credentials = []) {
        return serialized(async () => {
            if (header || await store.read(HEADER)) throw tagged(VAULT_EXISTS, 'a vault already exists here');
            vaultKey = crypto.randomKey();
            const audit = crypto.boxKeypair();
            try {
                const h = {
                    format: FORMAT,
                    methods: await methods(),
                    audit: { publicKey: b64(audit.publicKey), wrappedSecretKey: crypto.encrypt(vaultKey, audit.secretKey, `audit|sk|v${FORMAT}`) },
                    manifest: { records: {} },
                    credentials,
                    ...(code ? { code: sealCode(vaultKey, code, crypto) } : {}),
                };
                await writeHeader(sign(h));
            } catch (error) {
                lock();
                throw error;
            } finally {
                crypto.wipe(audit.secretKey);
            }
            notify();
        });
    }

    /** Een kluis met passphrase en herstelcode. */
    async function create({ passphrase }) {
        const recoveryCode = newRecoveryCode(crypto.randomBytes);
        await createVault(async () => [await passphraseMethod('passphrase', passphrase), await passphraseMethod('recovery', normalizeRecovery(recoveryCode))]);
        return { recoveryCode };
    }

    /** Een kluis die alleen met passkeys opent: de eerste passkey (met PRF) maakt ze. Geen passphrase, geen herstelcode. */
    async function createWithPasskey({ credential, prfOutput, prfSalt }) {
        if (!Buffer.isBuffer(prfOutput) || prfOutput.length !== 32) throw tagged(INVALID_PRF, 'PRF output must be 32 bytes');
        const prf = crypto.toSecure(prfOutput);
        const kek = crypto.deriveSubkey(prf, ...PRF_CONTEXT);
        crypto.wipe(prf);
        try {
            const extra = { credentialId: credential.id, prfSalt: prfSalt ?? crypto.randomBytes(32).toString('base64url') };
            await createVault(async () => [newMethod('passkey', kek, extra)], [{ ...credential, createdAt: clock.now() }]);
        } finally {
            crypto.wipe(kek);
        }
    }

    /** accept: `{ acceptRollback, acceptCodeChange }`, de bewuste bevestigingen van de gebruiker. */
    async function unlockWithPassphrase(passphrase, accept = {}) {
        const { key } = await unlockWith('passphrase', m => passphraseKek(passphrase, m));
        return becomeUnlocked(key, header, accept);
    }

    async function unlockWithPrf({ credentialId, prfOutput, acceptRollback, acceptCodeChange }) {
        if (!Buffer.isBuffer(prfOutput) || prfOutput.length !== 32) throw tagged(INVALID_PRF, 'PRF output must be 32 bytes');
        const prf = crypto.toSecure(prfOutput); // wist de invoer
        try {
            const { key } = await unlockWith('passkey', async m => (m.credentialId === credentialId ? crypto.deriveSubkey(prf, ...PRF_CONTEXT) : null));
            return await becomeUnlocked(key, header, { acceptRollback, acceptCodeChange });
        } finally {
            crypto.wipe(prf);
        }
    }

    /** Herstel: opent met de herstelcode en vervangt passphrase én herstelcode (beide verplicht nieuw). */
    async function recover({ recoveryCode, newPassphrase, acceptRollback, acceptCodeChange }) {
        if (typeof newPassphrase !== 'string' || newPassphrase.length === 0) throw tagged(WEAK_PASSPHRASE, 'a new passphrase is required');
        return serialized(async () => {
            const { key } = await unlockWith('recovery', m => passphraseKek(normalizeRecovery(recoveryCode), m));
            await becomeUnlocked(key, header, { acceptRollback, acceptCodeChange }, task => task()); // al in de rij
            const code = newRecoveryCode(crypto.randomBytes);
            const keep = header.methods.filter(m => m.type !== 'passphrase' && m.type !== 'recovery');
            const methods = [...keep, await passphraseMethod('passphrase', newPassphrase), await passphraseMethod('recovery', normalizeRecovery(code))];
            await writeHeader(sign({ ...header, methods }));
            return { recoveryCode: code };
        });
    }

    async function changePassphrase({ newPassphrase }) {
        requireKey();
        return serialized(async () => {
            const method = await passphraseMethod('passphrase', newPassphrase);
            await writeHeader(sign({ ...header, methods: [...header.methods.filter(m => m.type !== 'passphrase'), method] }));
        });
    }

    async function addPasskey({ credentialId, prfOutput, prfSalt }) {
        if (!Buffer.isBuffer(prfOutput) || prfOutput.length !== 32) throw tagged(INVALID_PRF, 'PRF output must be 32 bytes');
        requireKey();
        const prf = crypto.toSecure(prfOutput);
        return serialized(async () => {
            const kek = crypto.deriveSubkey(prf, ...PRF_CONTEXT);
            try {
                const method = newMethod('passkey', kek, { credentialId, prfSalt: prfSalt ?? crypto.randomBytes(32).toString('base64url') });
                const methods = [...header.methods.filter(m => !(m.type === 'passkey' && m.credentialId === credentialId)), method];
                await writeHeader(sign({ ...header, methods }));
                notify();
                return { id: method.id, prfSalt: method.prfSalt };
            } finally {
                crypto.wipe(kek);
                crypto.wipe(prf);
            }
        });
    }

    async function removePasskey(credentialId) {
        requireKey();
        return serialized(async () => {
            const methods = header.methods.filter(m => !(m.type === 'passkey' && m.credentialId === credentialId));
            await writeHeader(sign({ ...header, methods }));
            notify();
        });
    }

    const passkeySalts = () => (header?.methods ?? []).filter(m => m.type === 'passkey').map(m => ({ credentialId: m.credentialId, prfSalt: m.prfSalt }));

    function status() {
        const passkeyCount = passkeySalts().length;
        return Object.freeze({
            exists: header !== null, unlocked: vaultKey !== null, passkeyCount, needsMorePasskeys: passkeyCount < 2,
            credentialCount: header?.credentials?.length ?? 0,
            hasPassphrase: (header?.methods ?? []).some(m => m.type === 'passphrase'),
            hasRecovery: (header?.methods ?? []).some(m => m.type === 'recovery'),
            rolledBack, codeChanged: [...codeChanged],
        });
    }

    // ---- records --------------------------------------------------------------------------------------------------

    const recordName = (id, version) => `${RECORDS}${id}.${version}.json`;
    const keyAad = (id, version) => `${id}|key|${version}|v${FORMAT}`;
    const fieldAad = (id, index, version) => `${id}|${index}|${version}|v${FORMAT}`;

    async function readRecord(id) {
        const version = header.manifest.records[id];
        if (version === undefined) throw tagged(RECORD_NOT_FOUND, `no record ${id}`);
        const cached = rawCache.get(id);
        if (cached?.version === version) return cached;
        const raw = await store.read(recordName(id, version));
        if (!raw && header.manifest.records[id] !== version) return readRecord(id); // een update wiste de oude versie tijdens het lezen
        if (!raw) throw tampered(`record ${id} missing`);
        try {
            const rec = JSON.parse(raw.toString('utf8'));
            if (rec.id !== id || rec.version !== version || typeof rec.names !== 'string' || !Array.isArray(rec.fields)) throw new Error('shape');
            rawCache.set(id, rec);
            return rec;
        } catch {
            const moved = await store.quarantine(recordName(id, version));
            throw tagged(VAULT_CORRUPT, `record ${id} is unreadable; moved to ${moved}`, { quarantined: moved });
        }
    }

    /**
     * Ontsleutelt de namenlijst en daarna alleen de gevraagde velden (of alle). Een veld is aan zijn naam gebonden via zijn
     * positie: AAD = record | positie | versie, en de namenlijst zelf is geauthenticeerd. Zo wordt een secret-waarde niet
     * ontsleuteld als alleen de naam nodig is.
     */
    async function get(id, names) {
        const key = requireKey();
        const rec = await readRecord(id);
        const itemKey = crypto.toSecure(crypto.decrypt(key, rec.key, keyAad(id, rec.version)));
        try {
            const fieldNames = JSON.parse(crypto.decrypt(itemKey, rec.names, fieldAad(id, 'names', rec.version)).toString('utf8'));
            const out = {};
            fieldNames.forEach((name, index) => {
                if (names && !names.includes(name)) return;
                const plain = crypto.decrypt(itemKey, rec.fields[index], fieldAad(id, index, rec.version));
                try { out[name] = JSON.parse(plain.toString('utf8')); } finally { crypto.wipe(plain); }
            });
            return out;
        } finally {
            crypto.wipe(itemKey);
        }
    }

    async function put(fields, existingId) {
        requireKey();
        return serialized(async () => {
            const key = requireKey();
            const id = existingId ?? crypto.randomId();
            const previous = header.manifest.records[id];
            if (existingId && previous === undefined) throw tagged(RECORD_NOT_FOUND, `no record ${id}`);
            const version = (previous ?? 0) + 1;
            const itemKey = crypto.randomKey();
            try {
                const rec = {
                    id,
                    version,
                    key: crypto.encrypt(key, itemKey, keyAad(id, version)),
                    names: crypto.encrypt(itemKey, JSON.stringify(Object.keys(fields)), fieldAad(id, 'names', version)),
                    fields: Object.values(fields).map((value, index) => crypto.encrypt(itemKey, JSON.stringify(value ?? null), fieldAad(id, index, version))),
                };
                await store.write(recordName(id, version), Buffer.from(JSON.stringify(rec)));
            } finally {
                crypto.wipe(itemKey);
            }
            await writeHeader(sign({ ...header, manifest: { records: { ...header.manifest.records, [id]: version } } }));
            if (previous !== undefined) await store.remove(recordName(id, previous));
            return id;
        });
    }

    async function remove(id) {
        requireKey();
        return serialized(async () => {
            const version = header.manifest.records[id];
            if (version === undefined) return;
            const records = { ...header.manifest.records };
            delete records[id];
            rawCache.delete(id);
            await writeHeader(sign({ ...header, manifest: { records } }));
            await store.remove(recordName(id, version));
        });
    }

    async function ids() {
        requireKey();
        return Object.keys(header.manifest.records);
    }

    /** Recordversies die niet in het manifest staan (crash tussen record en header, of oude versies): opruimen. */
    async function cleanupStaleRecords() {
        for (const name of await store.list(RECORDS)) {
            const match = /^records\/([0-9a-f]+)\.(\d+)\.json$/.exec(name);
            if (!match || header.manifest.records[match[1]] !== Number(match[2])) await store.remove(name);
        }
    }

    // ---- tool-keys, audit en portaal-credentials ------------------------------------------------------------------

    const toolKeyHash = toolKey => withSubkey(SUBKEY.toolKey, k => crypto.keyedHash(k, toolKey));

    /** Werkt ook vergrendeld: de audit-regel wordt verzegeld naar de publieke audit-sleutel (alleen de kluis kan lezen). */
    function sealAudit(data) {
        if (!header) throw tagged(VAULT_MISSING, 'no vault');
        return crypto.sealTo(unb64(header.audit.publicKey), data);
    }

    function openAudit(sealed) {
        const key = requireKey();
        const secretKey = crypto.toSecure(crypto.decrypt(key, header.audit.wrappedSecretKey, `audit|sk|v${FORMAT}`));
        try { return crypto.openSealed({ publicKey: unb64(header.audit.publicKey), secretKey }, sealed); } finally { crypto.wipe(secretKey); }
    }

    // WebAuthn-credentials van het portaal: zie ./credentials.js.
    const credentialOps = createCredentials({ current: () => header, requireKey, serialized, writeHeader, sign, clock,
        lastMethod: () => tagged(LAST_METHOD, 'cannot remove the last passkey') });

    /** Verwijdert de hele kluis: records, header en externe teller. Sluit de kluis en meldt listeners. */
    async function deleteVault() {
        return serialized(async () => {
            lock();
            for (const name of await store.list(RECORDS)) await store.remove(name);
            await store.remove(HEADER);
            if (epochGuard.reset) await epochGuard.reset();
            header = null;
            rolledBack = false;
            codeChanged = [];
            notify();
        });
    }

    return Object.freeze({
        load,
        status,
        create,
        createWithPasskey,
        deleteVault,
        unlockWithPassphrase,
        unlockWithPrf,
        recover,
        changePassphrase,
        addPasskey,
        removePasskey,
        passkeySalts,
        lock,
        isUnlocked,
        onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        put,
        get,
        remove,
        ids,
        toolKeyHash,
        sealAudit,
        openAudit,
        ...credentialOps,
        /** Alleen voor tests: bewijst dat lock() de sleutel wist. */
        internalKeyForTest: () => vaultKey,
    });
}
