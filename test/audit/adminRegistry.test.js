// Beheer in de audit: elke wijziging via de registry (secrets, tools, toekenningen, passkeys, instellingen) wordt een
// regel met mode 'admin', de herkomst, de regelnaam en oud → nieuw. Nooit een secret-waarde of tool-key, ook niet bij
// roteren; dat bewaakt een property-test over willekeurige reeksen beheerhandelingen.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newVault, fakeClock, crypto } from '../vault/fixtures.js';
import { createAudit, auditedRegistry } from '../../src/audit/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

async function setup(origin = 'portal') {
    const clock = fakeClock();
    const { vault, store } = newVault({ clock });
    await vault.create({ passphrase: 'p' });
    const audit = createAudit({ vault, store, clock });
    const raw = createRegistry({ vault, clock, crypto });
    return { audit, raw, registry: auditedRegistry(raw, { audit, origin }), store };
}

const last = async audit => (await audit.read({ limit: 1 }))[0];

describe('beheer in de audit: elke registry-wijziging met herkomst en oud → nieuw', () => {
    it('Given een secret When er een host bij komt Then een regel met oud en nieuw en herkomst portal', async () => {
        const { audit, registry } = await setup();
        const id = await registry.addSecret({ name: 'gh', value: fakeSecret('gh'), hosts: ['https://api.github.com'] });
        await registry.setSecretHosts(id, ['https://api.github.com', 'https://uploads.github.com']);
        expect(await last(audit)).toMatchObject({
            mode: 'admin', origin: 'portal', allow: true, rule: 'secret-hosts-changed', secret: 'gh',
            detail: 'hosts: https://api.github.com → https://api.github.com, https://uploads.github.com',
        });
    });

    it('elke soort wijziging heeft haar eigen regelnaam', async () => {
        const { audit, registry } = await setup();
        const s = await registry.addSecret({ name: 'gh', value: fakeSecret('a'), hosts: ['https://api.github.com'] });
        await registry.rotateSecret(s, fakeSecret('b'));
        await registry.setSecretInject(s, ['header:x-api-key']);
        await registry.setSecretSensitive(s, true);
        await registry.renameSecret(s, 'github');
        await registry.addSecretHost('github', 'https://uploads.github.com');
        const { id: t } = await registry.addTool({ name: 'agent' });
        await registry.renameTool(t, 'agent2');
        await registry.setToolClients(t, ['127.0.0.1']);
        await registry.setToolDefaults(t, { onUse: 'notify', validMs: 60_000 });
        await registry.setToolReask(t, 8 * 3_600_000);
        await registry.rotateToolKey(t);
        await registry.revokeTool(t);
        await registry.reactivateTool(t);
        const g = await registry.addGrant({ toolId: t, secretName: 'github', host: 'https://api.github.com', origin: 'portal' });
        await registry.addGrant({ toolId: t, secretName: 'github', host: 'https://api.github.com', origin: 'portal', mode: 'silent', expiresAt: null });
        await registry.setGrant(g, { mode: 'confirm' });
        await registry.removeGrant(g);
        await registry.setPasskeyName('pk-1', 'YubiKey');
        await registry.removePasskeyMeta('pk-1');
        await registry.updateSettings({ autoLockMs: 600_000 });
        await registry.removeTool(t);
        await registry.removeSecret(s);
        const rules = (await audit.read()).reverse().map(e => e.rule);
        expect(rules).toEqual([
            'secret-added', 'secret-rotated', 'secret-places-changed', 'secret-sensitive-changed', 'secret-renamed', 'secret-hosts-changed',
            'tool-added', 'tool-renamed', 'tool-clients-changed', 'tool-defaults-changed', 'tool-reask-changed', 'tool-key-rotated', 'tool-revoked', 'tool-reactivated',
            'grant-added', 'grant-changed', 'grant-changed', 'grant-removed',
            'passkey-renamed', 'passkey-removed', 'settings-changed', 'tool-removed', 'secret-removed',
        ]);
        expect((await audit.read({ rule: 'secret-renamed' }))[0]).toMatchObject({ secret: 'github', detail: 'name: gh → github' });
        expect((await audit.read({ rule: 'settings-changed' }))[0]).toMatchObject({ detail: 'autoLockMs: 900000 → 600000' });
        expect((await audit.read({ rule: 'grant-removed' }))[0]).toMatchObject({ tool: 'agent2', secret: 'github', host: 'https://api.github.com' });
        expect((await audit.read({ rule: 'passkey-renamed' }))[0].detail).toBe('name: – → YubiKey');
    });

    it('niets gewijzigd, geen regel; de herkomst is die van de aanroeper (tray, device, proxy)', async () => {
        const { audit, registry, raw } = await setup('tray');
        const s = await raw.addSecret({ name: 'gh', value: fakeSecret('a'), hosts: ['https://api.github.com'] });
        await registry.setSecretHosts(s, ['https://api.github.com']);
        await registry.setSecretInject(s, ['header:authorization'], true); // leren mag alleen op een lege lijst
        expect(await audit.read()).toEqual([]);
        await registry.addSecretHost('gh', 'https://uploads.github.com');
        expect(await last(audit)).toMatchObject({ origin: 'tray', rule: 'secret-hosts-changed' });
    });

    it('elke schrijvende registry-methode is geauditeerd, behalve wat Vaultgate zelf bijhoudt (een nieuwe methode MOET in een van beide)', async () => {
        const { raw, registry } = await setup();
        const READ = /^(list|find|get|has|secretValue$|generation$)/;
        // laatst gebruikt, TLS bij eerste gebruik (de keuze van de gebruiker: tls-*-accepted); de uitwisseling schrijft zelf `key-rotated`
        const BOOKKEEPING = ['touchPasskey', 'setTlsPin', 'setTlsException', 'removeTlsException', 'setRootSnapshot', 'exchangeToolKey'];
        const unaudited = Object.keys(raw).filter(k => !READ.test(k) && registry[k] === raw[k]);
        expect(unaudited.sort()).toEqual([...BOOKKEEPING].sort());
    });

    it('een geweigerde wijziging schrijft niets: de fout gaat door naar de aanroeper', async () => {
        const { audit, registry } = await setup();
        await expect(registry.addSecret({ name: 'kapot naam', value: 'x', hosts: [] })).rejects.toMatchObject({ code: 'INVALID_NAME' });
        expect(await audit.read()).toEqual([]);
    });
});

