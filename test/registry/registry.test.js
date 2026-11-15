// Domein bovenop de kluis: secrets, tools, toekenningen, instellingen. Alles staat versleuteld in de kluis; een lijst of
// lookup geeft nooit een secret-waarde terug; een tool-key bestaat alleen als gesleutelde hash.
import { describe, it, expect, beforeEach } from 'vitest';
import { newVault, crypto } from '../vault/fixtures.js';
import { createRegistry, DUPLICATE_NAME, INVALID_NAME, NOT_FOUND } from '../../src/registry/index.js';
import { fakeSecret } from '../helpers/secretLeak.js';

let vault;
let registry;
let clock;
beforeEach(async () => {
    ({ vault, clock } = newVault());
    await vault.create({ passphrase: 'p' });
    registry = createRegistry({ vault, clock, crypto });
});

describe('registry: secrets', () => {
    it('toevoegen, oplijsten zonder waarde, roteren, intrekken', async () => {
        const value = fakeSecret('gh');
        const id = await registry.addSecret({ name: 'github_token', value, hosts: ['api.github.com'], description: 'GitHub' });
        const [listed] = await registry.listSecrets();
        expect(listed).toMatchObject({ id, name: 'github_token', hosts: ['https://api.github.com'], description: 'GitHub' });
        expect(JSON.stringify(await registry.listSecrets())).not.toContain(value);
        expect(listed.updatedAt).toBe(clock.now());

        const meta = await registry.findSecret('github_token');
        expect(meta).toMatchObject({ id, name: 'github_token' });
        expect(JSON.stringify(meta)).not.toContain(value);
        expect(await registry.secretValue(id)).toBe(value);

        const next = fakeSecret('gh2');
        clock.advance(1000);
        await registry.rotateSecret(id, next);
        expect(await registry.secretValue(id)).toBe(next);
        expect((await registry.listSecrets())[0].updatedAt).toBe(clock.now());

        await registry.setSecretHosts(id, ['api.github.com', 'uploads.github.com']);
        expect((await registry.findSecret('github_token')).hosts.map(h => h.text)).toEqual(['https://api.github.com', 'https://uploads.github.com']);

        await registry.removeSecret(id);
        expect(await registry.findSecret('github_token')).toBeNull();
    });

    it('MOET weigeren: dubbele naam, ongeldige naam, geen doelhost, lege waarde', async () => {
        await registry.addSecret({ name: 'a', value: 'x', hosts: ['a.example'] });
        await expect(registry.addSecret({ name: 'a', value: 'y', hosts: ['a.example'] })).rejects.toMatchObject({ code: DUPLICATE_NAME });
        await expect(registry.addSecret({ name: 'met spatie', value: 'y', hosts: ['a.example'] })).rejects.toMatchObject({ code: INVALID_NAME });
        await expect(registry.addSecret({ name: '{{x}}', value: 'y', hosts: ['a.example'] })).rejects.toMatchObject({ code: INVALID_NAME });
        await expect(registry.addSecret({ name: 'b', value: 'y', hosts: [] })).rejects.toMatchObject({ code: 'INVALID_HOST_RULE' });
        await expect(registry.addSecret({ name: 'b', value: '', hosts: ['b.example'] })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
        await expect(registry.rotateSecret('nope', 'x')).rejects.toMatchObject({ code: NOT_FOUND });
    });

    it('een secret verwijderen trekt ook zijn toekenningen in', async () => {
        const sid = await registry.addSecret({ name: 's', value: 'v', hosts: ['s.example'] });
        const { id: tid } = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId: tid, secretName: 's', host: 'https://s.example', origin: 'portal' });
        await registry.removeSecret(sid);
        expect(await registry.listGrants()).toEqual([]);
    });
});

describe('registry: een secret hernoemen', () => {
    it('Given een secret met een toekenning, een route en een blokkade When hernoemd Then gaan ze mee en blijft de waarde; een bestaande of ongeldige naam MOET geweigerd worden', async () => {
        const id = await registry.addSecret({ name: 'gh', value: 'FAKE-rename-value', hosts: ['https://api.github.com'] });
        await registry.addSecret({ name: 'ander', value: 'v', hosts: ['https://api.github.com'] });
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId, secretName: 'gh', host: 'https://api.github.com', origin: 'portal' });
        await registry.updateSettings({ routes: [{ name: 'github', base: 'https://api.github.com', secret: 'gh', header: 'authorization' }], blocks: [{ id: 'b1', kind: 'secret', secretName: 'gh', until: null }] });
        await registry.renameSecret(id, 'github_token');
        expect((await registry.findSecret('github_token')).id).toBe(id);
        expect(await registry.findSecret('gh')).toBeNull();
        expect(await registry.secretValue(id)).toBe('FAKE-rename-value');
        expect((await registry.listGrants({ toolId }))[0].secretName).toBe('github_token');
        const s = await registry.getSettings();
        expect(s.routes[0].secret).toBe('github_token');
        expect(s.blocks[0].secretName).toBe('github_token');
        await expect(registry.renameSecret(id, 'ander')).rejects.toMatchObject({ code: DUPLICATE_NAME });
        await expect(registry.renameSecret(id, 'bad name!')).rejects.toMatchObject({ code: INVALID_NAME });
    });
});

