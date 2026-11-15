// Herstelcode (eenmalig getoond, Argon2id-ingepakte kopie). Herstel dwingt een nieuwe passphrase én een nieuwe
// herstelcode af; de oude code werkt daarna niet meer.
import { describe, it, expect } from 'vitest';
import { newVault } from './fixtures.js';
import { WRONG_CREDENTIALS } from '../../src/vault/index.js';

describe('herstel', () => {
    it('bij het aanmaken krijgt de gebruiker één keer een herstelcode; ze staat nergens leesbaar in de kluis', async () => {
        const { vault, store } = newVault();
        const { recoveryCode } = await vault.create({ passphrase: 'p' });
        expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
        const all = (await Promise.all((await store.list('')).map(n => store.read(n)))).map(b => b.toString()).join('\n');
        expect(all).not.toContain(recoveryCode);
        expect(all).not.toContain(recoveryCode.replace(/-/g, ''));
        expect(vault.status()).not.toHaveProperty('recoveryCode');
    });

    it('Given een kluis zonder bruikbare passkey of passphrase When ontgrendeld met de herstelcode Then is de kluis open en is een nieuwe herstelcode vereist', async () => {
        const { vault, reopen } = newVault();
        const { recoveryCode } = await vault.create({ passphrase: 'vergeten' });
        const id = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        vault.lock();

        const again = reopen();
        await again.load();
        await expect(again.recover({ recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassphrase: 'nieuw' })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await expect(again.recover({ recoveryCode, newPassphrase: '' })).rejects.toMatchObject({ code: 'WEAK_PASSPHRASE' });
        const { recoveryCode: next } = await again.recover({ recoveryCode: recoveryCode.toLowerCase(), newPassphrase: 'nieuw' });
        expect(again.isUnlocked()).toBe(true);
        expect(next).not.toBe(recoveryCode);
        expect(await again.get(id, ['name'])).toEqual({ name: 'a' });

        again.lock();
        await expect(again.unlockWithPassphrase('vergeten')).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await expect(again.recover({ recoveryCode, newPassphrase: 'x2' })).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await again.unlockWithPassphrase('nieuw');
        again.lock();
        await again.recover({ recoveryCode: next, newPassphrase: 'derde' });
        expect(again.isUnlocked()).toBe(true);
    });

    it('status telt de passkeys, zodat het portaal kan waarschuwen zolang er minder dan twee zijn', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        expect(vault.status()).toMatchObject({ passkeyCount: 0, needsMorePasskeys: true });
    });
});
