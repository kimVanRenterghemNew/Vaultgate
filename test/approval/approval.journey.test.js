// Het echte proces met een tray die het echte tray-protocol spreekt (test/fixtures/fakeTray.mjs, in
// plaats van de WinForms-pop-up). Eerste call van een nieuwe combinatie: vraag aan de tray. "altijd" -> volgende call
// zonder vraag; "eenmalig" -> volgende call vraagt opnieuw; "weigeren" -> 403; geen antwoord -> 401 na de time-out;
// geen tray -> 503. Elke beslissing staat met haar regelnaam in de audit.
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, PASSPHRASE, waitForEvent, startInProcess } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { createVault } from '../../src/vault/index.js';
import { createAudit } from '../../src/audit/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';

const value = fakeSecret('approval');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

async function scenario(start, trayAnswer, { tray = 'fake', approvalTimeoutMs = 30_000 } = {}) {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const home = tempHome();
    const toolKey = await seedVault(home, async ({ registry }) => {
        await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
        await registry.updateSettings({ approvalTimeoutMs });
        return (await registry.addTool({ name: 'mytool' })).key; // geen toekenning: elke combinatie is nieuw
    });
    const proc = await start(home, { tray, env: { FAKE_TRAY_ANSWER: trayAnswer } });
    cleanup.push(() => proc.stop());
    // Wachten tot de tray verbonden is (niet op de klok): onder zware belasting start de nep-tray trager dan de 5 s die de
    // proxy op een startende tray wacht, en dan is "approval-unavailable" het juiste (fail-closed) antwoord.
    if (tray === 'fake') await waitForEvent(proc, 'tray-connected', 60_000);
    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' } });
    return { upstream, home, toolKey, proc, call };
}

async function openVault(home) {
    const crypto = createCrypto();
    const clock = { now: () => Date.now() };
    const store = choose('store', 'local', { dir: path.join(home, 'vault') });
    const vault = createVault({ store, crypto, clock, kdf: MIN_KDF });
    await vault.load();
    await vault.unlockWithPassphrase(PASSPHRASE);
    return { vault, audit: createAudit({ vault, store, clock }), registry: createRegistry({ vault, clock, crypto }) };
}

describe.each(MODES)('goedkeuring via de tray, %s', (mode, start) => {
    // Dit gedrag veranderde met de aanraking: "altijd" maakt pas een toekenning na een aanraking van de passkey. Deze kluis heeft
    // geen passkey (alleen een passphrase), dus is "altijd" hier hoogstens eenmalig. Het pad met passkey en toekenning
    // staat in test/approval/touch.journey.test.js.
    it('Given een tray die "altijd" antwoordt en geen passkey When twee calls Then gaan beide door als eenmalig, zonder toekenning', async () => {
        const { call, upstream, proc, home } = await scenario(start, 'always');
        const first = await call();
        const second = await call();
        expect([first.status, second.status]).toEqual([200, 200]);
        expect([first.headers.get('x-vault-gate-rule'), second.headers.get('x-vault-gate-rule')]).toEqual(['approved-once', 'approved-once']);
        expect(upstream.requests).toHaveLength(2);
        await proc.stop();
        const { registry, audit } = await openVault(home);
        expect(await registry.listGrants()).toEqual([]);
        expect((await audit.read()).map(e => e.rule)).toEqual(['approved-once', 'approved-once']);
        expect(findLeaks({ output: proc.output() }, [value])).toEqual([]);
    }, 30_000);

    it('"eenmalig" laat alleen deze call door: de volgende vraagt opnieuw (geen toekenning)', async () => {
        const { call, proc, home } = await scenario(start, 'once');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('approved-once');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('approved-once');
        await proc.stop();
        const { registry } = await openVault(home);
        expect(await registry.listGrants()).toEqual([]);
    }, 30_000);

    it('"weigeren" geeft 403 approval-denied en de doelhost ziet niets', async () => {
        const { call, upstream } = await scenario(start, 'deny');
        const res = await call();
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { rule: 'approval-denied', secret: 'demo' } });
        expect(upstream.requests).toHaveLength(0);
    }, 30_000);

    it('Given een tray die niet antwoordt When een call Then krijgt de tool na de time-out HTTP 401 approval-timeout, en de time-out staat in de audit', async () => {
        const { call, upstream, proc, home } = await scenario(start, 'never', { approvalTimeoutMs: 1000 }); // 30 s met nepklok: test/approval/approval.test.js
        const t0 = Date.now();
        const res = await call();
        expect(res.status).toBe(401);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
        expect(upstream.requests).toHaveLength(0);
        await proc.stop();
        const { audit } = await openVault(home);
        expect((await audit.read())[0]).toMatchObject({ rule: 'approval-timeout', status: 401, tool: 'mytool', secret: 'demo' });
    }, 30_000);

    it('zonder tray: 503 approval-unavailable, meteen', async () => {
        const { call } = await scenario(start, 'never', { tray: 'none' });
        const t0 = Date.now();
        const res = await call();
        expect(res.status).toBe(503);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approval-unavailable');
        expect(Date.now() - t0).toBeLessThan(1000);
    }, 30_000);
});

describe('een tray die niet verbindt', () => {
    it('Given een tray met een fout token When de wachttijd voorbij is Then logt het proces tray-not-connected en weigert een nieuwe combinatie (approval-unavailable)', async () => {
        const upstream = await startUpstream();
        const home = tempHome();
        const toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            return (await registry.addTool({ name: 'mytool' })).key;
        });
        const proc = await startInProcess(home, { tray: 'fake', env: { FAKE_TRAY_TOKEN: 'fout', FAKE_TRAY_ANSWER: 'always' }, trayConnectTimeoutMs: 300 });
        try {
            await waitForEvent(proc, 'tray-not-connected');
            const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' } });
            expect(res.headers.get('x-vault-gate-rule')).toBe('approval-unavailable');
            expect(upstream.requests).toHaveLength(0);
        } finally {
            await proc.stop();
            await upstream.close();
        }
    });
});
