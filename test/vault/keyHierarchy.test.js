// Sleutelhiërarchie. Een willekeurige vault key, per ontgrendelmethode een eigen ingepakte kopie, een item key per
// record, AAD die record, veld en versie bindt. Passphrase wijzigen raakt geen enkel record.
import { describe, it, expect } from 'vitest';
import { newVault } from './fixtures.js';
import { WRONG_CREDENTIALS, VAULT_LOCKED, VAULT_TAMPERED } from '../../src/vault/index.js';

describe('sleutelhiërarchie', () => {
    it('Given een nieuwe kluis met records When vergrendeld en met de passphrase ontgrendeld Then komen dezelfde records terug', async () => {
        const { vault, reopen } = newVault();
        await vault.create({ passphrase: 'pass één' });
        const a = await vault.put({ kind: 'secret', name: 'github_token', value: 'v-a' });
        const b = await vault.put({ kind: 'tool', name: 'mytool' });
        vault.lock();

        const again = reopen();
        await again.load();
        await again.unlockWithPassphrase('pass één');
        expect(await again.get(a)).toEqual({ kind: 'secret', name: 'github_token', value: 'v-a' });
        expect(await again.get(b, ['name'])).toEqual({ name: 'mytool' });
        expect((await again.ids()).sort()).toEqual([a, b].sort());
    });

    it('Given een fout wachtwoord When ontgrendelen Then WRONG_CREDENTIALS en blijft de kluis dicht (rule vault-locked)', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'goed' });
        vault.lock();
        await expect(vault.unlockWithPassphrase('fout')).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        expect(vault.isUnlocked()).toBe(false);
        await expect(vault.get('x')).rejects.toMatchObject({ code: VAULT_LOCKED, rule: 'vault-locked' });
    });

    it('Given een kluis met twee records When de passphrase gewijzigd Then blijven de versleutelde records byte-gelijk en ontgrendelt alleen het nieuwe wachtwoord', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'oud' });
        await vault.put({ kind: 'secret', name: 'a', value: '1' });
        await vault.put({ kind: 'secret', name: 'b', value: '2' });
        const snapshot = async () => Promise.all((await store.list('records/')).map(async n => [n, (await store.read(n)).toString('hex')]));
        const before = await snapshot();

        await vault.changePassphrase({ newPassphrase: 'nieuw' });
        expect(await snapshot()).toEqual(before);

        vault.lock();
        await expect(vault.unlockWithPassphrase('oud')).rejects.toMatchObject({ code: WRONG_CREDENTIALS });
        await vault.unlockWithPassphrase('nieuw');
        expect(vault.isUnlocked()).toBe(true);
    });

    it('elke ontgrendelmethode heeft haar eigen ingepakte kopie; de vault key is willekeurig (twee kluizen, zelfde passphrase: verschillende kopieën)', async () => {
        const one = newVault();
        const two = newVault();
        await one.vault.create({ passphrase: 'zelfde' });
        await two.vault.create({ passphrase: 'zelfde' });
        const header = async s => JSON.parse((await s.read('vault.json')).toString());
        const h1 = await header(one.store);
        const h2 = await header(two.store);
        expect(h1.methods.map(m => m.type).sort()).toEqual(['passphrase', 'recovery']);
        expect(new Set(h1.methods.map(m => m.sealedVaultKey)).size).toBe(2);
        expect(h1.methods[0].sealedVaultKey).not.toBe(h2.methods[0].sealedVaultKey);
    });

    it('Given een versleuteld veld When het naar een ander record gekopieerd Then faalt ontsleutelen', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        const a = await vault.put({ kind: 'secret', name: 'a', value: 'waarde-a' });
        const b = await vault.put({ kind: 'secret', name: 'b', value: 'waarde-b' });
        const fileOf = async id => (await store.list('records/')).find(n => n.startsWith(`records/${id}.`));
        const recA = JSON.parse((await store.read(await fileOf(a))).toString());
        const fileB = await fileOf(b);
        const recB = JSON.parse((await store.read(fileB)).toString());
        recB.fields[2] = recA.fields[2]; // het waarde-veld van a in b
        await store.write(fileB, Buffer.from(JSON.stringify(recB)));
        await expect(vault.get(b, ['value'])).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
        expect(await vault.get(b, ['name'])).toEqual({ name: 'b' }); // de rest van het record blijft leesbaar
    });

    it('Given een item key van een ander record When ingeplakt Then faalt ontsleutelen (AAD bindt record en versie)', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        const a = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        const b = await vault.put({ kind: 'secret', name: 'b', value: '2' });
        const files = await store.list('records/');
        const fa = files.find(n => n.startsWith(`records/${a}.`));
        const fb = files.find(n => n.startsWith(`records/${b}.`));
        const recA = JSON.parse((await store.read(fa)).toString());
        const recB = JSON.parse((await store.read(fb)).toString());
        await store.write(fb, Buffer.from(JSON.stringify({ ...recB, key: recA.key, fields: recA.fields })));
        await expect(vault.get(b)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    });

    it('een record bijwerken schrijft een nieuwe versie en laat andere records ongemoeid', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        const a = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        const b = await vault.put({ kind: 'secret', name: 'b', value: '2' });
        const fb = (await store.list('records/')).find(n => n.startsWith(`records/${b}.`));
        const bBefore = (await store.read(fb)).toString();
        await vault.put({ kind: 'secret', name: 'a', value: '1b' }, a);
        expect((await store.read(fb)).toString()).toBe(bBefore);
        expect(await vault.get(a, ['value'])).toEqual({ value: '1b' });
        expect((await store.list(`records/${a}.`))).toHaveLength(1); // oude versie opgeruimd
    });

    it('MOET weigeren: een teruggezette oudere versie van een record (rollback) of een verwijderd record, bij het ontgrendelen', async () => {
        const { vault, store, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        const a = await vault.put({ kind: 'secret', name: 'a', value: 'oud' });
        const fOld = (await store.list('records/')).find(n => n.startsWith(`records/${a}.`));
        const old = await store.read(fOld);
        await vault.put({ kind: 'secret', name: 'a', value: 'nieuw' }, a);
        const header = JSON.parse((await store.read('vault.json')).toString());
        // aanvaller zet de oude versie terug en past het (open) manifest aan zonder de MAC te kennen
        await store.write(fOld, old);
        header.manifest.records[a] = Number(fOld.split('.')[1]);
        await store.write('vault.json', Buffer.from(JSON.stringify(header)));
        vault.lock();
        const again = reopen();
        await again.load();
        await expect(again.unlockWithPassphrase('p')).rejects.toMatchObject({ code: VAULT_TAMPERED });
        expect(again.isUnlocked()).toBe(false);
    });

    it('MOET weigeren: een onderschoven publieke sleutel van een ontgrendelmethode', async () => {
        const { vault, store, reopen } = newVault();
        await vault.create({ passphrase: 'p' });
        vault.lock();
        const header = JSON.parse((await store.read('vault.json')).toString());
        const recovery = header.methods.find(m => m.type === 'recovery');
        recovery.publicKey = Buffer.alloc(32, 7).toString('base64');
        await store.write('vault.json', Buffer.from(JSON.stringify(header)));
        const again = reopen();
        await again.load();
        await expect(again.unlockWithPassphrase('p')).rejects.toMatchObject({ code: VAULT_TAMPERED });
    });

    it('vergrendelen wist de vault key: daarna geeft elke operatie VAULT_LOCKED', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        const id = await vault.put({ kind: 'secret', name: 'a', value: '1' });
        const key = vault.internalKeyForTest();
        vault.lock();
        expect(key.every(byte => byte === 0)).toBe(true);
        await expect(vault.get(id)).rejects.toMatchObject({ code: VAULT_LOCKED });
        await expect(vault.put({ kind: 'x' })).rejects.toMatchObject({ code: VAULT_LOCKED });
    });
});