describe('registry: hernoemen zonder iets mee te nemen', () => {
    it('dezelfde naam verandert niets; zonder routes, blokkades of toekenningen gaat alleen de naam mee', async () => {
        const id = await registry.addSecret({ name: 'solo', value: 'v', hosts: ['https://api.github.com'] });
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId, secretName: 'ander_secret', host: 'https://api.github.com', origin: 'portal' });
        await expect(registry.renameSecret(id, 'solo')).resolves.toBe(id);
        await registry.renameSecret(id, 'alleen');
        expect((await registry.findSecret('alleen')).id).toBe(id);
        expect((await registry.listGrants({ toolId }))[0].secretName).toBe('ander_secret'); // een ander secret blijft
    });

    it('MOET weigeren: een passkeynaam die geen tekst is', async () => {
        await expect(registry.setPasskeyName('cred-2', 42)).rejects.toMatchObject({ code: 'INVALID_NAME' });
        await registry.removePasskeyMeta('bestaat-niet'); // niets te wissen: geen fout
    });
});

describe('registry: naam en laatst gebruikt van een passkey', () => {
    it('een naam geven, wissen en "laatst gebruikt"; MOET weigeren: te lang of met een regeleinde', async () => {
        await registry.setPasskeyName('cred-1', '  YubiKey sleutelbos ');
        await registry.touchPasskey('cred-1');
        expect((await registry.listPasskeyMeta()).get('cred-1')).toMatchObject({ name: 'YubiKey sleutelbos', lastUsedAt: expect.any(Number) });
        await registry.setPasskeyName('cred-1', '');
        expect((await registry.listPasskeyMeta()).get('cred-1').name).toBe('');
        await expect(registry.setPasskeyName('cred-1', 'x'.repeat(65))).rejects.toMatchObject({ code: 'INVALID_NAME' });
        await expect(registry.setPasskeyName('cred-1', 'a\nb')).rejects.toMatchObject({ code: 'INVALID_NAME' });
        await registry.removePasskeyMeta('cred-1');
        expect((await registry.listPasskeyMeta()).has('cred-1')).toBe(false);
    });
});

describe('registry: een toekenning terugvinden (de gemelde mismatch van 3.4)', () => {
    it('dezelfde tool, secret en oorsprong in een andere schrijfwijze vindt de toekenning; MOET niet vinden: een ander domein of een ander secret', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        await registry.addSecret({ name: 'github_token', value: 'v', hosts: ['https://github.com', 'https://api.github.com'] });
        await registry.addGrant({ toolId, secretName: 'github_token', host: 'HTTPS://API.GitHub.com:443/', origin: 'portal' });
        expect(await registry.findGrant(toolId, 'github_token', 'https://api.github.com')).not.toBeNull();
        expect(await registry.findGrant(toolId, 'github_token', 'https://github.com')).toBeNull(); // een ander domein: opnieuw vragen (subdomeinen: 3.8)
        expect(await registry.findGrant(toolId, 'github', 'https://api.github.com')).toBeNull();
    });
});

describe('registry: een tijdelijke regel boven een vaste', () => {
    it('Given een vaste toekenning "elke keer vragen" When een tijdelijke "stil, 1 uur" erbij Then geldt de tijdelijke een uur en daarna weer de vaste, die niet veranderde', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        const host = 'https://api.github.com';
        const id = await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'portal', mode: 'confirm', expiresAt: null });
        expect(await registry.hasGrant(toolId, 'gh', host)).toBe(false); // elke keer vragen
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'tray', mode: 'silent', expiresAt: clock.now() + 3_600_000 });
        const during = await registry.findGrant(toolId, 'gh', host);
        expect(during).toMatchObject({ id, mode: 'silent', temporary: true, expired: false, expiresAt: clock.now() + 3_600_000 });
        expect(await registry.hasGrant(toolId, 'gh', host)).toBe(true);
        expect((await registry.listGrants({ toolId }))[0]).toMatchObject({ mode: 'confirm', expiresAt: null, overrideMode: 'silent' }); // de vaste staat er nog
        clock.advance(3_600_001);
        expect(await registry.findGrant(toolId, 'gh', host)).toMatchObject({ mode: 'confirm', expired: false, temporary: false });
        expect(await registry.hasGrant(toolId, 'gh', host)).toBe(false);
    });

    it('een tijdelijke regel eindigen laat de vaste staan; een nieuwe vaste vervangt alles, ook de tijdelijke laag', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        const host = 'https://api.github.com';
        const id = await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'portal', mode: 'confirm', expiresAt: null });
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'tray', mode: 'silent', expiresAt: clock.now() + 60_000 });
        await registry.setGrant(id, { endOverride: true });
        expect(await registry.findGrant(toolId, 'gh', host)).toMatchObject({ mode: 'confirm', temporary: false });
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'tray', mode: 'silent', expiresAt: clock.now() + 60_000 });
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'portal', mode: 'notify', expiresAt: null });
        expect((await registry.listGrants({ toolId }))[0]).toMatchObject({ mode: 'notify', expiresAt: null, overrideMode: null });
    });

    it('MOET niet stapelen: boven een tijdelijke toekenning komt geen laag, ze wordt gewoon vervangen', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        const host = 'https://api.github.com';
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'portal', mode: 'confirm', expiresAt: clock.now() + 60_000 });
        await registry.addGrant({ toolId, secretName: 'gh', host, origin: 'tray', mode: 'silent', expiresAt: clock.now() + 3_600_000 });
        expect((await registry.listGrants({ toolId }))[0]).toMatchObject({ mode: 'silent', overrideMode: null });
    });
});

