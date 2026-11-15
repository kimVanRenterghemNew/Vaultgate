// Een ingetrokken tool komt niet terug door een oude kopie van de kluismap terug te zetten. Het echte proces: intrekken
// in het portaal, stoppen, de oudere kopie terugzetten, opnieuw starten. De kluis blijft dicht (ook via --unlock-stdin),
// het portaal toont de waarschuwing, en pas na het bewust aanvinken opent de teruggezette kopie.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, seedVault, MODES, PASSPHRASE, waitForEvent } from '../helpers/journey.js';
import { openBrowser, screenshot, tid, settled } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

/** Inloggen zonder passkey (eerste registratie, zoals een kluis met alleen een passphrase): cookie + CSRF-token. */
async function portalSession(portal) {
    const res = await fetch(`${portal}/api/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', origin: portal }, body: JSON.stringify({ passphrase: PASSPHRASE }) });
    expect(res.status).toBe(200);
    return { cookie: res.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await res.json()).csrf };
}

describe.each(MODES)('anti-rollback in het portaal, %s', (mode, start) => {
    const outputs = [];
    let b;
    afterAll(async () => { await b?.close(); });

    it('een teruggezette oudere kopie opent pas na bevestiging, met de data van die kopie', async () => {
        const home = tempHome();
        const vaultDir = path.join(home, 'vault');
        const { id, key } = await seedVault(home, ({ registry }) => registry.addTool({ name: 'agent', clients: [] }));

        // Gewoon gebruik: het proces opent de kluis, de gebruiker trekt de tool in. Daarvóór een kopie van de map.
        const first = await start(home, { unlock: true });
        const headers = await portalSession(first.portal);
        const backup = `${vaultDir}-backup`;
        fs.cpSync(vaultDir, backup, { recursive: true });
        const revoke = await fetch(`${first.portal}/api/tools/${id}/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', origin: first.portal, ...headers }, body: '{}' });
        expect(revoke.status).toBe(200);
        outputs.push(await first.stop());

        // Iemand zet de oude kopie terug.
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.cpSync(backup, vaultDir, { recursive: true });

        const second = await start(home, { unlock: mode === 'proces' });
        if (mode === 'proces') {
            expect((await waitForEvent(second, 'unlock-failed')).code).toBe('VAULT_ROLLED_BACK');
            expect(second.ready.unlocked).toBe(false);
        }
        b = await openBrowser();
        const page = b.page;
        await page.goto(second.portal);
        await tid(page, 'view-login').waitFor();
        await tid(page, 'bootstrap-pass').fill(PASSPHRASE);
        await tid(page, 'bootstrap-go').click();
        await settled(page);
        await tid(page, 'rollback').waitFor({ state: 'visible' });
        expect(await tid(page, 'message').textContent()).toContain('older copy');
        const state = await page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(state).toMatchObject({ unlocked: false, rolledBack: true });
        if (mode === 'proces') await screenshot(page, 'portaal-17-oudere-kopie');

        await tid(page, 'rollback-accept').check();
        await tid(page, 'bootstrap-pass').fill(PASSPHRASE);
        await tid(page, 'bootstrap-go').click();
        await tid(page, 'view-main').waitFor();
        await expect(tid(page, 'rollback').isHidden()).resolves.toBe(true);
        const tools = await page.evaluate(async () => (await globalThis.portalFetch('/api/tools')).json());
        expect(tools.find(t => t.name === 'agent').revoked).toBe(false); // bewust teruggezet: de kopie geldt
        outputs.push(await second.stop());

        // De herstelde kopie is nu de geldige: een herstart opent ze gewoon.
        const third = await start(home, { unlock: true });
        expect(third.events.some(e => e.event === 'unlock-failed')).toBe(false);
        outputs.push(await third.stop());
        expect(findLeaks(outputs.join('\n'), [key, PASSPHRASE])).toEqual([]);
    }, 90_000);
});
