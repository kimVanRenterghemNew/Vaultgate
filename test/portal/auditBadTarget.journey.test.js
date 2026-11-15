// Activity: een call met een gecodeerd pad onder een pad-prefix krijgt een eigen zin (niet de algemene weigerzin),
// in het Engels en het Nederlands, zonder waarde op de pagina, in de API of in de procesuitvoer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, startInProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import en from '../../i18n/en.json' with { type: 'json' };
import nl from '../../i18n/nl.json' with { type: 'json' };

describe('portaal: Activity bij een gecodeerd pad', () => {
    const value = fakeSecret('badtarget');
    let proc;
    let b;
    let upstream;
    let key;

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await startInProcess(tempHome(), { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        key = await b.page.evaluate(async ({ origin, value }) => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const h = { 'content-type': 'application/json', 'x-csrf-token': state.csrf };
            await globalThis.portalFetch('/api/secrets', { method: 'POST', headers: h, body: JSON.stringify({ name: 'repo', value, hosts: [origin + '/repos/user/'] }) });
            const tool = await (await globalThis.portalFetch('/api/tools', { method: 'POST', headers: h, body: JSON.stringify({ name: 'mytool' }) })).json();
            await globalThis.portalFetch('/api/grants', { method: 'POST', headers: h, body: JSON.stringify({ toolId: tool.id, secretName: 'repo', host: origin }) });
            return tool.key;
        }, { origin: upstream.origin, value });
        const res = await fetch(`${proc.proxy}/forward/${upstream.origin}/repos/user/..%2fother`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:repo}}' } });
        expect(res.headers.get('x-vault-gate-rule')).toBe('bad-target');
    }, 120_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('Given een geweigerd gecodeerd pad When Activity opent Then staat er de eigen zin met tool, secret en host, en geen waarde', async () => {
        await tid(b.page, 'tab-audit').click(); await settled(b.page);
        await b.page.locator('[data-testid="audit-row"]').filter({ hasText: 'bad-target' }).click();
        const sentence = (await tid(b.page, 'audit-detail').locator('[data-field="sentence"]').textContent()).trim();
        expect(sentence).toBe(en.rules['bad-target'].replace('{tool}', 'mytool').replace('{secret}', 'repo').replace('{host}', upstream.origin));
        expect(sentence).not.toBe(en.rules.fallback.deny.replace('{tool}', 'mytool'));
        const api = b.responses.filter(r => !/^POST \S+\/api\/tools /.test(r)).join('\n');
        expect(findLeaks({ page: await b.page.content(), api, out: proc.output() }, [value, key])).toEqual([]);
    });

    it('de zin bestaat in beide talen met dezelfde plaatshouders', () => {
        const holders = text => (text.match(/\{\w+\}/g) ?? []).sort();
        expect(typeof nl.rules['bad-target']).toBe('string');
        expect(holders(nl.rules['bad-target'])).toEqual(holders(en.rules['bad-target']));
        expect(holders(en.rules['bad-target'])).toEqual(['{host}', '{secret}', '{tool}']);
    });
});
