// Automatisch vergrendelen in het echte proces is een Lock, zoals een vergrendelde pc die doorwerkt: na de ingestelde tijd
// zonder portaalhandeling vraagt het portaal opnieuw om in te loggen, maar de kluis blijft open en een tool met een
// toekenning werkt door. Toegestane proxy-calls houden het portaal niet open. Alleen Log out sluit de kluis.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, PASSPHRASE } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const [, start] = MODES[0];
const value = fakeSecret('autolock');
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('automatisch vergrendelen in het echte proces', () => {
    let upstream;
    let proc;
    let key;

    beforeAll(async () => {
        upstream = await startUpstream();
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin], inject: ['header:authorization'] });
            await registry.updateSettings({ autoLockMs: 10_000, approvalTimeoutMs: 1000 }); // de minima
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

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
    const portal = (method, path, session) => fetch(`${proc.portal}${path}`, {
        method, headers: { 'content-type': 'application/json', ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(path === '/api/unlock' ? { passphrase: PASSPHRASE } : {}),
    });
    const state = async session => (await portal('GET', '/api/state', session)).json();

    it('Given een portaalsessie en 10 s automatisch vergrendelen When 12 s alleen een tool calls doet Then vraagt het portaal opnieuw in te loggen, blijft de kluis open en werkt de tool door; Log out sluit', async () => {
        const unlocked = await portal('POST', '/api/unlock');
        expect(unlocked.status).toBe(200);
        const session = { cookie: unlocked.headers.get('set-cookie').split(';')[0], csrf: (await unlocked.json()).csrf };
        expect(await state(session)).toMatchObject({ loggedIn: true, unlocked: true, lockInMs: 10_000 });

        const started = Date.now();
        while (Date.now() - started < 12_000) { // toegestane calls tellen niet als activiteit voor het portaal
            expect((await call()).status).toBe(200);
            await sleep(2_000);
        }
        expect(await state(session)).toMatchObject({ loggedIn: false, unlocked: true });
        expect((await portal('GET', '/api/secrets', session)).status).toBe(401);
        expect(proc.events.some(e => e.event === 'locked')).toBe(false); // de kluis ging niet dicht
        const res = await call();
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);

        expect((await portal('POST', '/api/logout')).status).toBe(200);
        const before = upstream.requests.length;
        const denied = await call();
        expect(denied.status).toBe(401);
        expect(denied.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(upstream.requests.length).toBe(before);
    }, 40_000);

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, [value, key].filter(Boolean))).toEqual([]);
    });
});
