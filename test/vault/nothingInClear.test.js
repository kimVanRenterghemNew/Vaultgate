// Niets onversleuteld op schijf. Na het opslaan van secrets, tools, toekenningen, instellingen en audit komt geen
// naam, waarde, host, tool-naam, client-adres of tool-key leesbaar (of als base64/hex/url-codering) voor in de kluisbestanden.
// Open mag alleen: formaatversie, KDF-parameters, salts, ingepakte sleutels, publieke sleutels, willekeurige record-ids, MAC's.
import { describe, it, expect } from 'vitest';
import { newVault, crypto } from './fixtures.js';
import { createRegistry } from '../../src/registry/index.js';
import { createAudit } from '../../src/audit/index.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

async function filesOf(store) {
    const out = {};
    for (const name of await store.list('')) out[name] = await store.read(name);
    return out;
}

describe('niets onversleuteld op schijf', () => {
    it('Given een kluis met secrets, tools, toekenningen, instellingen en audit When alle bestanden doorzocht Then komt niets ervan voor', async () => {
        const { vault, store, clock } = newVault({ store: 'local' });
        const { recoveryCode } = await vault.create({ passphrase: 'mijn passphrase' });
        const registry = createRegistry({ vault, clock, crypto });
        const audit = createAudit({ vault, store, clock });
        const value = fakeSecret('github');
        await registry.addSecret({ name: 'github_token', value, hosts: ['api.github.com'], description: 'persoonlijke token' });
        const { id: toolId, key } = await registry.addTool({ name: 'mytool-agent', clients: ['192.168.56.10'] });
        await registry.addGrant({ toolId, secretName: 'github_token', host: 'https://api.github.com', origin: 'tray' });
        await registry.updateSettings({ listeners: [{ host: '192.168.56.1', port: 9123 }] });
        await audit.append({ tool: 'mytool-agent', secret: 'github_token', host: 'https://api.github.com', client: '192.168.56.10', allow: true, rule: 'approved-always' });

        const files = await filesOf(store);
        expect(Object.keys(files).some(n => n.startsWith('records/'))).toBe(true);
        expect(Object.keys(files).some(n => n.startsWith('audit/'))).toBe(true);
        const forbidden = [value, key, 'github_token', 'mytool-agent', 'api.github.com', '192.168.56.10', '192.168.56.1', 'persoonlijke token',
            'approved-always', 'mijn passphrase', recoveryCode, recoveryCode.replace(/-/g, '')];
        expect(findLeaks(files, forbidden)).toEqual([]);
        // ook geen soort-aanduidingen of veldnamen
        const text = Object.values(files).map(b => b.toString('latin1')).join('\n');
        for (const word of ['"secret"', '"tool"', '"grant"', 'hosts', 'keyHash', 'clients', 'listeners']) expect(text, word).not.toContain(word);
    });

    it('de header bevat alleen de toegestane open velden', async () => {
        const { vault, store } = newVault();
        await vault.create({ passphrase: 'p' });
        await vault.addPasskey({ credentialId: 'cred', prfOutput: crypto.randomBytes(32) });
        await vault.addCredential({ id: 'cred', publicKey: 'pk', counter: 0 });
        await vault.put({ kind: 'secret', name: 'x', value: 'y' });
        const header = JSON.parse((await store.read('vault.json')).toString());
        // epoch: de anti-rollback-teller, een getal zonder geheim (zoals de recordversies in het manifest)
        expect(Object.keys(header).sort()).toEqual(['audit', 'credentials', 'credentialsMac', 'epoch', 'format', 'manifest', 'methods']);
        expect(Number.isSafeInteger(header.epoch)).toBe(true);
        const methodKeys = new Set(header.methods.flatMap(m => Object.keys(m)));
        expect([...methodKeys].sort()).toEqual(['credentialId', 'id', 'kdf', 'prfSalt', 'publicKey', 'publicKeyMac', 'salt', 'sealedVaultKey', 'type', 'wrappedSecretKey']);
        expect(Object.keys(header.audit).sort()).toEqual(['publicKey', 'publicKeyMac', 'wrappedSecretKey']);
        const recordFile = (await store.list('records/'))[0];
        expect(Object.keys(JSON.parse((await store.read(recordFile)).toString())).sort()).toEqual(['fields', 'id', 'key', 'names', 'version']);
    });

    it('een tool-key staat alleen als gesleutelde hash in de kluis, en die hash is niet de gewone hash van de key', async () => {
        const { vault, store, clock } = newVault();
        await vault.create({ passphrase: 'p' });
        const registry = createRegistry({ vault, clock, crypto });
        const { id, key } = await registry.addTool({ name: 'mytool' });
        const stored = (await vault.get(id, ['keyHash'])).keyHash;
        expect(stored).toMatch(/^[0-9a-f]{64}$/);
        expect(stored).not.toBe(crypto.keyedHash(Buffer.alloc(32), key));
        expect(findLeaks(await filesOf(store), [key, stored])).toEqual([]);
    });
});
