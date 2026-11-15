// Diensten van de kluis buiten de records: tool-key-hash, audit-verzegeling (ook vergrendeld), portaal-credentials onder de
// MAC, en wat de kluis doet met een kapot bestand (quarantaine, nooit stil vervangen).
import { describe, it, expect } from 'vitest';
import { newVault } from './fixtures.js';
import { VAULT_LOCKED, VAULT_TAMPERED, VAULT_CORRUPT, LAST_METHOD, RECORD_NOT_FOUND, VAULT_MISSING } from '../../src/vault/index.js';
import { choose } from '../../src/composition.js';

describe('kluisdiensten', () => {
    it('tool-key-hash: alleen ontgrendeld, deterministisch binnen één kluis, anders in een andere kluis', async () => {
        const one = newVault();
        const two = newVault();
        await one.vault.create({ passphrase: 'p' });
        await two.vault.create({ passphrase: 'p' });
        expect(one.vault.toolKeyHash('ks_x')).toBe(one.vault.toolKeyHash('ks_x'));
        expect(one.vault.toolKeyHash('ks_x')).not.toBe(two.vault.toolKeyHash('ks_x'));
        one.vault.lock();
        expect(() => one.vault.toolKeyHash('ks_x')).toThrow(expect.objectContaining({ code: VAULT_LOCKED }));
    });

    it('audit: verzegelen kan vergrendeld, openen alleen ontgrendeld', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        vault.lock();
        const sealed = vault.sealAudit(Buffer.from('{"rule":"vault-locked"}'));
        expect(() => vault.openAudit(sealed)).toThrow(expect.objectContaining({ code: VAULT_LOCKED }));
        await vault.unlockWithPassphrase('p');
        expect(vault.openAudit(sealed).toString()).toBe('{"rule":"vault-locked"}');
    });

    it('zonder kluis: verzegelen en ontgrendelen geven VAULT_MISSING', async () => {
        const { vault } = newVault();
        expect((await vault.load()).exists).toBe(false);
        expect(() => vault.sealAudit(Buffer.from('x'))).toThrow(expect.objectContaining({ code: VAULT_MISSING }));
        await expect(vault.unlockWithPassphrase('p')).rejects.toMatchObject({ code: VAULT_MISSING });
    });

    it('portaal-credentials: open leesbaar (login vóór ontgrendelen), counter bij te werken terwijl vergrendeld', async () => {
        const { vault, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        await vault.addCredential({ id: 'cred-1', publicKey: 'pk1', counter: 0 });
        vault.lock();
        const again = reopen();
        await again.load();
        expect(again.listCredentials()).toMatchObject([{ id: 'cred-1', publicKey: 'pk1', counter: 0 }]);
        await again.updateCredentialCounter('cred-1', 5);
        expect(again.listCredentials()[0].counter).toBe(5);
        await again.unlockWithPassphrase('p'); // de counter valt buiten de MAC
        expect(again.status().credentialCount).toBe(1);
    });

    it('MOET weigeren: een onderschoven portaal-credential laat het ontgrendelen falen', async () => {
        const { vault, store, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        await vault.addCredential({ id: 'cred-1', publicKey: 'pk1', counter: 0 });
        vault.lock();
        const header = JSON.parse((await store.read('vault.json')).toString());
        header.credentials.push({ id: 'aanvaller', publicKey: 'pk-evil', counter: 0 });
        await store.write('vault.json', Buffer.from(JSON.stringify(header)));
        const again = reopen();
        await again.load();
        await expect(again.unlockWithPassphrase('p')).rejects.toMatchObject({ code: VAULT_TAMPERED });
    });

    it('de laatste passkey van het portaal kan niet verwijderd worden; een andere wel', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        await vault.addCredential({ id: 'a', publicKey: 'pa', counter: 0 });
        await vault.addCredential({ id: 'b', publicKey: 'pb', counter: 0 });
        await vault.removeCredential('a');
        await expect(vault.removeCredential('b')).rejects.toMatchObject({ code: LAST_METHOD });
    });

    it('een record verwijderen; een onbekend record geeft RECORD_NOT_FOUND', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        const id = await vault.put({ kind: 'x' });
        await vault.remove(id);
        await vault.remove(id); // tweede keer: geen fout
        await expect(vault.get(id)).rejects.toMatchObject({ code: RECORD_NOT_FOUND });
        await expect(vault.put({ kind: 'x' }, 'bestaat-niet')).rejects.toMatchObject({ code: RECORD_NOT_FOUND });
        expect(await vault.ids()).toEqual([]);
    });

    it('Given een half geschreven kluisbestand When de kluis opent Then staat het in quarantaine en meldt de kluis dat, zonder het te overschrijven', async () => {
        const { vault, store, reopen } = newVault({ store: 'local' });
        await vault.create({ passphrase: 'p' });
        const good = (await store.read('vault.json')).toString();
        await store.write('vault.json', Buffer.from(good.slice(0, good.length / 2)));
        const again = reopen();
        const error = await again.load().catch(e => e);
        expect(error.code).toBe(VAULT_CORRUPT);
        expect(error.quarantined).toMatch(/^quarantine\//);
        expect((await store.read(error.quarantined)).toString()).toBe(good.slice(0, good.length / 2));
        expect(await store.read('vault.json')).toBeNull();
    });

    it('Given een kapot recordbestand When gelezen Then quarantaine en VAULT_CORRUPT; de rest van de kluis blijft bruikbaar', async () => {
        const { vault, store } = newVault({ store: 'local' });
        await vault.create({ passphrase: 'p' });
        const a = await vault.put({ kind: 'x', name: 'a' });
        const b = await vault.put({ kind: 'x', name: 'b' });
        const fa = (await store.list('records/')).find(n => n.startsWith(`records/${a}.`));
        await store.write(fa, Buffer.from('{"id":'));
        await expect(vault.get(a)).rejects.toMatchObject({ code: VAULT_CORRUPT });
        expect((await store.list('quarantine/')).length).toBe(1);
        expect(await vault.get(b, ['name'])).toEqual({ name: 'b' });
    });

    it('MOET weigeren: een onbekende implementatie in de samenstelling', () => {
        expect(() => choose('store', 'cloud', {})).toThrow(expect.objectContaining({ code: 'UNKNOWN_IMPLEMENTATION' }));
    });
});