describe('beheer in de audit: nooit een waarde of tool-key', () => {
    const OPS = ['rotate', 'hosts', 'rename', 'rotateKey', 'grant', 'sensitive'];

    it('property: na willekeurige beheerhandelingen staat geen secret-waarde of tool-key in de audit of op schijf', async () => {
        await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...OPS), { minLength: 1, maxLength: 8 }), async ops => {
            const { audit, registry, store } = await setup();
            const values = [fakeSecret('add')];
            const s = await registry.addSecret({ name: 'gh', value: values[0], hosts: ['https://api.github.com'] });
            const { id: t, key } = await registry.addTool({ name: 'agent' });
            const keys = [key];
            let n = 0;
            for (const op of ops) {
                n += 1;
                if (op === 'rotate') { values.push(fakeSecret('rot')); await registry.rotateSecret(s, values.at(-1)); }
                if (op === 'hosts') await registry.setSecretHosts(s, ['https://api.github.com', `https://h${n}.example.com`]);
                if (op === 'rename') await registry.renameSecret(s, `gh${n}`);
                if (op === 'rotateKey') keys.push((await registry.rotateToolKey(t)).key);
                if (op === 'grant') await registry.addGrant({ toolId: t, secretName: (await registry.listSecrets())[0].name, host: 'https://api.github.com', origin: 'portal', mode: n % 2 ? 'notify' : 'silent' });
                if (op === 'sensitive') await registry.setSecretSensitive(s, n % 2 === 0);
            }
            const files = {};
            for (const name of await store.list('')) files[name] = await store.read(name);
            const entries = await audit.read();
            expect(entries.length).toBeGreaterThanOrEqual(2);
            expect(findLeaks({ audit: JSON.stringify(entries), ...files }, [...values, ...keys])).toEqual([]);
        }), { numRuns: 15 });
    }, 60_000);

    it('de lekcontrole over de audit MOET een waarde vinden die er wel in staat', async () => {
        const { audit } = await setup();
        const value = fakeSecret('planted');
        await audit.append({ mode: 'admin', rule: 'secret-rotated', detail: `value: – → ${value}` });
        expect(findLeaks({ audit: JSON.stringify(await audit.read()) }, [value])).toHaveLength(1);
    });
});

describe('beheer in de audit: filter', () => {
    it('decision=admin geeft alleen beheer; toegestaan en tegengehouden laten beheer weg', async () => {
        const { audit, registry } = await setup();
        await audit.append({ tool: 'a', allow: true, rule: 'granted' });
        await audit.append({ tool: 'a', allow: false, rule: 'no-grant' });
        await registry.addSecret({ name: 'gh', value: fakeSecret('f'), hosts: ['https://api.github.com'] });
        expect((await audit.read({ decision: 'admin' })).map(e => e.rule)).toEqual(['secret-added']);
        expect((await audit.read({ decision: 'allow' })).map(e => e.rule)).toEqual(['granted']);
        expect((await audit.read({ decision: 'deny' })).map(e => e.rule)).toEqual(['no-grant']);
    });
});
