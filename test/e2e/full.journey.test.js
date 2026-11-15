// Het volledige scenario, zoals een gebruiker het doorloopt, tegen het echte proces. Lege map → opzet in het
// portaal (kluis, herstelcode, passkey) → secret en route naar de mock-provider → een tool koppelt zich met de device
// flow → een Claude Code-achtige client doet een gestreamde call die de tray goedkeurt ("altijd") → toekenning en audit
// in het portaal → een tweede call zonder vraag. Eindigt met een lekcontrole over alles.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { tempHome, startProcess, runLogin, readToolKey } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled, answerTouch } from '../helpers/browser.js';
import { createMockProvider } from '../../scripts/mock-provider.mjs';
import { fakeSecret, findLeaks, readTree } from '../helpers/secretLeak.js';

const anthropicKey = fakeSecret('anthropic');
const mockLog = [];
let mock;
let proc;
let b;
let home;
let clientHome;
let toolKey;
const steps = [];
const step = name => { steps.push(name); console.log(`stap ${steps.length}: ${name}`); };


beforeAll(async () => {
    mock = createMockProvider({ log: e => mockLog.push(e) });
    await mock.start(0);
    home = tempHome();
    clientHome = tempHome();
    proc = await startProcess(home, { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
    b = await openBrowser();
}, 60_000);

afterAll(async () => {
    await b?.close();
    await proc?.stop();
    await mock?.stop();
});

describe('volledig scenario', () => {
    it('1. opzet in het portaal: welkom, passkey met PRF, zonder passphrase/herstelcode', async () => {
        step('opzet: welkom en passkey');
        await setupPortal(b.page, proc.portal);
        const state = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/state')).json());
        expect(state).toMatchObject({ vaultExists: true, unlocked: true, loggedIn: true, hasPassphrase: false, hasRecovery: false });
    });

    it('2. secret "anthropic" met de mock als doelhost, en de route anthropic naar de mock', async () => {
        step('secret en route naar de mock-provider');
        await tid(b.page, 'tab-secrets').click();
        await settled(b.page);
        await tid(b.page, 's-open').click();
        await tid(b.page, 's-name').fill('anthropic');
        await tid(b.page, 's-value').fill(anthropicKey);
        await tid(b.page, 's-hosts').fill(mock.origin);
        await tid(b.page, 's-add').click();
        await settled(b.page);
        await tid(b.page, 'tab-settings').click();
        await settled(b.page);
        await tid(b.page, 'set-routes-open').click();
        await tid(b.page, 'set-route-add').click();
        const route = b.page.locator('[data-route]').last();
        await route.locator('[data-part="name"]').fill('anthropic');
        await route.locator('[data-part="base"]').fill(mock.origin);
        await route.locator('[data-part="secret"]').fill('anthropic');
        await route.locator('[data-part="header"]').selectOption('x-api-key');
        await tid(b.page, 'set-routes-save').click();
        await settled(b.page);
        expect((await tid(b.page, 'message').textContent()).toLowerCase()).toContain('saved');
    });

    it('3. de tool koppelt zich met de device flow; de portalcode en passkey worden bevestigd', async () => {
        step('koppelen: node src/main.js login --name claude-code; code invoeren en de passkey aanraken');
        const pending = runLogin({ proxy: proc.proxy, name: 'claude-code', home: clientHome });
        await tid(b.page, 'tab-tools').click();
        await settled(b.page);
        const row = b.page.locator('[data-testid="device-table"] tbody tr').first();
        for (const started = Date.now(); Date.now() - started < 20_000 && await row.count() === 0;) { await tid(b.page, 'tab-tools').click(); await settled(b.page); }
        const deadline = Date.now() + 10_000;
        while (!/Your code: [0-9A-Z]{4}-[0-9A-Z]{4}/.test(pending.stderr) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        const code = pending.stderr.match(/Your code: ([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
        expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        await tid(b.page, 'device-approve-claude-code').click();
        await tid(b.page, 'ask-input').fill(code);
        await tid(b.page, 'ask-ok').click();
        await settled(b.page);
        const login = await pending;
        expect(login.code, login.stderr).toBe(0);
        toolKey = await readToolKey(clientHome, 'claude-code');
        expect(toolKey).toMatch(/^ks_/);
    }, 30_000);

    it('4. een gestreamde call zoals Claude Code (base-URL + tool-key): de tray zegt "altijd", de mock krijgt de echte sleutel', async () => {
        step('eerste call: goedkeuring in de tray, daarna de passkey aanraken');
        const pending = fetch(`${proc.proxy}/anthropic/v1/messages`, {
            method: 'POST', headers: { 'x-api-key': toolKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-5-5', stream: true, messages: [{ role: 'user', content: 'hoi' }] }),
        });
        await answerTouch(b.page, proc, 1);
        await b.page.goto(proc.portal);
        await tid(b.page, 'view-main').waitFor();
        const res = await pending;
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('approved-always');
        const text = await res.text();
        expect(text).toContain('message_stop');
        const fingerprint = createHash('sha256').update(anthropicKey).digest('hex').slice(0, 8);
        expect(mockLog.at(-1)).toMatchObject({ route: '/v1/messages', keyHeader: 'x-api-key', keyFingerprint: fingerprint, stream: true });
    }, 30_000);

    it('5. het portaal toont de toekenning uit de tray en de audit van koppelen en call', async () => {
        step('portaal: toekenning en audit');
        await tid(b.page, 'tab-grants').click();
        await settled(b.page);
        await b.page.locator('[data-testid^="grant-row-"]').first().click();
        expect(await tid(b.page, 'grant-detail').textContent()).toContain('tray'); // sinds 3.4: herkomst 'tray', ook bij een looptijd
        await tid(b.page, 'tab-audit').click();
        await settled(b.page);
        const rules = await b.page.locator('[data-testid="audit-row"] .rule').allTextContents();
        expect(rules).toEqual(expect.arrayContaining(['device-requested', 'device-approved', 'device-delivered', 'approved-always']));
    });

    it('6. een tweede call gaat zonder vraag door (granted)', async () => {
        step('tweede call: geen onderbreking');
        const res = await fetch(`${proc.proxy}/anthropic/v1/messages`, { method: 'POST', headers: { 'x-api-key': toolKey }, body: JSON.stringify({ model: 'm' }) });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
    });

    it('7. nergens een lek: procesuitvoer, kluisbestanden, pagina, API-antwoorden, mock-log', async () => {
        step('lekcontrole');
        const captured = { out: proc.output(), page: await b.page.content(), api: b.responses.filter(r => !/^POST \S+\/api\/tools /.test(r)).join('\n'), mock: JSON.stringify(mockLog), ...readTree(home) };
        expect(findLeaks(captured, [anthropicKey, toolKey])).toEqual([]);
        expect(steps).toHaveLength(7);
    });
});
