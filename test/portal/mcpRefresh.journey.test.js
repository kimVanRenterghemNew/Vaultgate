// MCP verversen na een update
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled, closeChangedFiles } from '../helpers/browser.js';

function toolsList(entry) {
    return new Promise((resolve, reject) => {
        const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stderr.on('data', d => { err += d; });
        child.stdout.on('data', d => {
            out += d;
            if (out.includes('\n')) { child.kill(); resolve(JSON.parse(out.split('\n')[0])); }
        });
        child.on('exit', code => reject(new Error(`entry stopte (${code}): ${err}`)));
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    });
}

describe('portaal: MCP refresh na update (journey)', () => {
    let proc;
    let b;
    let user;
    let vault;

    beforeAll(async () => {
        user = tempHome();
        vault = tempHome();

        // Zorg dat Claude Code marker bestaat vóór de browser opent
        fs.writeFileSync(path.join(user, '.claude.json'), JSON.stringify({ mcpServers: {} }));

        proc = await startProcess(vault, { unlock: false, env: { USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData', 'Roaming') } });
        b = await openBrowser();
        await b.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await setupPortal(b.page, proc.portal);

        // Maak tool aan in portaal zodat key bestaat en klik Installeren bij Claude Code
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'kf-kind-mcp').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('testTool');
        await tid(b.page, 't-add').click();
        await tid(b.page, 'mcp-agent-claude-code').waitFor();
        await settled(b.page);
        await tid(b.page, 'mcp-install-claude-code').click();
        await settled(b.page);
        await closeChangedFiles(b.page);
        await tid(b.page, 'key-done').click(); await settled(b.page);

        // Pas nu de entry aan naar een oude versie en oud node-pad
        const cfgPath = path.join(user, '.claude.json');
        const existingConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const serverKey = Object.keys(existingConfig.mcpServers).find(k => k.includes('testTool'));
        existingConfig.mcpServers[serverKey] = {
            ...existingConfig.mcpServers[serverKey],
            command: 'old-node-path.exe',
            env: { VAULTGATE_MCP_VERSION: '0.0.0-old' },
        };
        fs.writeFileSync(cfgPath, JSON.stringify(existingConfig, null, 2));
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given een oude entry in Claude Code When refresh uitgevoerd wordt Then entry bijgewerkt en antwoordt op tools/list', async () => {
        // Roep refresh route aan via API
        const res = await b.page.evaluate(async () => {
            const r = await globalThis.portalFetch('/api/mcp/refresh', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            return { ok: r.ok, status: r.status, text: await r.text() };
        });

        expect(res.status).toBe(200);

        // Lees bijgewerkte claude.json
        const config = JSON.parse(fs.readFileSync(path.join(user, '.claude.json'), 'utf8'));
        const serverKey = Object.keys(config.mcpServers).find(k => k.includes('testTool'));
        const entry = config.mcpServers[serverKey];
        expect(entry.command).toBe(process.execPath);
        expect(entry.args).toEqual(expect.arrayContaining(['mcp', '--name', 'testTool']));
        expect(entry.env.VAULTGATE_MCP_VERSION).not.toBe('0.0.0-old');

        // Test dat de entry start en antwoordt op tools/list
        const list = await toolsList(entry);
        expect(list.result.tools.map(t => t.name)).toContain('http_request');
    }, 30_000);

    it('Given een oude entry When de gebruiker op Bijwerken klikt Then zegt het portaal welk bestand het aanpaste, en een tweede keer: niets veranderd', async () => {
        const cfgPath = path.join(user, '.claude.json');
        const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const serverKey = Object.keys(config.mcpServers).find(k => k.includes('testTool'));
        config.mcpServers[serverKey].command = 'old-node-path.exe';
        fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'kf-kind-mcp').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('second');
        await tid(b.page, 't-add').click();
        await tid(b.page, 'mcp-refresh').waitFor();
        await settled(b.page);
        await tid(b.page, 'mcp-refresh').click(); await settled(b.page);
        const shown = await closeChangedFiles(b.page);
        expect(shown.join(' ')).toContain(cfgPath);
        expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).mcpServers[serverKey].command).toBe(process.execPath);

        await tid(b.page, 'mcp-refresh').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-refresh-status').textContent()).toBe('Everything is up to date; no file changed.');
        expect(await b.page.evaluate(() => globalThis.document.querySelector('[data-testid="ask-dialog"]').open)).toBe(false);
    }, 30_000);
});