describe('registry: een domein bij een secret (ja op een nieuw subdomein)', () => {
    it('het domein komt erbij, één keer; MOET weigeren: een secret dat niet bestaat', async () => {
        await registry.addSecret({ name: 'gh', value: 'v', hosts: ['https://api.github.com'] });
        await registry.addSecretHost('gh', 'https://uploads.github.com');
        await registry.addSecretHost('gh', 'https://uploads.github.com');
        expect((await registry.findSecret('gh')).hosts.map(h => h.text)).toEqual(['https://api.github.com', 'https://uploads.github.com']);
        await expect(registry.addSecretHost('bestaat_niet', 'https://x.example')).rejects.toBeDefined();
    });
});

describe('registry: tools en keys', () => {
    it('hernoemen: de key, de toekenningen en de clients blijven; een bestaande of ongeldige naam MOET geweigerd worden', async () => {
        const { id, key } = await registry.addTool({ name: 'mytool', clients: ['192.168.56.10'] });
        await registry.addSecret({ name: 'gh', value: 'v', hosts: ['https://api.github.com'] });
        await registry.addGrant({ toolId: id, secretName: 'gh', host: 'https://api.github.com', origin: 'portal' });
        await registry.addTool({ name: 'other' });
        await registry.renameTool(id, 'claude-code');
        expect(await registry.findToolByKey(key)).toMatchObject({ id, name: 'claude-code' });
        expect((await registry.listGrants({ toolId: id }))[0].toolName).toBe('claude-code');
        expect((await registry.listTools()).find(t => t.id === id).clients.map(c => c.text)).toEqual(['192.168.56.10/32']);
        await expect(registry.renameTool(id, 'other')).rejects.toMatchObject({ code: DUPLICATE_NAME });
        await expect(registry.renameTool(id, 'bad name!')).rejects.toMatchObject({ code: INVALID_NAME });
        await expect(registry.renameTool(id, 'claude-code')).resolves.toBeDefined();
    });

    it('een tool krijgt een key die één keer teruggegeven wordt; opgeslagen alleen als hash', async () => {
        const { id, key } = await registry.addTool({ name: 'mytool', clients: ['192.168.56.10'] });
        expect(key).toMatch(/^ks_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/); // ks_<familie>_<willekeurig>
        const [tool] = await registry.listTools();
        expect(tool).toMatchObject({ id, name: 'mytool', revoked: false });
        expect(tool.clients.map(c => c.text)).toEqual(['192.168.56.10/32']);
        expect(JSON.stringify(tool)).not.toContain(key);
        expect(await registry.findToolByKey(key)).toMatchObject({ id, name: 'mytool' });
        expect(await registry.findToolByKey('ks_fout')).toBeNull();
        expect(await registry.findToolByKey(undefined)).toBeNull();
    });

    it('intrekken: de key wordt herkend als ingetrokken; vernieuwen: de oude key is onbekend, de nieuwe blijft ingetrokken tot heractiveren', async () => {
        const { id, key } = await registry.addTool({ name: 'mytool' });
        await registry.revokeTool(id);
        expect(await registry.findToolByKey(key)).toMatchObject({ id, revoked: true });
        const { key: fresh } = await registry.rotateToolKey(id);
        expect(await registry.findToolByKey(key)).toBeNull();
        // Vroeger hief een nieuwe key de intrekking stil op; nu is heractiveren een aparte stap.
        expect(await registry.findToolByKey(fresh)).toMatchObject({ id, revoked: true });
        await registry.reactivateTool(id);
        expect(await registry.findToolByKey(fresh)).toMatchObject({ id, revoked: false });
    });

    it('client-allowlist per tool, gevalideerd', async () => {
        const { id } = await registry.addTool({ name: 'agent-vm' });
        await registry.setToolClients(id, ['10.0.5.0/24']);
        expect((await registry.listTools())[0].clients.map(c => c.text)).toEqual(['10.0.5.0/24']);
        await expect(registry.setToolClients(id, ['0.0.0.0/0'])).rejects.toMatchObject({ code: 'INVALID_CLIENT_RULE' });
        await expect(registry.addTool({ name: 'agent-vm' })).rejects.toMatchObject({ code: DUPLICATE_NAME });
    });

    it('een tool verwijderen trekt zijn toekenningen in', async () => {
        await registry.addSecret({ name: 's', value: 'v', hosts: ['s.example'] });
        const { id } = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId: id, secretName: 's', host: 'https://s.example', origin: 'tray' });
        await registry.removeTool(id);
        expect(await registry.listGrants()).toEqual([]);
    });

    it('findToolByKey gebruikt een in-memory index en wist die bij lock', async () => {
        const { vault: realVault, clock: localClock } = newVault();
        await realVault.create({ passphrase: 'p' });
        const ids = realVault.ids.bind(realVault);
        let idsCalls = 0;
        const wrappedVault = {
            ...realVault,
            ids: async () => {
                idsCalls += 1;
                return ids();
            },
        };
        const indexed = createRegistry({ vault: wrappedVault, clock: localClock, crypto });
        const { key: firstKey } = await indexed.addTool({ name: 'mytool-1' });
        const { key: secondKey } = await indexed.addTool({ name: 'mytool-2' });

        const beforeFirst = idsCalls;
        await indexed.findToolByKey(firstKey);
        const firstLookupIds = idsCalls - beforeFirst;

        const beforeSecond = idsCalls;
        await indexed.findToolByKey(secondKey);
        const secondLookupIds = idsCalls - beforeSecond;

        expect(firstLookupIds).toBeGreaterThan(0);
        expect(secondLookupIds).toBe(0);

        realVault.lock();
        await realVault.unlockWithPassphrase('p');

        const beforeAfterLock = idsCalls;
        await indexed.findToolByKey(firstKey);
        const afterLockLookupIds = idsCalls - beforeAfterLock;
        expect(afterLockLookupIds).toBeGreaterThan(0);
    });
});

