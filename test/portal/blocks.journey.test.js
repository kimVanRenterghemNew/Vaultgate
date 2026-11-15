// Blokkeren, rustige uren en meldingen stilzetten zoals een gebruiker het doet: het echte proces, een nep-doelserver en
// het portaal in een browser met een virtuele passkey. Blokkeren slaat meteen toe in de proxy (met de naam van de regel);
// opheffen laat meer toe en vraagt een aanraking; elke blokkade en opheffing staat in de audit. Nergens een waarde.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled } from '../helpers/browser.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';

const value = fakeSecret('blocks');
const hhmm = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

describe.each(MODES)('portaal: blokkeren, rustige uren en stil, %s', (mode, start) => {
    let proc;
    let b;
    let upstream;
    let key;
    let home;
    const shots = mode === 'proces';
    const portal = (method, url, body) => b.page.evaluate(async ([m, u, x]) => (await globalThis.portalFetch(u, { method: m, headers: { 'content-type': 'application/json' }, ...(x ? { body: JSON.stringify(x) } : {}) })).json(), [method, url, body]);
    const call = async () => (await fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } })).headers.get('x-vault-gate-rule');
    const touches = () => proc.events.filter(e => e.event === 'step-up-confirmed').length;
    const tab = async name => { await tid(b.page, 'tab-' + name).click(); await settled(b.page); };
    const act = async id => { await tid(b.page, id).click(); await settled(b.page); };

    beforeAll(async () => {
        upstream = await startUpstream();
        home = tempHome();
        proc = await start(home, { unlock: false });
        b = await openBrowser();
        await setupPortal(b.page, proc.portal);
        await portal('POST', '/api/secrets', { name: 'demo', value, hosts: [upstream.origin] });
        const tool = await portal('POST', '/api/tools', { name: 'agent' });
        key = tool.key;
        const tools = await portal('GET', '/api/tools');
        await portal('POST', '/api/grants', { toolId: tools[0].id, secretName: 'demo', host: upstream.origin, mode: 'notify', durationMs: 14_400_000 }); // handmatige key: hoogstens 4 uur
    }, 90_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('Given een toegestane call When de tool 1 uur geblokkeerd Then tool-blocked met een badge; opheffen vraagt een aanraking en de call gaat weer door', async () => {
        expect(await call()).toBe('granted');
        await tab('tools');
        await tid(b.page, 'tool-block-agent').click();
        await act('tool-block-agent-1h');
        await tid(b.page, 'tool-block-agent-until').waitFor();
        expect(await tid(b.page, 'tool-block-agent-until').textContent()).toMatch(/^blocked until /);
        expect(await call()).toBe('tool-blocked');
        if (shots) await screenshot(b.page, 'portaal-19-blokkeren');
        const before = touches();
        await act('tool-block-agent-resume');
        expect(touches()).toBe(before + 1);
        await tid(b.page, 'tool-block-agent').waitFor();
        expect(await call()).toBe('granted');
    });

    it('een secret tot ik het ophef en een toekenning 15 minuten: secret-blocked en grant-blocked, daarna weer granted', async () => {
        await tab('secrets');
        await tid(b.page, 'secret-block-demo').click();
        await act('secret-block-demo-forever');
        expect(await tid(b.page, 'secret-block-demo-until').textContent()).toBe('blocked until you lift it');
        expect(await call()).toBe('secret-blocked');
        await act('secret-block-demo-resume');
        expect(await call()).toBe('granted');

        await tab('grants');
        await tid(b.page, 'grant-block-agent-demo').click();
        await act('grant-block-agent-demo-15m');
        expect(await call()).toBe('grant-blocked');
        await act('grant-block-agent-demo-resume');
        expect(await call()).toBe('granted');
    });

    it('meldingen stil: per toekenning (met melding) en voor alles, voor een tijd; weer aan zonder aanraking', async () => {
        await tab('grants');
        await tid(b.page, 'grant-silence-agent-demo').click();
        await act('grant-silence-agent-demo-tomorrow');
        expect(await tid(b.page, 'grant-silence-agent-demo-until').textContent()).toMatch(/^silent until /);
        expect((await portal('GET', '/api/snooze')).grants).toHaveLength(1);
        const before = touches();
        await act('grant-silence-agent-demo-resume');
        expect((await portal('GET', '/api/snooze')).grants).toEqual([]);

        await tab('settings');
        await tid(b.page, 'set-silence').click();
        expect(await tid(b.page, 'set-silence-forever').count()).toBe(0); // stil kan alleen voor een tijd
        await act('set-silence-1h');
        expect((await portal('GET', '/api/snooze')).globalUntil).toBeGreaterThan(Date.now());
        await act('set-silence-resume');
        expect((await portal('GET', '/api/snooze')).globalUntil).toBeNull();
        expect(touches()).toBe(before);
    });

    it('Given rustige uren rond nu When een call Then quiet-hours; MOET weigeren: een ongeldig venster; het venster weghalen vraagt een aanraking', async () => {
        await tab('settings');
        const now = new Date();
        const window = `${hhmm(new Date(now.getTime() - 3_600_000))}-${hhmm(new Date(now.getTime() + 3_600_000))}`; // lokale tijd van het proces
        await tid(b.page, 'set-quiet-open').click();
        await tid(b.page, 'set-quiet').fill('25:00-07:00');
        await act('set-quiet-save');
        await tid(b.page, 'message').filter({ hasText: '23:00-07:00' }).waitFor();
        expect((await portal('GET', '/api/settings')).quietHours).toEqual([]);
        await tid(b.page, 'set-quiet').fill(window);
        if (shots) await screenshot(b.page, 'portaal-19b-rustige-uren');
        await act('set-quiet-save');
        expect(await tid(b.page, 'set-quiet-now').textContent()).toBe(window);
        expect(await call()).toBe('quiet-hours');
        const before = touches();
        await tid(b.page, 'set-quiet-open').click();
        await tid(b.page, 'set-quiet').fill('');
        await act('set-quiet-save');
        expect(touches()).toBe(before + 1);
        expect(await tid(b.page, 'set-quiet-now').textContent()).toBe('none');
        expect(await call()).toBe('granted');
    });

    it('passkeys: met één geen blokkeerknop; met twee blokkeer je er één, en MOET weigeren: ook de laatste die overblijft', async () => {
        await tab('passkeys');
        expect(await tid(b.page, 'passkey-block').count()).toBe(0);
        await b.addAuthenticator({ transport: 'usb', hasPrf: true });
        await tid(b.page, 'pk-open').click();
        await act('pk-add-external');
        await tid(b.page, 'passkey-row').nth(1).waitFor();
        await settled(b.page);
        const row = n => tid(b.page, 'passkey-row').nth(n);
        // kiest de passkey links en klikt rechts in haar detail
        const inRow = async (n, id) => {
            if (await row(n).getAttribute('aria-selected') !== 'true') await row(n).click(); // opnieuw kiezen tekent het detail (en een open menu) opnieuw
            await tid(b.page, id).click(); await settled(b.page);
        };
        await inRow(0, 'passkey-block');
        await inRow(0, 'passkey-block-1h');
        await tid(b.page, 'passkey-block-until').waitFor(); // de gekozen passkey blijft gekozen na het herladen
        await inRow(1, 'passkey-block');
        await inRow(1, 'passkey-block-1h');
        await tid(b.page, 'message').filter({ hasText: 'Keep at least one passkey that is not blocked.' }).waitFor();
        const passkeyBlocks = async () => (await portal('GET', '/api/blocks')).filter(x => x.kind === 'passkey');
        expect(await passkeyBlocks()).toHaveLength(1);
        if (shots) await screenshot(b.page, 'portaal-19c-passkey-geblokkeerd');
        await inRow(0, 'passkey-block-resume'); // aanraking met de passkey die niet geblokkeerd is
        expect(await passkeyBlocks()).toEqual([]);
    });

    it('elke blokkade en opheffing staat in de audit; nergens de waarde van het secret', async () => {
        const rules = (await portal('GET', '/api/audit?limit=200')).map(e => e.rule);
        for (const rule of ['passkey-blocked', 'passkey-unblocked','tool-blocked', 'tool-unblocked', 'secret-blocked', 'secret-unblocked', 'grant-blocked', 'grant-unblocked', 'grant-notifications-snoozed', 'grant-notifications-resumed', 'notifications-snoozed', 'notifications-resumed', 'quiet-hours']) {
            expect(rules, rule).toContain(rule);
        }
        expect(findLeaks({ ...readTree(home), out: proc.output() }, [value])).toEqual([]);
    });
});
