// Een nieuw subdomein van een toegestaan domein: geen stille weigering maar een vraag in de tray ("A new subdomain: add
// it to this secret?"). Nee: `subdomain-denied`. Ja ("altijd", met een aanraking): het subdomein komt bij het secret en
// de volgende call vraagt niets meer. Een ander domein: zoals altijd `target-host-not-allowed`, zonder vraag.
// De subdomeinen bestaan niet in DNS: de proxy beslist en schrijft de audit vóór hij verbindt; het doorsturen faalt dan
// (upstream-error), maar de beslissing staat in de audit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, answerTouch } from '../helpers/browser.js';
import { findLeaks } from '../helpers/secretLeak.js';

// De composition wordt hier in-process getest zodat ook het aliaspad van createGrant onder coverage valt.
const [, start] = MODES[1];

describe('een nieuw subdomein vragen', () => {
    let proc;
    let b;
    let key;
    let askLog;
    const api = (method, url, body) => b.page.evaluate(async ({ method, url, body }) => {
        const state = await (await globalThis.portalFetch('/api/state')).json();
        const res = await globalThis.portalFetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: body ? JSON.stringify(body) : undefined });
        return res.json();
    }, { method, url, body });

    beforeAll(async () => {
        // eerst weigeren, daarna "altijd"
        const home = tempHome();
        askLog = path.join(home, 'asks.log');
        proc = await start(home, { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'deny,always', FAKE_TRAY_LOG: askLog } });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        await api('POST', '/api/secrets', { name: 'github_api', value: 'FAKE-subdomain-value-1234567890', hosts: ['api.github.test'], inject: ['header:authorization'] });
        key = (await api('POST', '/api/tools', { name: 'mytool' })).key;
        const passkeyId = proc.app.vault.listCredentials()[0].id;
        await api('PUT', '/api/settings', { blocks: [{ id: 'expired-passkey', kind: 'passkey', passkeyId, until: Date.now() - 1 }] });
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    const call = host => fetch(`${proc.proxy}/forward/https://${host}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:github_api}}' } });
    // Alleen de vragen: elke beheerwijziging geeft ook een melding in dezelfde log.
    const asks = () => (fs.existsSync(askLog) ? fs.readFileSync(askLog, 'utf8').split('\n').filter(Boolean).filter(l => JSON.parse(l).type === 'ask') : []);

    it('MOET weigeren zonder vraag: een host buiten het registreerbare domein (github.test.evil.example)', async () => {
        const res = await call('github.test.evil.example');
        expect(res.headers.get('x-vault-gate-rule')).toBe('target-host-not-allowed');
        expect(asks()).toHaveLength(0);
    });

    it('Given github_api met api.github.test When een call naar uploads.github.test en de tray zegt nee Then subdomain-denied, en de tray kreeg de subdomeinvraag', async () => {
        const res = await call('uploads.github.test');
        expect(res.status).toBe(403);
        expect(res.headers.get('x-vault-gate-rule')).toBe('subdomain-denied');
        expect(asks()).toHaveLength(1);
        expect(asks()[0]).toContain('"variant":"subdomain"');
        expect(asks()[0]).toContain('"certRoot":"unknown"'); // de host bestaat niet: de root kon niet nagekeken worden
        expect((await api('GET', '/api/audit'))[0]).toMatchObject({ rule: 'subdomain-denied', detail: 'root unknown' });
        expect((await api('GET', '/api/secrets'))[0].hosts).toEqual(['https://api.github.test']);
    });

    it('When de tray "altijd" zegt en de passkey aangeraakt wordt Then komt het subdomein bij het secret en vraagt de volgende call niets', async () => {
        const pending = call('uploads.github.test');
        await answerTouch(b.page, proc, 1);
        await pending; // doorsturen faalt (geen DNS), de beslissing staat in de audit
        await b.page.goto(proc.portal);
        expect((await api('GET', '/api/secrets'))[0].hosts).toEqual(['https://api.github.test', 'https://uploads.github.test']);
        await call('uploads.github.test');
        expect(asks()).toHaveLength(2); // geen nieuwe vraag
        const rules = (await api('GET', '/api/audit')).map(e => e.rule);
        expect(rules).toEqual(expect.arrayContaining(['granted', 'approved-4h'])); // handmatige key: "altijd" wordt 4 uur; // plus upstream-error: de host bestaat niet
    }, 60_000);

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, ['FAKE-subdomain-value-1234567890', key].filter(Boolean))).toEqual([]);
    });
});
