// Het tray-menu in het echte proces: "Lock now" is een Lock zoals de knop in het portaal (alle portaalsessies dicht, de
// kluis blijft open, een tool met een toekenning werkt door); "Log out" sluit de kluis zoals Log out in het portaal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, PASSPHRASE, waitForEvent } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('traylock');

describe.each(MODES)('tray-menu: Lock now en Log out, %s', (_mode, start) => {
    let upstream;
    let proc;
    let key;
    let send;

    beforeAll(async () => {
        upstream = await startUpstream();
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin], inject: ['header:authorization'] });
            await registry.updateSettings({ approvalTimeoutMs: 1000 });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        send = path.join(home, 'tray-send');
        proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_SEND: send } });
        await waitForEvent(proc, 'tray-connected');
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
    const state = async session => (await fetch(`${proc.portal}/api/state`, { headers: session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {} })).json();
    async function portalSession() {
        const res = await fetch(`${proc.portal}/api/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: PASSPHRASE }) });
        expect(res.status).toBe(200);
        return { cookie: res.headers.get('set-cookie').split(';')[0], csrf: (await res.json()).csrf };
    }
    const tray = type => fs.writeFileSync(`${send}.${type}`, '');
    const until = async fn => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > 5_000) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); } };

    it('Given een portaalsessie When "Lock now" in de tray Then is het portaal dicht, de kluis open en krijgt de tool 200; When "Log out" Then is de kluis dicht en vertrekt er niets', async () => {
        const session = await portalSession();
        expect(await state(session)).toMatchObject({ loggedIn: true, unlocked: true });

        tray('lock');
        await until(async () => (await state(session)).loggedIn === false);
        expect(await state(session)).toMatchObject({ loggedIn: false, unlocked: true });
        expect((await call()).status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);

        tray('logout');
        await until(async () => (await state()).unlocked === false);
        const before = upstream.requests.length;
        const denied = await call();
        expect(denied.status).toBe(401);
        expect(denied.headers.get('x-vault-gate-rule')).toBe('approval-timeout');
        expect(upstream.requests.length).toBe(before);
    }, 30_000);

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, [value, key].filter(Boolean))).toEqual([]);
    });
});
