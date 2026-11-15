// Start vergrendeld, ontgrendelen met de passphrase. De kluis sluit niet vanzelf: automatisch vergrendelen beëindigt
// alleen de portaalsessie (zoals een vergrendelde pc die doorwerkt); alleen lock() wist de vault key.
import { describe, it, expect } from 'vitest';
import { newVault, fakeClock } from './fixtures.js';
import { VAULT_LOCKED } from '../../src/vault/index.js';
import { MIN_KDF } from '../../src/crypto/index.js';

describe('ontgrendelen en sluiten', () => {
    it('een bestaande kluis start vergrendeld', async () => {
        const { vault, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        const fresh = reopen();
        await fresh.load();
        expect(fresh.isUnlocked()).toBe(false);
        expect(fresh.status()).toMatchObject({ exists: true, unlocked: false });
    });

    it('Given een ontgrendelde kluis en een klok When een dag niemand iets doet Then blijft ze open: automatisch vergrendelen sluit alleen het portaal', async () => {
        const clock = fakeClock();
        const { vault } = newVault({ clock });
        await vault.create({ passphrase: 'p' });
        const id = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        clock.advance(24 * 3_600_000);
        expect(vault.isUnlocked()).toBe(true);
        expect((await vault.get(id)).value).toBe('1');
        expect(vault.status()).not.toHaveProperty('lockInMs');
    });

    it('Given een ontgrendelde kluis When lock() (Log out, de audit-lockdown, stoppen) Then is ze dicht (rule vault-locked) en meldt ze de overgang', async () => {
        const { vault } = newVault();
        const events = [];
        vault.onChange(state => events.push(state.unlocked));
        await vault.create({ passphrase: 'p' });
        const id = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        vault.lock();
        expect(events).toEqual([true, false]);
        expect(vault.isUnlocked()).toBe(false);
        await expect(vault.get(id)).rejects.toMatchObject({ code: VAULT_LOCKED, rule: 'vault-locked' });
    });

    it('de Argon2id-parameters staan in de kluis en worden bij het ontgrendelen gebruikt', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        const header = JSON.parse((await store.read('vault.json')).toString());
        const pass = header.methods.find(m => m.type === 'passphrase');
        expect(pass.kdf).toEqual({ alg: 'argon2id13', ops: MIN_KDF.ops, mem: MIN_KDF.mem });
    });

    it('MOET weigeren: een kluis waarvan de opgeslagen KDF-parameters onder het minimum gezet zijn', async () => {
        const { vault, store, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        const header = JSON.parse((await store.read('vault.json')).toString());
        header.methods.find(m => m.type === 'passphrase').kdf.ops = 1;
        await store.write('vault.json', Buffer.from(JSON.stringify(header)));
        const again = reopen();
        await again.load();
        await expect(again.unlockWithPassphrase('p')).rejects.toMatchObject({ code: 'KDF_TOO_WEAK' });
    });

    it('create weigert een tweede kluis over een bestaande heen', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        await expect(vault.create({ passphrase: 'q' })).rejects.toMatchObject({ code: 'VAULT_EXISTS' });
    });
});
