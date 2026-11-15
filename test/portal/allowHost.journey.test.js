// Een tegengehouden host meteen toestaan als nieuwe toekenning (met een aanraking), elke tab actueel na een wijziging
// in een ander venster (niet midden in een dialoog), en het aanraakicoon alleen op knoppen die altijd een aanraking vragen.
// Echt proces, echte browser met een virtuele passkey, nep-doelservers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, startProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

describe('portaal: host toestaan als toekenning, verversen per tab, aanraakicoon (echt proces)', () => {
    const value = fakeSecret('allowhost');
    let proc;
    let b;
    let known;
    let other;
    let key;

    const call = () => fetch(`${proc.proxy}/forward/${other.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
    const pageFetch = (page, url, method = 'GET', body) => page.evaluate(async ({ url, method, body }) => (await globalThis.portalFetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json(), { url, method, body });

    beforeAll(async () => {
        [known, other] = await Promise.all([startUpstream(), startUpstream()]);
        proc = await startProcess(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        await pageFetch(b.page, '/api/secrets', 'POST', { name: 'demo', value, hosts: [known.origin] });
        key = (await pageFetch(b.page, '/api/tools', 'POST', { name: 'agent' })).key;
    }, 120_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await Promise.all([known?.close(), other?.close()]);
    });

    it('Given een geweigerde request op een onbekende host When "Allow as new grant" en aanraken Then bestaat de toekenning en gaat dezelfde request door', async () => {
        const denied = await call();
        expect(denied.status).toBe(403);
        expect(denied.headers.get('x-vault-gate-rule')).toBe('target-host-not-allowed');
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        const row = b.page.locator('[data-testid="audit-row"][data-kind="warn"]').first();
        expect((await row.locator('.rule').textContent()).trim()).toBe('target-host-not-allowed');
        await row.click();
        await screenshot(b.page, 'portaal-20-host-toestaan');
        const confirmed = proc.events.filter(e => e.event === 'step-up-confirmed').length;
        await tid(b.page, 'audit-allow-host').click();
        await tid(b.page, 'g-dialog').waitFor();
        expect([await tid(b.page, 'g-tool').locator('option:checked').textContent(), await tid(b.page, 'g-secret').inputValue(), await tid(b.page, 'g-host').inputValue()]).toEqual(['agent', 'demo', other.origin]);
        await tid(b.page, 'g-mode').selectOption('silent');
        await screenshot(b.page, 'portaal-20b-aanraakicoon');
        await tid(b.page, 'g-add').click(); // vraagt de aanraking; de virtuele passkey geeft ze
        await settled(b.page);
        expect(proc.events.filter(e => e.event === 'step-up-confirmed').slice(confirmed)).toEqual([expect.objectContaining({ rule: 'step-up-grant' })]);
        const grants = await pageFetch(b.page, '/api/grants');
        expect(grants).toContainEqual(expect.objectContaining({ toolName: 'agent', secretName: 'demo', host: other.origin }));
        expect((await pageFetch(b.page, '/api/secrets')).find(s => s.name === 'demo').hosts).toEqual([known.origin, other.origin]);
        const allowed = await call();
        expect(allowed.status).toBe(200);
        expect(allowed.headers.get('x-vault-gate-rule')).toBe('granted');
    });

    it('MOET weigeren: een nieuwe host via een toekenning zonder aanraking', async () => {
        const res = await b.page.evaluate(async origin => {
            const token = globalThis.sessionStorage.getItem('vaultgate.session');
            const r = await fetch('/api/grants', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ toolId: 'x', secretName: 'demo', host: origin, addHost: true }) });
            return { status: r.status, body: await r.json() };
        }, 'http://127.0.0.1:9');
        expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
        expect((await pageFetch(b.page, '/api/secrets')).find(s => s.name === 'demo').hosts).not.toContain('http://127.0.0.1:9');
    });

    it('Given twee vensters When in venster 2 een secret bijkomt Then toont Secrets in venster 1 het zonder herladen; met een open dialoog pas na het sluiten', async () => {
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await b.page.evaluate(() => { globalThis.notReloaded = true; });
        const [second] = await Promise.all([b.page.context().waitForEvent('page'), b.page.evaluate(() => { globalThis.open('/'); })]);
        await tid(second, 'view-main').waitFor(); await settled(second);
        await pageFetch(second, '/api/secrets', 'POST', { name: 'nieuw', value: fakeSecret('nieuw'), hosts: [known.origin] });
        await tid(b.page, 'secret-row-nieuw').waitFor({ timeout: 2000 });
        // een open dialoog: niet verversen (de gebruiker vult iets in), na het sluiten wel
        await tid(b.page, 's-open').click();
        await pageFetch(second, '/api/secrets', 'POST', { name: 'later', value: fakeSecret('later'), hosts: [known.origin] });
        await expect.poll(() => proc.events.filter(e => e.event === 'ui-push' && e.kind === 'admin').length).toBeGreaterThan(1);
        await new Promise(r => setTimeout(r, 500));
        expect(await tid(b.page, 'secret-row-later').count()).toBe(0);
        await b.page.keyboard.press('Escape');
        await tid(b.page, 'secret-row-later').waitFor({ timeout: 2000 });
        // Virtual keys, Grants en Authentication ook (wijzigingen zonder aanraking: de virtuele passkey hoort bij venster 1)
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        const tool = (await pageFetch(second, '/api/tools')).find(x => x.name === 'agent');
        await pageFetch(second, '/api/blocks', 'POST', { kind: 'tool', toolId: tool.id, until: Date.now() + 15 * 60_000 });
        await tid(b.page, 'tool-block-agent-until').waitFor({ timeout: 2000 });
        await tid(b.page, 'tab-passkeys').click(); await settled(b.page);
        const [passkey] = await pageFetch(second, '/api/passkeys');
        await pageFetch(second, `/api/passkeys/${passkey.id}/name`, 'PUT', { name: 'renamed elsewhere' });
        await b.page.waitForFunction(() => globalThis.document.querySelector('[data-testid="passkey-name"]')?.textContent.includes('renamed elsewhere'), null, { timeout: 2000 });
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        const grant = (await pageFetch(second, '/api/grants')).find(g => g.host === other.origin);
        await tid(b.page, 'grant-row-agent-demo').waitFor();
        await pageFetch(second, `/api/grants/${grant.id}`, 'DELETE');
        await tid(b.page, 'grant-row-agent-demo').waitFor({ state: 'detached', timeout: 2000 });
        expect(await b.page.evaluate(() => globalThis.notReloaded)).toBe(true);
        await second.close();
    });

    it('Given knoppen met een aanraking When getoond Then het icoon (14-20 px) alleen waar altijd een aanraking nodig is', async () => {
        await tid(b.page, 'tab-grants').click(); await settled(b.page);
        await tid(b.page, 'g-open').click();
        const icon = tid(b.page, 'g-add').locator('use[href="#i-touch"]');
        const box = await tid(b.page, 'g-add').locator('svg').first().boundingBox();
        expect(await icon.count()).toBe(1);
        expect(box.width).toBeGreaterThanOrEqual(14); expect(box.width).toBeLessThanOrEqual(20);
        await b.page.keyboard.press('Escape');
        // MOET weigeren: Save van een secret vraagt alleen soms (een domein erbij), dus geen icoon
        await tid(b.page, 'tab-secrets').click(); await settled(b.page);
        await tid(b.page, 'edit-demo').click();
        expect(await tid(b.page, 'secret-edit-save').locator('use[href="#i-touch"]').count()).toBe(0);
        expect(await tid(b.page, 'rotate-demo').locator('use[href="#i-touch"]').count()).toBe(1);
        await b.page.keyboard.press('Escape');
        // een blokkade opheffen vraagt altijd; het icoon staat op die knop (de tool is hierboven geblokkeerd)
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        expect(await tid(b.page, 'tool-block-agent-resume').locator('use[href="#i-touch"]').isVisible()).toBe(true);
    });

    it('nergens een waarde in wat het proces logde', () => {
        expect(findLeaks({ log: proc.output() }, [value, key])).toEqual([]);
    });
});
