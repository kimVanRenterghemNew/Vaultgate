// Lock ends only the portal session; Log out also closes the vault and stops proxy access. A closed vault answers a
// tool like an approval that never came: after the approval time-out, 401 approval-timeout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { findLeaks } from '../helpers/secretLeak.js';

const value = 'lock-close-journey-secret';

describe.each(MODES)('portaal Lock en Log out, %s', (_mode, start) => {
    let upstream;
    let proc;
    let toolKey;

    beforeAll(async () => {
        upstream = await startUpstream();
        const home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin], inject: ['header:authorization'] });
            await registry.updateSettings({ approvalTimeoutMs: 1000 }); // het minimum
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    async function portalSession() {
        const response = await fetch(`${proc.portal}/api/unlock`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'journey passphrase' }),
        });
        expect(response.status).toBe(200);
        return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrf };
    }

    async function portalPost(path, session) {
        return fetch(`${proc.portal}${path}`, {
            method: 'POST', headers: { cookie: session.cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrf }, body: '{}',
        });
    }

    const proxyCall = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, {
        headers: { 'x-vault-gate-tool-key': toolKey, authorization: 'Bearer {{secret:demo}}' },
    });

    it('Lock sluit de portal-sessie maar een bestaande toekenning blijft werken; Log out: dezelfde call krijgt na de time-out 401 approval-timeout', async () => {
        const lockSession = await portalSession();
        const lock = await portalPost('/api/lock', lockSession);
        expect(lock.status).toBe(200);
        expect((await proxyCall()).status).toBe(200);
        expect(upstream.requests[0].headers.authorization).toBe(`Bearer ${value}`);

        const logoutSession = await portalSession();
        const logout = await portalPost('/api/logout', logoutSession);
        expect(logout.status).toBe(200);
        const started = Date.now();
        const denied = await proxyCall();
        expect(Date.now() - started).toBeGreaterThanOrEqual(950);
        expect(denied.status).toBe(401);
        expect(denied.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(await denied.json()).toEqual({ error: { type: 'vaultgate', rule: 'approval-timeout', message: 'approval-timeout', secret: 'demo' } });
        expect(upstream.requests).toHaveLength(1);
    }, 30_000);

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, [value, toolKey].filter(Boolean))).toEqual([]);
    });
});
