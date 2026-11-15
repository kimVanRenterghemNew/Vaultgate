// Een kluis die alleen met passkeys opent: geen passphrase en geen herstelcode, dus niets om te bewaren en niets om op een
// kopie te raden. De eerste passkey (met PRF) maakt de kluis; zonder PRF kan dat niet.
import { describe, it, expect } from 'vitest';
import { newVault, crypto } from './fixtures.js';
import { WRONG_CREDENTIALS, VAULT_EXISTS, INVALID_PRF } from '../../src/vault/index.js';

const credential = { id: 'cred-1', publicKey: 'cGs', counter: 0, transports: ['usb'] };

describe('kluis met alleen passkeys', () => {
    it('Given een eerste passkey met PRF When de kluis gemaakt wordt Then is ze open, staat de passkey erin, en is er geen passphrase of herstelcode', async () => {
        const { vault, reopen } = newVault();
        const prf = crypto.randomBytes(32);
        await vault.createWithPasskey({ credential, prfOutput: Buffer.from(prf), prfSalt: 'c2FsdA' });
        expect(vault.status()).toMatchObject({ exists: true, unlocked: true, passkeyCount: 1, credentialCount: 1, hasPassphrase: false, hasRecovery: false });
        expect(vault.listCredentials().map(c => c.id)).toEqual(['cred-1']);
        const id = await vault.put({ kind: 'note', text: 'x' });

        const again = reopen();
        await again.load();
        await again.unlockWithPrf({ credentialId: 'cred-1', prfOutput: Buffer.from(prf) });
        expect((await again.get(id)).text).toBe('x');
    });

    it('MOET weigeren: een passphrase op een kluis zonder passphrase, een tweede opzet, en een opzet zonder geldige PRF', async () => {
        const { vault, reopen } = newVault();
        await expect(vault.createWithPasskey({ credential, prfOutput: Buffer.alloc(5) })).rejects.toMatchObject({ code: INVALID_PRF });
        expect(vault.status().exists).toBe(false);
        await vault.createWithPasskey({ credential, prfOutput: crypto.randomBytes(32) });
        await expect(vault.createWithPasskey({ credential, prfOutput: crypto.randomBytes(32) })).rejects.toMatchObject({ code: VAULT_EXISTS });
        const again = reopen();
        await again.load();
        await expect(again.unlockWithPassphrase('')).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await expect(again.unlockWithPassphrase('raad maar')).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await expect(again.recover({ recoveryCode: 'AAAA-BBBB', newPassphrase: 'x' })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        expect(again.status().unlocked).toBe(false);
    });

    it('een oudere kluis met passphrase meldt dat ze een passphrase en herstelcode heeft', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        expect(vault.status()).toMatchObject({ hasPassphrase: true, hasRecovery: true });
    });

    it('Given een kluis met records When deleteVault() Then is de kluis gewist en kan een nieuwe kluis gemaakt worden', async () => {
        const { vault, store, reopen } = newVault();
        const prf = crypto.randomBytes(32);
        await vault.createWithPasskey({ credential, prfOutput: Buffer.from(prf) });
        await vault.put({ kind: 'secret', name: 'demo' });
        expect((await store.list('records/')).length).toBeGreaterThan(0);
        expect(await store.read('vault.json')).not.toBeNull();

        await vault.deleteVault();
        expect(vault.status()).toMatchObject({ exists: false, unlocked: false });
        expect(await store.list('records/')).toEqual([]);
        expect(await store.read('vault.json')).toBeNull();

        const again = reopen();
        await again.load();
        expect(again.status().exists).toBe(false);
        await again.createWithPasskey({ credential, prfOutput: Buffer.from(prf) });
        expect(again.status().exists).toBe(true);
    });
});