describe('registry: toekenningen en instellingen', () => {
    it('toekenning tool × secret × host met herkomst; filteren; intrekken', async () => {
        await registry.addSecret({ name: 's', value: 'v', hosts: ['s.example'] });
        const { id: mytool } = await registry.addTool({ name: 'mytool' });
        const { id: other } = await registry.addTool({ name: 'other' });
        const g = await registry.addGrant({ toolId: mytool, secretName: 's', host: 'https://s.example', origin: 'tray' });
        await registry.addGrant({ toolId: mytool, secretName: 's', host: 'https://s.example', origin: 'tray' }); // idempotent
        expect(await registry.hasGrant(mytool, 's', 'https://s.example')).toBe(true);
        expect(await registry.hasGrant(other, 's', 'https://s.example')).toBe(false);
        expect(await registry.hasGrant(mytool, 's', 'https://other.example')).toBe(false);
        expect(await registry.listGrants({ toolId: mytool })).toMatchObject([{ id: g, toolId: mytool, toolName: 'mytool', secretName: 's', host: 'https://s.example', origin: 'tray' }]);
        expect(await registry.listGrants({ toolId: other })).toEqual([]);
        expect(await registry.listGrants({ secretName: 's' })).toHaveLength(1);
        await registry.removeGrant(g);
        expect(await registry.hasGrant(mytool, 's', 'https://s.example')).toBe(false);
        await expect(registry.addGrant({ toolId: 'nope', secretName: 's', host: 'https://s.example', origin: 'portal' })).rejects.toMatchObject({ code: NOT_FOUND });
        await expect(registry.addGrant({ toolId: mytool, secretName: 's', host: 'https://s.example', origin: 'elders' })).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    });

    it('instellingen: standaardwaarden, bijwerken, versleuteld in de kluis', async () => {
        expect(await registry.getSettings()).toMatchObject({ approvalTimeoutMs: 30_000, listeners: [] });
        await registry.updateSettings({ approvalTimeoutMs: 10_000 });
        expect((await registry.getSettings()).approvalTimeoutMs).toBe(10_000);
        await expect(registry.updateSettings({ approvalTimeoutMs: -1 })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ listeners: [{ host: '0.0.0.0', port: 9000 }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await registry.updateSettings({ listeners: [{ host: '192.168.56.1', port: 9000 }] });
        expect((await registry.getSettings()).listeners).toEqual([{ host: '192.168.56.1', port: 9000 }]);
    });

    it('instellingen ondersteunen quiet-hours, blokkades en melding-sluimer', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        await registry.updateSettings({
            quietHours: ['23:00-07:00'],
            blocks: [
                { id: 'b-tool', kind: 'tool', toolId, until: null },
                { id: 'b-secret', kind: 'secret', secretName: 'github_token', until: 12_345 },
                { id: 'b-grant', kind: 'grant', toolId, secretName: 'github_token', host: 'https://api.github.com/v1', until: 67_890 },
                { id: 'b-passkey', kind: 'passkey', passkeyId: 'cred_1', until: null },
            ],
            notificationSnooze: { globalUntil: 11_000, grants: [{ grantId: 'g1', until: null }] },
        });
        expect(await registry.getSettings()).toMatchObject({
            quietHours: ['23:00-07:00'],
            blocks: [
                { id: 'b-tool', kind: 'tool', toolId, until: null },
                { id: 'b-secret', kind: 'secret', secretName: 'github_token', until: 12_345 },
                { id: 'b-grant', kind: 'grant', toolId, secretName: 'github_token', host: 'https://api.github.com', until: 67_890 },
                { id: 'b-passkey', kind: 'passkey', passkeyId: 'cred_1', until: null },
            ],
            notificationSnooze: { globalUntil: 11_000, grants: [{ grantId: 'g1', until: null }] },
        });
    });

    it('MOET weigeren: ongeldige quiet-hours, blokken en sluimerinstellingen', async () => {
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        await expect(registry.updateSettings({ quietHours: ['23:00-23:00'] })).rejects.toMatchObject({ code: 'INVALID_QUIET_HOURS' });
        await expect(registry.updateSettings({ blocks: 'x' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [null] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'tool', toolId: 'spatie hier' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'grant', toolId: 'spatie hier', secretName: 's', host: 'https://a.example' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'tool', toolId }, { id: 'x', kind: 'tool', toolId }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'passkey', passkeyId: 'spatie hier' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'secret', secretName: 'met spatie' }] })).rejects.toMatchObject({ code: 'INVALID_NAME' });
        await expect(registry.updateSettings({ blocks: [{ id: 'x', kind: 'grant', toolId, secretName: 's', host: 'kapot host' }] })).rejects.toMatchObject({ code: 'INVALID_HOST_RULE' });
        await expect(registry.updateSettings({ notificationSnooze: [] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ notificationSnooze: { globalUntil: 'later', grants: [] } })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ notificationSnooze: { globalUntil: null, grants: 'x' } })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ notificationSnooze: { globalUntil: null, grants: [null] } })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ notificationSnooze: { globalUntil: null, grants: [{ grantId: 'spatie hier', until: null }] } })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ notificationSnooze: { globalUntil: null, grants: [{ grantId: 'g1', until: 'morgen' }] } })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });

    it('tls-uitzondering per host: onbekend = null, opslaan en lezen met fingerprint/validity', async () => {
        const origin = 'https://localhost:9443';
        expect(await registry.getTlsException(origin)).toBeNull();
        await registry.setTlsException(origin, {
            caPem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
            issuer: 'CN=test CA',
            root: 'AA:BB',
            fingerprint: '11:22',
            validFrom: 'Oct 10 10:00:00 2026 GMT',
            validTo: 'Oct 10 10:00:00 2027 GMT',
        });
        expect(await registry.getTlsException(origin)).toEqual({
            caPem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
            issuer: 'CN=test CA',
            root: 'AA:BB',
            fingerprint: '11:22',
            validFrom: 'Oct 10 10:00:00 2026 GMT',
            validTo: 'Oct 10 10:00:00 2027 GMT',
        });
    });

    it('tls-pin en tls-uitzondering kunnen bijgewerkt worden; optionele velden worden null/lege string', async () => {
        const origin = 'https://api.example.com';
        expect(await registry.getTlsPin(origin)).toBeNull();
        await registry.setTlsPin(origin, { issuer: 'CN=CA-a', root: 'R-a' });
        expect(await registry.getTlsPin(origin)).toEqual({ issuer: 'CN=CA-a', root: 'R-a' });
        await registry.setTlsPin(origin, { issuer: 'CN=CA-b', root: 'R-b' });
        expect(await registry.getTlsPin(origin)).toEqual({ issuer: 'CN=CA-b', root: 'R-b' });

        await registry.setTlsException(origin, { caPem: 'PEM' });
        expect(await registry.getTlsException(origin)).toEqual({
            caPem: 'PEM',
            issuer: '',
            root: '',
            fingerprint: null,
            validFrom: null,
            validTo: null,
        });
    });

    it('listTlsExceptions en removeTlsException per origin en per root', async () => {
        const o1 = 'https://host1.example';
        const o2 = 'https://host2.example';
        const o3 = '*';
        await registry.setTlsException(o1, { caPem: 'PEM1', root: 'ROOT1', scope: 'host' });
        await registry.setTlsException(o2, { caPem: 'PEM2', root: 'ROOT2' });
        await registry.setTlsException(o3, { caPem: 'PEM3', root: 'ROOT3' });
        const list = await registry.listTlsExceptions();
        expect(list).toHaveLength(3);
        expect(list.find(x => x.origin === o2).scope).toBe('host');
        expect(list.find(x => x.origin === o3).scope).toBe('global');

        await registry.removeTlsException(o1);
        expect(await registry.getTlsException(o1)).toBeNull();
        expect(await registry.getTlsException(o2)).not.toBeNull();

        await registry.removeTlsException('ROOT2');
        expect(await registry.getTlsException(o2)).toBeNull();
        await registry.removeTlsException(o3);
        expect(await registry.listTlsExceptions()).toHaveLength(0);
    });

    it('de momentopname van de systeemstore: eerst geen, dan de opgeslagen vingerafdrukken; opnieuw opslaan vervangt ze', async () => {
        expect(await registry.getRootSnapshot()).toBeNull();
        await registry.setRootSnapshot(['AA:BB', 'CC:DD']);
        expect(await registry.getRootSnapshot()).toEqual(['AA:BB', 'CC:DD']);
        await registry.setRootSnapshot(['EE:FF']);
        expect(await registry.getRootSnapshot()).toEqual(['EE:FF']);
    });
});

