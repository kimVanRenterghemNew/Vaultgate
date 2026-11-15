// Ontgrendelen met een passkey via de PRF-extensie. De PRF-uitvoer (32 byte, vast per credential en salt) wordt
// met crypto_kdf_derive_from_key een KEK; die opent de eigen kopie van de vault key. Een nep-authenticator = een vaste uitvoer.
import { describe, it, expect } from 'vitest';
import { newVault, crypto } from './fixtures.js';
import { WRONG_CREDENTIALS } from '../../src/vault/index.js';

const prf = () => crypto.randomBytes(32);

describe('ontgrendelen met een passkey', () => {
    it('Given een nep-authenticator met vaste PRF-uitvoer When ontgrendelen Then is de kluis open; met een andere uitvoer niet', async () => {
        const { vault, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        const id = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        const output = prf();
        const { prfSalt } = await vault.addPasskey({ credentialId: 'cred-1', prfOutput: Buffer.from(output), prfSalt: 'c2FsdA' });
        expect(prfSalt).toBe('c2FsdA');
        vault.lock();

        const again = reopen();
        await again.load();
        expect(again.passkeySalts()).toEqual([{ credentialId: 'cred-1', prfSalt: 'c2FsdA' }]);
        await expect(again.unlockWithPrf({ credentialId: 'cred-1', prfOutput: prf() })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await expect(again.unlockWithPrf({ credentialId: 'cred-onbekend', prfOutput: Buffer.from(output) })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        expect(again.isUnlocked()).toBe(false);
        const input = Buffer.from(output);
        await again.unlockWithPrf({ credentialId: 'cred-1', prfOutput: input });
        expect(await again.get(id, ['name'])).toEqual({ name: 'a' });
        expect(input.every(b => b === 0)).toBe(true); // de PRF-uitvoer is sleutelmateriaal: gewist na de afleiding
    });

    it('elke passkey heeft haar eigen kopie; intrekken verwijdert die kopie en dan ontgrendelt ze niet meer', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        const one = prf();
        const two = prf();
        await vault.addPasskey({ credentialId: 'c1', prfOutput: Buffer.from(one) });
        await vault.addPasskey({ credentialId: 'c2', prfOutput: Buffer.from(two) });
        const header = JSON.parse((await store.read('vault.json')).toString());
        const passkeys = header.methods.filter(m => m.type === 'passkey');
        expect(passkeys).toHaveLength(2);
        expect(passkeys[0].prfSalt).not.toBe(passkeys[1].prfSalt); // eigen salt per credential
        expect(vault.status().passkeyCount).toBe(2);

        await vault.removePasskey('c1');
        vault.lock();
        await expect(vault.unlockWithPrf({ credentialId: 'c1', prfOutput: Buffer.from(one) })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await vault.unlockWithPrf({ credentialId: 'c2', prfOutput: Buffer.from(two) });
        expect(vault.isUnlocked()).toBe(true);
    });

    it('zonder PRF blijft de passphrase de weg: een kluis zonder passkeys ontgrendelt met de passphrase', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        vault.lock();
        expect(vault.passkeySalts()).toEqual([]);
        await vault.unlockWithPassphrase('p');
        expect(vault.isUnlocked()).toBe(true);
    });

    it('MOET weigeren: een PRF-uitvoer van de verkeerde lengte', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        await expect(vault.addPasskey({ credentialId: 'c', prfOutput: Buffer.alloc(16) })).rejects.toMatchObject({ code: 'INVALID_PRF' });
    });
});
