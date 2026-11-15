// Anti-rollback: een oudere, geldige kopie van de hele kluismap terugzetten valt op aan een teller buiten de datamap.
// Echte lokale store in een tijdelijke map, de teller in een andere tijdelijke map, eigen passphrase per test.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fc from 'fast-check';
import { createVault, epochLocation, VAULT_ROLLED_BACK, VAULT_TAMPERED } from '../../src/vault/index.js';
import { MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';
import { crypto, fakeClock } from './fixtures.js';

const PASS = 'rollback test passphrase';
const LEGACY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vault-before-epoch');
let counter = 0;

/** Een kluismap en een tellerbestand buiten die map; `open()` maakt een nieuwe kluis-instantie (zoals een herstart). */
function place() {
    const root = path.join(process.env.VAULTGATE_HOME, `rollback-${process.pid}-${counter++}`);
    const dir = path.join(root, 'vault');
    const elsewhere = path.join(root, 'elsewhere');
    const epochFile = path.join(elsewhere, 'counter.json');
    const clock = fakeClock();
    const epoch = () => ({ store: choose('store', 'local', { dir: elsewhere }), name: 'counter.json' });
    const open = () => createVault({ store: choose('store', 'local', { dir }), epoch: epoch(), crypto, clock, kdf: MIN_KDF });
    const snapshot = () => { const to = `${dir}-copy-${counter++}`; fs.cpSync(dir, to, { recursive: true }); return to; };
    const restore = copy => { fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(copy, dir, { recursive: true }); };
    return { dir, epochFile, open, snapshot, restore };
}

async function opened(open) {
    const vault = open();
    await vault.load();
    await vault.unlockWithPassphrase(PASS);
    return vault;
}

describe('anti-rollback', () => {
    it('Given een volledige oudere kopie van de kluismap When ontgrendelen Then weigert Vaultgate met vault-rolled-back', async () => {
        const p = place();
        const first = p.open();
        await first.create({ passphrase: PASS });
        const grant = await first.put({ kind: 'grant', tool: 'agent' });
        const backup = p.snapshot();
        await first.remove(grant); // de intrekking
        first.lock();

        p.restore(backup);
        const later = p.open();
        await later.load();
        const error = await later.unlockWithPassphrase(PASS).catch(e => e);
        expect(error.code).toBe(VAULT_ROLLED_BACK);
        expect(error.rule).toBe('vault-rolled-back');
        expect(later.isUnlocked()).toBe(false);
        expect(later.internalKeyForTest()).toBeNull();
    });

    it('Given de huidige kluis When opnieuw starten en ontgrendelen Then geen vals alarm', async () => {
        const p = place();
        const first = p.open();
        await first.create({ passphrase: PASS });
        await first.put({ a: 1 });
        first.lock();
        const again = await opened(p.open);
        expect(again.isUnlocked()).toBe(true);
        await again.put({ b: 2 });
        again.lock();
        expect((await opened(p.open)).isUnlocked()).toBe(true);
    });

    it('Given een teruggezette kopie When de gebruiker het bewust bevestigt Then opent ze met de data van de kopie, en daarna gewoon', async () => {
        const p = place();
        const first = p.open();
        await first.create({ passphrase: PASS });
        const grant = await first.put({ kind: 'grant', tool: 'agent' });
        const backup = p.snapshot();
        await first.remove(grant);
        first.lock();

        p.restore(backup);
        const restored = p.open();
        await restored.load();
        await restored.unlockWithPassphrase(PASS, { acceptRollback: true });
        expect(await restored.get(grant)).toEqual({ kind: 'grant', tool: 'agent' });
        restored.lock();
        expect((await opened(p.open)).isUnlocked()).toBe(true); // de herstelde kopie is nu de geldige
    });

    it('Given een kopie van vóór de bevestigde herstelling When ze terugzetten Then weer geweigerd (de teller daalt nooit)', async () => {
        const p = place();
        const first = p.open();
        await first.create({ passphrase: PASS });
        const oldest = p.snapshot();
        await first.put({ a: 1 });
        await first.put({ b: 2 });
        first.lock();
        p.restore(oldest);
        const restored = p.open();
        await restored.load();
        await restored.unlockWithPassphrase(PASS, { acceptRollback: true });
        restored.lock();
        const afterRestore = p.snapshot();
        p.restore(oldest);
        const again = p.open();
        await again.load();
        expect((await again.unlockWithPassphrase(PASS).catch(e => e)).code).toBe(VAULT_ROLLED_BACK);
        p.restore(afterRestore);
        expect((await opened(p.open)).isUnlocked()).toBe(true);
    });

    it('Given de teller in de header verlaagd of weggehaald When ontgrendelen Then VAULT_TAMPERED (de teller zit onder de MAC)', async () => {
        for (const edit of [h => ({ ...h, epoch: h.epoch - 1 }), h => { const { epoch, ...rest } = h; return epoch ? rest : h; }]) {
            const p = place();
            const first = p.open();
            await first.create({ passphrase: PASS });
            await first.put({ a: 1 });
            first.lock();
            const file = path.join(p.dir, 'vault.json');
            fs.writeFileSync(file, JSON.stringify(edit(JSON.parse(fs.readFileSync(file, 'utf8')))));
            fs.rmSync(p.epochFile); // anders zou de externe teller het al vangen
            const again = p.open();
            await again.load();
            expect((await again.unlockWithPassphrase(PASS).catch(e => e)).code).toBe(VAULT_TAMPERED);
        }
    });

    it('Given een crash tussen header en externe teller When ontgrendelen Then opent ze (header voor) en haalt de teller bij', async () => {
        const p = place();
        const first = p.open();
        await first.create({ passphrase: PASS });
        const before = fs.readFileSync(p.epochFile);
        await first.put({ a: 1 });
        first.lock();
        fs.writeFileSync(p.epochFile, before); // de header is geschreven, de teller niet meer
        const again = await opened(p.open);
        expect(again.isUnlocked()).toBe(true);
        again.lock();
        expect(JSON.parse(fs.readFileSync(p.epochFile, 'utf8'))).not.toEqual(JSON.parse(before.toString()));
    });

    it('Given een onleesbaar tellerbestand When ontgrendelen Then geweigerd tot de gebruiker bevestigt (standaard dicht)', async () => {
        for (const bad of ['not json', '{"epoch":-4}', '{"epoch":"9"}', '{"epoch":1.5}']) {
            const p = place();
            const first = p.open();
            await first.create({ passphrase: PASS });
            first.lock();
            fs.writeFileSync(p.epochFile, bad);
            const again = p.open();
            await again.load();
            expect((await again.unlockWithPassphrase(PASS).catch(e => e)).code).toBe(VAULT_ROLLED_BACK);
            await again.unlockWithPassphrase(PASS, { acceptRollback: true });
            again.lock();
            expect((await opened(p.open)).isUnlocked()).toBe(true);
        }
    });

    it('Given een kluis van vóór de teller When ontgrendelen Then opent ze zonder dataverlies en is ze daarna tegen terugzetten beschermd', async () => {
        const p = place();
        fs.cpSync(LEGACY, p.dir, { recursive: true });
        const legacyCopy = p.snapshot();
        const vault = p.open();
        await vault.load();
        await vault.unlockWithPassphrase('legacy fixture passphrase');
        const [id] = await vault.ids();
        expect(await vault.get(id)).toEqual({ name: 'legacy-secret', value: 'FAKE-legacy-value-0001' });
        expect(JSON.parse(fs.readFileSync(path.join(p.dir, 'vault.json'), 'utf8')).epoch).toBeGreaterThan(0);
        vault.lock();

        p.restore(legacyCopy);
        const again = p.open();
        await again.load();
        expect((await again.unlockWithPassphrase('legacy fixture passphrase').catch(e => e)).code).toBe(VAULT_ROLLED_BACK);
    });

    it('Given een kluis met alleen passkeys en een teruggezette kopie When ontgrendelen met PRF Then geweigerd, en na bevestiging open', async () => {
        const p = place();
        const prf = () => Buffer.alloc(32, 7);
        const first = p.open();
        await first.createWithPasskey({ credential: { id: 'cred-1', publicKey: 'pk' }, prfOutput: prf() });
        const backup = p.snapshot();
        await first.put({ a: 1 });
        first.lock();
        p.restore(backup);
        const again = p.open();
        await again.load();
        expect((await again.unlockWithPrf({ credentialId: 'cred-1', prfOutput: prf() }).catch(e => e)).code).toBe(VAULT_ROLLED_BACK);
        expect(again.status().rolledBack).toBe(true);
        expect(await again.unlockWithPrf({ credentialId: 'cred-1', prfOutput: prf(), acceptRollback: true })).toContain('vault-rollback-accepted');
        expect(again.status()).toMatchObject({ unlocked: true, rolledBack: false });
    });

    it('de externe teller staat buiten de Vaultgate-map, per kluismap een eigen bestand, en het pad staat er niet leesbaar in', () => {
        const at = (vaultDir, env, platform) => epochLocation({ vaultDir, crypto, env, platform, homedir: '/home/u' });
        expect(at('/a/vault', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32').dir).toBe(path.join('C:\\Users\\u\\AppData\\Local', 'Vaultgate', 'epoch'));
        expect(at('/a/vault', {}, 'linux').dir).toBe(path.join('/home/u', '.local', 'state', 'vaultgate', 'epoch'));
        expect(at('/a/vault', { VAULTGATE_EPOCH_DIR: '/elsewhere' }, 'linux').dir).toBe('/elsewhere');
        const name = at('/a/vault', {}, 'linux').name;
        expect(name).toMatch(/^[0-9a-f]{64}\.json$/);
        expect(at('/b/vault', {}, 'linux').name).not.toBe(name);
    });

    it('invariant: na elke reeks wijzigingen opent alleen de laatste kopie zonder bevestiging, elke oudere wordt geweigerd', async () => {
        await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), fc.nat(), async (steps, pick) => {
            const p = place();
            const vault = p.open();
            await vault.create({ passphrase: PASS });
            const copies = [p.snapshot()];
            for (const add of steps) {
                const ids = await vault.ids();
                if (add || ids.length === 0) await vault.put({ n: ids.length }); else await vault.remove(ids[0]);
                copies.push(p.snapshot());
            }
            vault.lock();
            p.restore(copies[pick % (copies.length - 1)]);
            const old = p.open();
            await old.load();
            expect((await old.unlockWithPassphrase(PASS).catch(e => e)).code).toBe(VAULT_ROLLED_BACK);
            p.restore(copies.at(-1));
            expect((await opened(p.open)).isUnlocked()).toBe(true);
        }), { numRuns: 8 });
    });
});