describe('registry: grenzen', () => {
    it('MOET weigeren: een id van een andere soort, en ongeldige instellingen', async () => {
        const sid = await registry.addSecret({ name: 's', value: 'v', hosts: ['s.example'] });
        await expect(registry.revokeTool(sid)).rejects.toMatchObject({ code: NOT_FOUND });
        await expect(registry.removeGrant(sid)).rejects.toMatchObject({ code: NOT_FOUND });
        for (const bad of [{ autoLockMs: 5 }, { listeners: 'x' }, { listeners: [{ host: '10.0.0.1', port: 0 }] }, { approvalTimeoutMs: 1.5 }, { rotationNoticeMs: -1 }, { rotationNoticeMs: 'x' }]) {
            await expect(registry.updateSettings(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        }
    });

    it('de melding bij een key-rotatie: standaard hoogstens om de 8 uur per tool, instelbaar', async () => {
        expect((await registry.getSettings()).rotationNoticeMs).toBe(8 * 3_600_000);
        await registry.updateSettings({ rotationNoticeMs: 3_600_000 });
        expect((await registry.getSettings()).rotationNoticeMs).toBe(3_600_000);
    });

    it('zonder crypto kan de registry geen tool-key maken (luide fout, geen zwakke key)', async () => {
        const bare = createRegistry({ vault, clock });
        await expect(bare.addTool({ name: 'x' })).rejects.toThrow(/randomToken/);
    });

    it('een toekenning voor een verwijderde tool toont "(verwijderd)" in plaats van te breken', async () => {
        await registry.addSecret({ name: 's', value: 'v', hosts: ['s.example'] });
        const { id } = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId: id, secretName: 's', host: 'https://s.example', origin: 'portal' });
        const [grant] = await registry.listGrants();
        await vault.remove(id); // rechtstreeks, buiten removeTool om
        expect((await registry.listGrants()).map(g => g.toolName)).toEqual(['(verwijderd)']);
        expect(grant.toolName).toBe('mytool');
    });
});

