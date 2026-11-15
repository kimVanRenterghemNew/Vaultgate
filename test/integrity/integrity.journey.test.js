// Iemand past het tray-script van een geïnstalleerd Vaultgate aan (bv. zodat de tray altijd "toestaan" antwoordt). Het
// echte proces, gestart uit een kopie van de installatie: de eerste start legt de code vast; na de aanpassing blijft de
// kluis dicht (ook via --unlock-stdin), het portaal toont de rode balk met het bestand, en pas na het bewust aanvinken
// opent ze. Een herstart daarna opent gewoon; geen lek in de uitvoer.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, seedVault, MODES, PASSPHRASE, waitForEvent } from '../helpers/journey.js';
import { openBrowser, screenshot, tid, settled } from '../helpers/browser.js';
import { findLeaks, fakeSecret } from '../helpers/secretLeak.js';
import { runnableInstall } from '../helpers/install.js';

const TRAY = 'src/tray-link/windows-tray.ps1';

describe.each(MODES)('gewijzigde eigen code, %s', (mode, start) => {
    const outputs = [];
    const installs = [];
    let b;
    afterAll(async () => { await b?.close(); for (const i of installs) i.remove(); });

    it('Given een aangepast tray-script When Vaultgate start Then blijft de kluis dicht tot de gebruiker bevestigt, en meldt het welk bestand', async () => {
        const install = runnableInstall();
        installs.push(install);
        const from = { main: install.main, codeRoot: install.dir };
        const home = tempHome();
        const value = fakeSecret('integrity');
        await seedVault(home, ({ vault }) => vault.put({ value }));

        const first = await start(home, { unlock: true, ...from }); // legt de code vast
        expect(first.events.some(e => e.event === 'unlock-failed')).toBe(false);
        outputs.push(await first.stop());

        fs.appendFileSync(path.join(install.dir, TRAY), '\n# answer always\n');
        const second = await start(home, { unlock: mode === 'proces', ...from });
        if (mode === 'proces') {
            expect(await waitForEvent(second, 'unlock-failed')).toMatchObject({ code: 'CODE_CHANGED', files: [TRAY] });
            expect(second.ready.unlocked).toBe(false);
        }
        // MOET weigeren: zonder bevestiging, ook via de API.
        const refused = await fetch(`${second.portal}/api/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', origin: second.portal }, body: JSON.stringify({ passphrase: PASSPHRASE }) });
        expect(refused.status).toBe(409);
        expect((await refused.json()).error).toMatchObject({ code: 'CODE_CHANGED', rule: 'code-changed', files: [TRAY] });

        b = await openBrowser();
        const page = b.page;
        await page.goto(second.portal);
        await tid(page, 'view-login').waitFor();
        await tid(page, 'integrity').waitFor({ state: 'visible' });
        expect(await tid(page, 'integrity-files').textContent()).toBe(TRAY);
        expect(await page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json())).toMatchObject({ unlocked: false, codeChanged: [TRAY] });
        if (mode === 'proces') await screenshot(page, 'portaal-18-code-gewijzigd');

        await tid(page, 'integrity-accept').check();
        await tid(page, 'bootstrap-pass').fill(PASSPHRASE);
        await tid(page, 'bootstrap-go').click();
        await settled(page);
        await expect(tid(page, 'integrity').isHidden()).resolves.toBe(true);
        const audit = await page.evaluate(async () => (await globalThis.portalFetch('/api/audit')).json());
        expect(audit.map(e => e.rule)).toContain('code-change-accepted');
        outputs.push(await second.stop());

        // De bevestigde code is nu de geldige: een herstart opent gewoon.
        const third = await start(home, { unlock: true, ...from });
        expect(third.events.some(e => e.event === 'unlock-failed')).toBe(false);
        outputs.push(await third.stop());
        expect(findLeaks({ output: outputs.join('\n'), page: await page.content() }, [value, PASSPHRASE])).toEqual([]);
    }, 120_000);
});
