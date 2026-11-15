// Elke beheerwijziging staat in de versleutelde audit: het echte proces, een software-passkey in de kluis en de
// portaal-API zoals de pagina ze gebruikt (met aanraking waar het portaal erom vraagt). Een regel noemt de herkomst
// (portal, tray), de regelnaam en oud → nieuw; nooit een secret-waarde of tool-key, ook niet bij roteren.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';
import { portalClient } from '../helpers/portalClient.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';

const value = fakeSecret('admin');
const rotated = fakeSecret('admin-rotated');
const added = fakeSecret('admin-added');

describe.each(MODES)('beheer in de audit, %s', (mode, start) => {
    let proc;
    let c;
    let ids;
    let upstream;
    let home;
    const keys = [];
    const outputs = [];
    const admin = async () => { const { data } = await c.call('GET', '/api/audit?decision=admin'); outputs.push(JSON.stringify(data)); return data; };

    beforeAll(async () => {
        upstream = await startUpstream();
        home = tempHome();
        const key = createSoftAuthenticator();
        ids = await seedVault(home, async ({ vault, registry }) => {
            await vault.addCredential(key.credential);
            await vault.addPasskey({ credentialId: key.credential.id, prfOutput: Buffer.alloc(32, 7) });
            const secret = await registry.addSecret({ name: 'gh', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'agent' });
            keys.push(tool.key);
            return { secret, tool: tool.id, credential: key.credential.id };
        });
        proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
        c = portalClient(proc.portal, { key });
        const { data } = await c.raw('POST', '/api/webauthn/login/options');
        expect((await c.raw('POST', '/api/webauthn/login/verify', { response: key.assert({ challenge: data.options.challenge, origin: proc.portal }) })).status).toBe(200);
    }, 60_000);
    afterAll(async () => { await proc?.stop(); await upstream?.close(); });

    it('Given een host toegevoegd aan een secret When de audit bekeken Then staat er een regel met oud en nieuw en herkomst portaal', async () => {
        const res = await c.call('PUT', `/api/secrets/${ids.secret}/hosts`, { hosts: [upstream.origin, 'https://uploads.example.com'] });
        expect(res.status, JSON.stringify(res.data)).toBe(200);
        const [change, touch] = await admin();
        expect(change).toMatchObject({ mode: 'admin', origin: 'portal', rule: 'secret-hosts-changed', secret: 'gh', detail: `hosts: ${upstream.origin} → ${upstream.origin}, https://uploads.example.com` });
        expect(change.t).toEqual(expect.any(Number));
        expect(touch).toMatchObject({ mode: 'admin', origin: 'portal', rule: 'step-up-confirmed', detail: 'step-up-hosts' });
    });

    it('Given beheer in het portaal (secrets, tools, toekenningen, passkeys, instellingen, blokkades) When de audit bekeken Then een regel per wijziging, nooit een waarde of key', async () => {
        const ok = async (method, p, body) => { const res = await c.call(method, p, body); expect(res.status, `${method} ${p} ${JSON.stringify(res.data)}`).toBe(200); return res.data; };
        const { id: other } = await ok('POST', '/api/secrets', { name: 'ander', value: added, hosts: [upstream.origin] });
        await ok('POST', `/api/secrets/${other}/rotate`, { value: rotated });
        await ok('PUT', `/api/secrets/${other}/name`, { name: 'ander2' });
        await ok('PUT', `/api/secrets/${other}/sensitive`, { sensitive: true });
        const tool = await ok('POST', '/api/tools', { name: 'nieuw' });
        keys.push(tool.key, (await ok('POST', `/api/tools/${tool.id}/rotate`)).key);
        await ok('PUT', `/api/tools/${tool.id}/name`, { name: 'nieuw2' });
        await ok('POST', `/api/tools/${tool.id}/revoke`);
        const { id: grant } = await ok('POST', '/api/grants', { toolId: ids.tool, secretName: 'ander2', host: upstream.origin, durationMs: 3_600_000 });
        await ok('PUT', `/api/grants/${grant}`, { mode: 'confirm' });
        await ok('DELETE', `/api/grants/${grant}`);
        await ok('PUT', `/api/passkeys/${ids.credential}/name`, { name: 'YubiKey' });
        await ok('PUT', '/api/settings', { autoLockMs: 600_000 });
        const block = await ok('POST', '/api/blocks', { kind: 'tool', toolId: ids.tool, durationMs: 60_000 });
        await ok('DELETE', `/api/blocks/${block.id}`);
        await ok('POST', '/api/snooze/global', { durationMs: 60_000 });
        await ok('DELETE', `/api/tools/${tool.id}`);
        await ok('DELETE', `/api/secrets/${other}`);

        const entries = await admin();
        expect(entries.every(e => e.mode === 'admin' && e.origin === 'portal')).toBe(true);
        const rules = entries.map(e => e.rule).filter(r => r !== 'step-up-confirmed').reverse();
        expect(rules.slice(rules.indexOf('secret-added'))).toEqual([
            'secret-added', 'secret-rotated', 'secret-renamed', 'secret-sensitive-changed',
            'tool-added', 'tool-key-rotated', 'tool-renamed', 'tool-revoked',
            'grant-added', 'grant-changed', 'grant-removed', 'passkey-renamed', 'settings-changed',
            'tool-blocked', 'tool-unblocked', 'notifications-snoozed', 'tool-removed', 'secret-removed',
        ]);
        expect(entries.find(e => e.rule === 'settings-changed').detail).toBe('autoLockMs: 900000 → 600000');
        expect(entries.find(e => e.rule === 'secret-rotated')).toMatchObject({ secret: 'ander' });
        expect(entries.find(e => e.rule === 'secret-rotated').detail).toBeUndefined();
        expect(entries.filter(e => e.rule === 'step-up-confirmed').map(e => e.detail)).toEqual(expect.arrayContaining(['step-up-secret-rotate', 'step-up-tool-create', 'step-up-grant', 'step-up-unblock']));
    });

    it('Given een "altijd" in de tray met een aanraking When de audit bekeken Then een toekenning met herkomst tray', async () => {
        const call = fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': keys[0], authorization: 'Bearer {{secret:gh}}' } });
        const deadline = Date.now() + 10_000;
        while (!proc.events.some(e => e.event === 'touch-requested') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        const { id } = proc.events.find(e => e.event === 'touch-requested');
        const { data } = await c.raw('POST', `/api/touch/${id}/options`);
        expect((await c.raw('POST', `/api/touch/${id}/verify`, { response: c.key.assert({ challenge: data.options.challenge, origin: proc.portal }) })).status).toBe(200);
        expect((await call).headers.get('x-vault-gate-rule')).toBe('approved-4h');
        expect((await admin())[0]).toMatchObject({ mode: 'admin', origin: 'tray', rule: 'grant-added', tool: 'agent', secret: 'gh', host: upstream.origin });
    });

    it('beheer telt niet mee in vandaag in cijfers en niet bij toegestaan of tegengehouden', async () => {
        const all = (await c.call('GET', '/api/audit?limit=1000')).data;
        const decided = [...(await c.call('GET', '/api/audit?decision=allow')).data, ...(await c.call('GET', '/api/audit?decision=deny')).data];
        expect(decided.some(e => e.mode === 'admin')).toBe(false);
        const stats = (await c.call('GET', '/api/stats?since=0')).data;
        expect(stats.allowed + stats.stopped).toBe(all.filter(e => e.mode !== 'admin' && e.rule !== 'response-scrubbed').length);
        outputs.push(JSON.stringify(all));
    });

    it('nergens een secret-waarde of tool-key: niet in de audit, de uitvoer of de bestanden', async () => {
        await proc.stop();
        expect(findLeaks({ out: proc.output(), ...Object.fromEntries(outputs.map((o, i) => [`audit-${i}`, o])), ...readTree(home) }, [value, rotated, added, ...keys])).toEqual([]);
    });
});
