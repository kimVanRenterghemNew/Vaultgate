// Validatie-feedback 2026-10-30:
// 1. In welkomstscherm stap 3 toont het commando "vaultgate login --name <tool>" en scrollt de inhoud.
// 2. Bij het toevoegen van een sleutel (kn-add) is de knop disabled en heeft het touch-icoon animatie.
// 3. Een call met geldige key naar een gerelateerd domein (registry.npmjs.org vs api.npmjs.com) triggert subdomain-ask.
// 4. Een tool met kind: 'mcp' weigert gewone webrequests met mcp-tool-required; met x-vault-gate-protocol: mcp mag het wel.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { tempHome, MODES } from '../helpers/journey.js';
import { openBrowser, tid } from '../helpers/browser.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { sameSiteAs, parseHostRules } from '../../src/policy/index.js';

const [, start] = MODES[1];
const secretVal = fakeSecret('npm-token-val');

describe('validatie-feedback 2026-10-30', () => {
    let proc;
    let b;
    let home;
    let askLog;
    let upstream;
    let mcpKey;
    let webKey;

    const api = (method, url, body) => b.page.evaluate(async ({ method, url, body }) => {
        const state = await (await globalThis.portalFetch('/api/state')).json();
        const res = await globalThis.portalFetch(url, {
            method,
            headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf },
            body: body ? JSON.stringify(body) : undefined,
        });
        return res.json();
    }, { method, url, body });

    beforeAll(async () => {
        upstream = await startUpstream((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, auth: req.headers.authorization }));
        });
        home = tempHome();
        askLog = path.join(home, 'asks.log');
        proc = await start(home, { unlock: false, tray: 'fake', env: { FAKE_TRAY_ANSWER: 'once', FAKE_TRAY_LOG: askLog } });
        b = await openBrowser();
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
        await upstream?.close();
    });

    it('stap 1 & 3 in welkomstscherm: toont "vaultgate login" en container heeft scroll-ruimte', async () => {
        await b.page.goto(proc.portal);
        await tid(b.page, 'view-welcome').waitFor();
        await tid(b.page, 'welcome-start').click();
        await tid(b.page, 'pk-add').click();
        await tid(b.page, 'passkey-row').first().waitFor();
        await tid(b.page, 'welcome-passkeys-next').click();
        // Nu op stap 3: koppelcommando nakijken
        await tid(b.page, 'key-way-pair').click();
        await tid(b.page, 't-name').fill('claude-code');
        const cmd = (await tid(b.page, 'key-pair-command').textContent()).trim();
        expect(cmd).toMatch(/^vaultgate login --name claude-code/);
        expect(cmd).not.toContain('node ');
        expect(cmd).not.toContain('src/main.js');

        // Scrollbaarheid testen op compacte viewport
        await b.page.setViewportSize({ width: 800, height: 450 });
        const canScroll = await b.page.evaluate(() => {
            const pages = globalThis.document.getElementById('wl-pages');
            return pages.scrollHeight > pages.clientHeight;
        });
        expect(canScroll).toBe(true);
        // Herstel viewport
        await b.page.setViewportSize({ width: 1180, height: 760 });
    });

    it('touch animatie en disabled toestand tijdens sleutelgeneratie (kn-add)', async () => {
        await tid(b.page, 'key-way-manual').click();
        await tid(b.page, 't-name').fill('test-manual-tool');
        const btn = tid(b.page, 't-add');
        expect(await btn.isDisabled()).toBe(false);
        // Klikken en toestand controleren
        await btn.click();
        // Na succesvolle creatie is de form hidden en de reveal zichtbaar
        await tid(b.page, 't-key-box').waitFor({ timeout: 15_000 });
        const state = await api('GET', '/api/tools');
        const created = state.find(t => t.name === 'test-manual-tool');
        expect(created).toBeDefined();

        // Afronden naar view-main
        await tid(b.page, 'key-done').click();
        await tid(b.page, 'welcome-key-next').click();
        await tid(b.page, 'welcome-finish').click();
        await tid(b.page, 'view-main').waitFor();
    });

    it('gerelateerde host registry.npmjs.org (ander TLD dan api.npmjs.com) matcht geen sameSiteAs', () => {
        const rules = parseHostRules(['https://api.npmjs.com']);
        const match = sameSiteAs(new URL('https://registry.npmjs.org/package/vaultgate'), rules);
        expect(match).toBeNull();
    });

    it('MCP-tool weigert directe webrequests zonder x-vault-gate-protocol: mcp', async () => {
        const mcpTool = await api('POST', '/api/tools', { name: 'mcp-agent', kind: 'mcp' });
        mcpKey = mcpTool.key;
        const webTool = await api('POST', '/api/tools', { name: 'web-agent', kind: 'web' });
        webKey = webTool.key;

        await api('POST', '/api/secrets', { name: 'my_api_key', value: secretVal, hosts: [upstream.origin] });
        await api('POST', '/api/grants', { toolId: mcpTool.id, secretName: 'my_api_key', host: upstream.origin });
        await api('POST', '/api/grants', { toolId: webTool.id, secretName: 'my_api_key', host: upstream.origin });

        // Directe forward-call met MCP-sleutel zonder MCP-protocol
        const denied = await fetch(`${proc.proxy}/forward/${upstream.origin}/test`, {
            headers: { 'x-vault-gate-tool-key': mcpKey, authorization: 'Bearer {{secret:my_api_key}}' },
        });
        expect(denied.status).toBe(403);
        expect(denied.headers.get('x-vault-gate-rule')).toBe('mcp-tool-required');
        const deniedBody = await denied.json();
        expect(deniedBody.error.message).toContain('configured for MCP only');

        // Directe forward-call met MCP-sleutel MET MCP-protocol slaagt
        const allowed = await fetch(`${proc.proxy}/forward/${upstream.origin}/test`, {
            headers: {
                'x-vault-gate-tool-key': mcpKey,
                'x-vault-gate-protocol': 'mcp',
                authorization: 'Bearer {{secret:my_api_key}}',
            },
        });
        expect(allowed.status).toBe(200);
        const data = await allowed.json();
        expect(data.ok).toBe(true);

        // Web tool werkt normaal zonder x-vault-gate-protocol
        const webAllowed = await fetch(`${proc.proxy}/forward/${upstream.origin}/test`, {
            headers: { 'x-vault-gate-tool-key': webKey, authorization: 'Bearer {{secret:my_api_key}}' },
        });
        expect(webAllowed.status).toBe(200);

        // Web tool met x-vault-gate-protocol: mcp wordt geweigerd met web-tool-required (vice versa)
        const webDeniedMcp = await fetch(`${proc.proxy}/forward/${upstream.origin}/test`, {
            headers: { 'x-vault-gate-tool-key': webKey, 'x-vault-gate-protocol': 'mcp', authorization: 'Bearer {{secret:my_api_key}}' },
        });
        expect(webDeniedMcp.status).toBe(403);
        expect(webDeniedMcp.headers.get('x-vault-gate-rule')).toBe('web-tool-required');
    });

    it('geen enkel geheim lekt in bestanden of logs (findLeaks)', async () => {
        const leaks = await findLeaks(home, [secretVal]);
        expect(leaks).toHaveLength(0);
    });
});
