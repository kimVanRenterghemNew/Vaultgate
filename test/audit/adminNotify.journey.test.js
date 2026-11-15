// Een melding bij elke wijziging, met het echte proces en de nep-tray: een toekenning die er in het portaal bijkomt, geeft
// een ballon met een zin, de namen en de herkomst, en staat in de audit als beheer. Geen waarde in de meldingen.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { createSoftAuthenticator } from '../helpers/softAuthenticator.js';
import { portalClient } from '../helpers/portalClient.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('notice');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

const notices = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.type === 'notify') : []);

describe.each(MODES)('een melding bij elke wijziging, %s', (mode, start) => {
    it('Given een open kluis met de nep-tray When een toekenning bijkomt via het portaal Then een melding met de zin en de herkomst, zonder waarde', async () => {
        const home = tempHome();
        const auth = createSoftAuthenticator();
        const toolId = await seedVault(home, async ({ vault, registry }) => {
            await vault.addCredential(auth.credential);
            await registry.addSecret({ name: 'demo', value, hosts: ['https://api.example.com'] });
            return (await registry.addTool({ name: 'agent' })).id;
        });
        const trayLog = path.join(home, 'tray.log');
        const proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_LOG: trayLog } });
        cleanup.push(() => proc.stop());

        const portal = portalClient(proc.portal, { key: auth });
        const { data } = await portal.raw('POST', '/api/webauthn/login/options');
        expect((await portal.raw('POST', '/api/webauthn/login/verify', { response: auth.assert({ challenge: data.options.challenge, origin: proc.portal }) })).status).toBe(200);
        const added = await portal.call('POST', '/api/grants', { toolId, secretName: 'demo', host: 'https://api.example.com' });
        expect(added.status, JSON.stringify(added.data)).toBe(200);

        const wanted = 'New grant: agent may use demo on https://api.example.com.';
        const deadline = Date.now() + 10_000;
        while (!notices(trayLog).some(n => n.text === wanted) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        expect(notices(trayLog)).toContainEqual(expect.objectContaining({ title: 'Vaultgate: changed in the portal', text: wanted }));
        expect(findLeaks({ tray: fs.readFileSync(trayLog, 'utf8'), out: proc.output() }, [value])).toEqual([]);
    }, 60_000);
});
