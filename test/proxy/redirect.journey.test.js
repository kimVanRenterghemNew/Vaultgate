// De doelhost-allowlist in het echte proces. Een vreemde host wordt geweigerd en geaudit; een redirect
// van een toegestane host naar een andere host neemt het secret niet mee (de proxy volgt nooit, en een gevolgde redirect
// loopt terug via de proxy, waar de allowlist opnieuw beslist).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, PASSPHRASE } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { createVault } from '../../src/vault/index.js';
import { createAudit } from '../../src/audit/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';

const value = fakeSecret('gh');
let allowedHost;
let evilHost;
let proc;
let home;
let toolKey;

describe.each(MODES)('%s', (mode, start) => {
    beforeAll(async () => {
        evilHost = await startUpstream();
        allowedHost = await startUpstream((req, res) => {
            res.writeHead(302, { location: `${evilHost.origin}/steal` });
            res.end();
        });
        home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'github_token', value, hosts: [allowedHost.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'github_token', host: allowedHost.origin, origin: 'portal' });
            await registry.addGrant({ toolId: tool.id, secretName: 'github_token', host: evilHost.origin, origin: 'portal' }); // zelfs met een toekenning
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await allowedHost?.close();
        await evilHost?.close();
    });

    const call = (url, redirect = 'manual') => fetch(`${proc.proxy}/forward/${url}`, { redirect, headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:github_token}}' } });

    describe('doelhost-allowlist in het proces', () => {
        it('Given een secret met allowlist When een call naar een andere host Then target-host-not-allowed, ook met toekenning, en de vreemde host ziet niets', async () => {
            const res = await call(`${evilHost.origin}/x`);
            expect(res.status).toBe(403);
            expect((await res.json()).error).toMatchObject({ rule: 'target-host-not-allowed', secret: 'github_token' });
            expect(evilHost.requests).toHaveLength(0);
        });

        it('Given een toegestane host die 302 naar een andere host stuurt When de client de redirect volgt Then gaat het secret niet mee naar de nieuwe host', async () => {
            const manual = await call(`${allowedHost.origin}/start`);
            expect(manual.status).toBe(302);
            expect(manual.headers.get('location')).toBe(`${proc.proxy}/forward/${evilHost.origin}/steal`);
            const followed = await call(`${allowedHost.origin}/start`, 'follow');
            expect(followed.status).toBe(403);
            expect(followed.headers.get('x-vault-gate-rule')).toBe('target-host-not-allowed');
            expect(evilHost.requests).toHaveLength(0);
            expect(allowedHost.requests.every(r => r.headers.authorization === `Bearer ${value}`)).toBe(true);
        });

        it('de audit toont de poging, met regelnaam en zonder waarde', async () => {
            await proc.stop();
            const crypto = createCrypto();
            const clock = { now: () => Date.now() };
            const store = choose('store', 'local', { dir: path.join(home, 'vault') });
            const vault = createVault({ store, crypto, clock, kdf: MIN_KDF });
            await vault.load();
            await vault.unlockWithPassphrase(PASSPHRASE);
            const entries = await createAudit({ vault, store, clock }).read();
            expect(entries.some(e => e.rule === 'target-host-not-allowed' && e.secret === 'github_token' && e.host === evilHost.origin && e.tool === 'mytool')).toBe(true);
            expect(findLeaks({ audit: JSON.stringify(entries), output: proc.output() }, [value, toolKey])).toEqual([]);
        });
    });
});
