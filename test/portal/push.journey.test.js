// Het portaal ververst vanzelf: het echte proces duwt de soort van een wijziging naar de open pagina, die de gegevens
// zelf ophaalt, zonder herladen en op hetzelfde tabblad. Elke push staat in de log; geen bericht of logregel bevat een
// secret-waarde of tool-key.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, startProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

describe('portaal: ververst vanzelf (pushkanaal), echt proces', () => {
    const value = fakeSecret('push');
    let proc;
    let b;
    let upstream;
    let key;
    let pushed = '';
    let reader;
    let ended = false;

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await startProcess(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        key = await b.page.evaluate(async ({ origin, value }) => {
            const h = { 'content-type': 'application/json' };
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'demo', value, hosts: [origin] }) });
            const tool = await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'pushtool' }) })).json();
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'demo', host: origin }) });
            return tool.key;
        }, { origin: upstream.origin, value });
        // Alles wat het kanaal van deze sessie pusht, ook naar een gewone client met cookie en kaartje (voor het lekonderzoek).
        const cookie = (await b.page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const token = await b.page.evaluate(() => globalThis.sessionStorage.getItem('vaultgate.session'));
        const { ticket } = await (await fetch(`${proc.portal}/api/push/ticket`, { method: 'POST', headers: { cookie, origin: proc.portal, 'x-csrf-token': token, 'content-type': 'application/json' }, body: '{}' })).json();
        reader = (await fetch(`${proc.portal}/api/push?ticket=${ticket}`, { headers: { cookie } })).body.getReader();
        (async () => { for (;;) { const { value: chunk, done } = await reader.read(); if (done) { ended = true; return; } pushed += Buffer.from(chunk).toString('utf8'); } })().catch(() => {});
    }, 120_000);

    afterAll(async () => {
        await reader?.cancel().catch(() => {});
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('Given een open portaal op Activity When een tool een request doet Then verschijnt de nieuwe regel binnen 1 s, zonder herladen', async () => {
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        await b.page.evaluate(() => { globalThis.notReloaded = true; });
        const before = await b.page.locator('[data-testid="audit-row"]').count();
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/ok`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
        expect(res.status).toBe(200);
        const sent = Date.now();
        await b.page.waitForFunction(n => globalThis.document.querySelectorAll('[data-testid="audit-row"]').length > n, before, { timeout: 1000 });
        expect(Date.now() - sent).toBeLessThan(1000);
        expect(await b.page.evaluate(() => globalThis.notReloaded)).toBe(true);
        expect((await b.page.locator('[data-testid="audit-row"] .rule').first().textContent()).trim()).toBe('granted');
        expect(await tid(b.page, 'tab-audit').isVisible()).toBe(true);
        expect(proc.events).toContainEqual(expect.objectContaining({ event: 'ui-push', kind: 'audit' }));
    });

    it('Given een open portaal op Settings When de instellingen wijzigen in een tweede venster Then toont het eerste venster de nieuwe waarde', async () => {
        await tid(b.page, 'tab-settings').click(); await settled(b.page);
        expect(await tid(b.page, 'set-autolock').inputValue()).toBe('15');
        const [second] = await Promise.all([b.page.context().waitForEvent('page'), b.page.evaluate(() => { globalThis.open('/'); })]);
        await tid(second, 'view-main').waitFor();
        await settled(second);
        await tid(second, 'tab-settings').click(); await settled(second);
        await tid(second, 'set-autolock').selectOption('5');
        await settled(second);
        await b.page.waitForFunction(() => globalThis.document.querySelector('[data-testid="set-autolock"]').value === '5', null, { timeout: 2000 });
        expect(await b.page.evaluate(() => globalThis.notReloaded)).toBe(true);
        expect(await tid(b.page, 'tab-settings').isVisible()).toBe(true);
        expect(proc.events).toContainEqual(expect.objectContaining({ event: 'ui-push', kind: 'settings' }));
        await second.close();
    });

    it('Given gepushte berichten en de log When doorzocht op het nep-secret en de tool-key Then niets gevonden; de log noemt alleen de soort (en de tijd)', async () => {
        expect(pushed).toContain('data: audit');
        expect(proc.events.filter(e => e.event === 'ui-push').every(e => Object.keys(e).sort().join() === 'event,kind,t')).toBe(true);
        expect(findLeaks({ pushed, log: proc.output() }, [value, key])).toEqual([]);
    });

    it('Given een open portaal When Lock Then sluit de server het kanaal en toont de pagina het aanmelden', async () => {
        await tid(b.page, 'lock').click();
        await tid(b.page, 'view-login').waitFor();
        await expect.poll(() => ended, { timeout: 2000 }).toBe(true);
        expect(pushed).toContain('data: lock');
    });
});