describe('registry: route-header basic (git over HTTPS, 5.4)', () => {
    it('een route met header "basic" is geldig', async () => {
        await registry.updateSettings({ routes: [{ name: 'github', base: 'https://github.com', secret: 'github_token', header: 'basic' }] });
        expect((await registry.getSettings()).routes[0].header).toBe('basic');
    });

    it('MOET weigeren: ongeldige route-naam, header en base', async () => {
        await expect(registry.updateSettings({ routes: [{ name: 'forward', base: 'https://github.com', secret: 'github_token', header: 'basic' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ routes: [{ name: 'GitHub', base: 'https://github.com', secret: 'github_token', header: 'basic' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ routes: [{ name: 'github', base: 'https://github.com', secret: 'github_token', header: 'x-secret' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ routes: [{ name: 'github', base: 'ftp://github.com', secret: 'github_token', header: 'basic' }] })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.updateSettings({ routes: 'github' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });
});

describe('registry: gevoelige secrets', () => {
    it('standaard niet gevoelig; aan en uit te zetten; zichtbaar in lijst en lookup', async () => {
        const id = await registry.addSecret({ name: 'bank', value: fakeSecret('bank'), hosts: ['api.bank.example'] });
        expect((await registry.findSecret('bank')).sensitive).toBe(false);
        await registry.setSecretSensitive(id, true);
        expect((await registry.findSecret('bank')).sensitive).toBe(true);
        expect((await registry.listSecrets())[0].sensitive).toBe(true);
        const other = await registry.addSecret({ name: 'prod', value: fakeSecret('prod'), hosts: ['api.prod.example'], sensitive: true });
        expect((await registry.listSecrets()).find(s => s.id === other).sensitive).toBe(true);
    });

    it('MOET weigeren: iets anders dan true of false', async () => {
        const id = await registry.addSecret({ name: 'bank', value: fakeSecret('bank'), hosts: ['api.bank.example'] });
        await expect(registry.setSecretSensitive(id, 'ja')).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });
});

describe('registry: aanraken met welke passkey', () => {
    it('standaard any; external kan; iets anders MOET geweigerd worden', async () => {
        expect((await registry.getSettings()).touchAuthenticator).toBe('any');
        expect((await registry.updateSettings({ touchAuthenticator: 'external' })).touchAuthenticator).toBe('external');
        await expect(registry.updateSettings({ touchAuthenticator: 'pin' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });
});

describe('registry: toekenningen met soort en looptijd', () => {
    async function setup() {
        await registry.addSecret({ name: 'gh', value: fakeSecret('gh'), hosts: ['api.github.com'] });
        const { id: toolId } = await registry.addTool({ name: 'mytool' });
        return toolId;
    }

    it('standaard stil en zonder einde; melding en een einde kunnen; findGrant zegt of hij verlopen is', async () => {
        const toolId = await setup();
        const id = await registry.addGrant({ toolId, secretName: 'gh', host: 'https://api.github.com', origin: 'portal' });
        expect(await registry.findGrant(toolId, 'gh', 'https://api.github.com')).toMatchObject({ id, mode: 'silent', expiresAt: null, expired: false });
        await registry.setGrant(id, { mode: 'confirm', expiresAt: clock.now() + 1000 });
        expect((await registry.listGrants())[0]).toMatchObject({ mode: 'confirm', expiresAt: clock.now() + 1000 });
        clock.advance(1000);
        expect(await registry.findGrant(toolId, 'gh', 'https://api.github.com')).toMatchObject({ expired: true });
        expect(await registry.findGrant(toolId, 'gh', 'https://uploads.github.com')).toBeNull();
    });

    it('opnieuw toekennen (bv. "30 min" na een verlopen toekenning) vernieuwt einde en soort', async () => {
        const toolId = await setup();
        const id = await registry.addGrant({ toolId, secretName: 'gh', host: 'https://api.github.com', origin: 'tray', mode: 'confirm', expiresAt: clock.now() + 10 });
        clock.advance(20);
        expect(await registry.addGrant({ toolId, secretName: 'gh', host: 'https://api.github.com', origin: 'tray', expiresAt: clock.now() + 30 * 60_000 })).toBe(id);
        expect(await registry.findGrant(toolId, 'gh', 'https://api.github.com')).toMatchObject({ expired: false, mode: 'confirm', expiresAt: clock.now() + 30 * 60_000 });
    });

    it('MOET weigeren: een onbekende soort of een einde dat geen getal is', async () => {
        const toolId = await setup();
        const id = await registry.addGrant({ toolId, secretName: 'gh', host: 'https://api.github.com', origin: 'portal' });
        await expect(registry.setGrant(id, { mode: 'luid' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.setGrant(id, { expiresAt: 'morgen' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });
});

describe('registry: "bij gebruik" en "geldig" horen bij de toekenning, niet bij de key', () => {
    const host = 'https://api.github.com';
    async function setup() {
        await registry.addSecret({ name: 'gh', value: fakeSecret('gh'), hosts: ['api.github.com'] });
        await registry.addSecret({ name: 'ander', value: fakeSecret('ander'), hosts: ['api.github.com'] });
        const { id: mytool } = await registry.addTool({ name: 'mytool' });
        const { id: agent } = await registry.addTool({ name: 'agent' });
        return { mytool, agent };
    }

    it('Given een toekenning "melding" voor 1 uur When opgezocht Then zo voor die combinatie en geen andere; MOET weigeren na het uur', async () => {
        const local = newVault();
        await local.vault.create({ passphrase: 'p' });
        ({ clock } = local);
        registry = createRegistry({ vault: local.vault, clock, crypto });
        const { mytool, agent } = await setup();
        await registry.addGrant({ toolId: mytool, secretName: 'gh', host, origin: 'portal', mode: 'notify', expiresAt: clock.now() + 3_600_000 });
        await registry.addGrant({ toolId: agent, secretName: 'gh', host, origin: 'portal' });
        expect(await registry.findGrant(mytool, 'gh', host)).toMatchObject({ mode: 'notify', expired: false });
        expect(await registry.hasGrant(mytool, 'gh', host)).toBe(true);
        // een andere tool met hetzelfde secret: stil en zonder einde; dezelfde tool met een ander secret: niets
        expect(await registry.findGrant(agent, 'gh', host)).toMatchObject({ mode: 'silent', expiresAt: null });
        expect(await registry.findGrant(mytool, 'ander', host)).toBeNull();
        expect(await registry.hasGrant(mytool, 'ander', host)).toBe(false);
        clock.advance(3_599_999);
        expect(await registry.hasGrant(mytool, 'gh', host)).toBe(true);
        clock.advance(1);
        expect(await registry.findGrant(mytool, 'gh', host)).toMatchObject({ expired: true });
        expect(await registry.hasGrant(mytool, 'gh', host)).toBe(false);
        expect(await registry.hasGrant(agent, 'gh', host)).toBe(true);
    });

    it('Given een bestaande key met standaard melding en 1 uur When een nieuwe toekenning zonder keuze Then krijgt ze die standaard (geen gegevens weg)', async () => {
        await registry.addSecret({ name: 'gh', value: fakeSecret('gh'), hosts: ['api.github.com'] });
        const { id: oud } = await registry.addTool({ name: 'oud', onUse: 'notify', validMs: 3_600_000 });
        const { id: nieuw } = await registry.addTool({ name: 'nieuw' });
        await registry.addGrant({ toolId: oud, secretName: 'gh', host, origin: 'portal' });
        await registry.addGrant({ toolId: nieuw, secretName: 'gh', host, origin: 'portal' });
        expect(await registry.findGrant(oud, 'gh', host)).toMatchObject({ mode: 'notify', expiresAt: clock.now() + 3_600_000 });
        expect(await registry.findGrant(nieuw, 'gh', host)).toMatchObject({ mode: 'silent', expiresAt: null });
    });

    it('Given een key met standaard When de toekenning zelf kiest (ook "altijd" = null) Then wint de keuze van de toekenning', async () => {
        await registry.addSecret({ name: 'gh', value: fakeSecret('gh'), hosts: ['api.github.com'] });
        const { id: oud } = await registry.addTool({ name: 'oud', onUse: 'confirm', validMs: 1_800_000 });
        await registry.addGrant({ toolId: oud, secretName: 'gh', host, origin: 'tray', mode: 'silent', expiresAt: null });
        expect(await registry.findGrant(oud, 'gh', host)).toMatchObject({ mode: 'silent', expiresAt: null });
    });
});

describe('registry: een virtuele key (tool) met soort en standaardwaarden', () => {
    it('Given een nieuwe key When zonder keuzes Then webrequests, stil, altijd', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        expect((await registry.listTools()).find(t => t.id === id)).toMatchObject({ kind: 'web', onUse: 'silent', validMs: 0 });
    });

    it('Given keuzes MCP, melding, 1 uur When aangemaakt en gewijzigd Then bewaard en terug te vinden via de key', async () => {
        const { id, key } = await registry.addTool({ name: 'agent', kind: 'mcp', onUse: 'notify', validMs: 3_600_000 });
        expect(await registry.findToolByKey(key)).toMatchObject({ kind: 'mcp', onUse: 'notify', validMs: 3_600_000 });
        await registry.setToolDefaults(id, { onUse: 'silent', validMs: 0 });
        expect((await registry.listTools())[0]).toMatchObject({ kind: 'mcp', onUse: 'silent', validMs: 0 });
    });

    it('MOET weigeren: een onbekende soort, een onbekende "bij gebruik" en een negatieve of vreemde looptijd', async () => {
        await expect(registry.addTool({ name: 'a', kind: 'ftp' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.addTool({ name: 'b', onUse: 'loud' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.addTool({ name: 'c', validMs: -1 })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        await expect(registry.addTool({ name: 'd', validMs: '1h' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
        expect(await registry.listTools()).toEqual([]);
    });
});

describe('registry: generatieteller', () => {
    it('Given een registry When alleen gelezen Then blijft de teller staan; When een tool ingetrokken, een toekenning verwijderd of een host gewijzigd Then stijgt ze telkens', async () => {
        const secret = await registry.addSecret({ name: 'demo', value: fakeSecret('gen'), hosts: ['api.example.com'] });
        const tool = await registry.addTool({ name: 'mytool' });
        const grant = await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: 'https://api.example.com', origin: 'portal' });
        const seen = [registry.generation()];
        await registry.listSecrets();
        await registry.findToolByKey(tool.key);
        await registry.findGrant(tool.id, 'demo', 'https://api.example.com');
        seen.push(registry.generation());
        await registry.revokeTool(tool.id);
        seen.push(registry.generation());
        await registry.removeGrant(grant);
        seen.push(registry.generation());
        await registry.setSecretHosts(secret, ['elders.example']);
        seen.push(registry.generation());
        expect(seen[1]).toBe(seen[0]);
        expect(seen[2]).toBeGreaterThan(seen[1]);
        expect(seen[3]).toBeGreaterThan(seen[2]);
        expect(seen[4]).toBeGreaterThan(seen[3]);
    });
});
