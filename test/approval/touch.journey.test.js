// Een tray die "altijd" antwoordt (zoals een programma dat de knop indrukt) geeft pas een toekenning
// na een aanraking van de passkey in het portaalvenster. Het echte proces, een echte browser met een virtuele
// authenticator; het venster wordt in de test niet geopend (`--window none`): de test opent zelf de pagina uit de log.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES, waitForEvent } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled, answerTouch } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { findLeaks } from '../helpers/secretLeak.js';

const VALUE = 'FAKE-touch-value-1234567890abcdef';

describe.each(MODES)('aanraking voor "altijd" en gevoelige secrets, %s', (mode, start) => {
    let proc;
    let b;
    let upstream;
    let key;
    let api;
    const shots = mode === 'proces';

    beforeAll(async () => {
        upstream = await startUpstream();
        proc = await start(tempHome(), { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        api = (method, path, body) => b.page.evaluate(async ([m, p, bd]) => {
            const state = await (await globalThis.portalFetch('/api/state')).json();
            const res = await globalThis.portalFetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: bd ? JSON.stringify(bd) : undefined });
            return res.json();
        }, [method, path, body]);
        await api('POST', '/api/secrets', { name: 'demo', value: VALUE, hosts: [upstream.origin] });
        key = (await api('POST', '/api/tools', { name: 'mytool' })).key;
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });
    const openTouch = n => answerTouch(b.page, proc, n, { open: false });

    it('Given "altijd" in de tray When de passkey aangeraakt wordt Then is er een toekenning, en de volgende call vraagt niets', async () => {
        const pending = call();
        await openTouch(1);
        expect(await tid(b.page, 'touch-question').textContent()).toContain('mytool');
        if (shots) await screenshot(b.page, 'portaal-16-aanraking');
        await tid(b.page, 'touch-confirm').click();
        await tid(b.page, 'touch-done').waitFor();
        const first = await pending;
        expect(first.headers.get('x-vault-gate-rule')).toBe('approved-4h');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
    });

    it('MOET weigeren: "altijd" zonder aanraking (weigeren in het venster) geeft geen toekenning en geen call', async () => {
        const grants = await api('GET', '/api/grants');
        for (const g of grants) await api('DELETE', `/api/grants/${g.id}`);
        const before = upstream.requests?.length;
        const pending = call();
        await openTouch(2);
        await tid(b.page, 'touch-deny').click();
        const res = await pending;
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'touch-denied']);
        expect(await api('GET', '/api/grants')).toEqual([]);
        if (before !== undefined) expect(upstream.requests.length).toBe(before);
    });

    it('MOET weigeren: een POST op verify zonder geldige assertie (zoals een programma dat probeert)', async () => {
        const pending = call();
        const id = await openTouch(3);
        const res = await fetch(`${proc.portal}/api/touch/${id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: { id: 'x', response: { clientDataJSON: '' } } }) });
        expect(res.status).toBe(401);
        await tid(b.page, 'touch-deny').click();
        expect((await pending).headers.get('x-vault-gate-rule')).toBe('touch-denied');
    });

    it('nergens een lek: procesuitvoer, pagina, API-antwoorden', async () => {
        await waitForEvent(proc, 'touch-requested');
        expect(findLeaks({ out: proc.output(), page: await b.page.content(), api: b.responses.join('\n') }, [VALUE])).toEqual([]);
    });
});

describe('gevoelig markeren in het portaal', () => {
    it('Given een nieuw secret When opgeslagen Then is het standaard gevoelig; uitzetten in Edit haalt de badge weg (zie touch.test.js)', async () => {
        const proc = await MODES[1][1](tempHome(), { unlock: false });
        const b = await openBrowser();
        try {
            await setupPortal(b.page, proc.portal);
            await tid(b.page, 'tab-secrets').click(); await settled(b.page);
            await tid(b.page, 's-open').click();
            await tid(b.page, 's-name').fill('bank');
            await tid(b.page, 's-value').fill('FAKE-bank-value-1234567890');
            await tid(b.page, 's-hosts').fill('api.bank.example');
            await tid(b.page, 's-add').click(); await settled(b.page);
            await tid(b.page, 'sensitive-badge-bank').waitFor();
            await tid(b.page, 'edit-bank').click();
            await tid(b.page, 'secret-edit-sensitive').uncheck();
            await tid(b.page, 'secret-edit-save').click(); await settled(b.page);
            expect(await tid(b.page, 'sensitive-badge-bank').count()).toBe(0);
        } finally {
            await b.close();
            await proc.stop();
        }
    }, 60_000);
});

describe('alleen een externe sleutel mag aanraken', () => {
    it('Given alleen Windows Hello (intern) en de instelling "extern" When "altijd" Then geen aanraking mogelijk (eenmalig); met een USB-sleutel erbij wel', async () => {
        const upstream = await startUpstream();
        const proc = await MODES[1][1](tempHome(), { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
        const b = await openBrowser();
        try {
            await setupPortal(b.page, proc.portal); // registreert de interne (virtuele) authenticator
            const api = (method, p, body) => b.page.evaluate(async ([m, q, bd]) => {
                const state = await (await globalThis.portalFetch('/api/state')).json();
                return (await globalThis.portalFetch(q, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf }, body: bd ? JSON.stringify(bd) : undefined })).json();
            }, [method, p, body]);
            await api('POST', '/api/secrets', { name: 'demo', value: VALUE, hosts: [upstream.origin] });
            const key = (await api('POST', '/api/tools', { name: 'mytool' })).key;
            // Pas daarna 'extern': een key maken vraagt zelf een aanraking, en die kan de interne passkey dan niet meer geven.
            await api('PUT', '/api/settings', { touchAuthenticator: 'external' });
            const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });

            expect((await call()).headers.get('x-vault-gate-rule')).toBe('approved-once');
            expect(proc.events.some(e => e.event === 'touch-requested')).toBe(false);

            await b.addAuthenticator({ transport: 'usb', hasPrf: true });
            await tid(b.page, 'tab-passkeys').click(); await settled(b.page);
            await tid(b.page, 'pk-open').click();
            await tid(b.page, 'pk-add-external').click(); await settled(b.page);
            const pending = call();
            await answerTouch(b.page, proc, 1);
            expect((await pending).headers.get('x-vault-gate-rule')).toBe('approved-4h');
        } finally {
            await b.close();
            await proc.stop();
            await upstream.close();
        }
    }, 90_000);
});
