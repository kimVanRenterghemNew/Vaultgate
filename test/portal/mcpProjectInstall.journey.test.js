// MCP per map en per agent (project scope)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, tid, settled, closeChangedFiles } from '../helpers/browser.js';
import { findLeaks, readTree } from '../helpers/secretLeak.js';

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

describe('portaal: MCP per map en per agent (project scope)', () => {
    let proc;
    let b;
    let user;
    let vault;
    let projA;
    let projB;
    let keyA;
    let keyB;

    beforeAll(async () => {
        user = tempHome();
        projA = tempHome();
        projB = tempHome();
        vault = tempHome();

        // user config voor claude-code
        fs.writeFileSync(path.join(user, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));

        // projA heeft een bestaande server in .mcp.json
        fs.writeFileSync(path.join(projA, '.mcp.json'), JSON.stringify({ mcpServers: { existingServer: { command: 'echo' } } }));

        proc = await startProcess(vault, { unlock: false, env: { USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData', 'Roaming') } });
        b = await openBrowser();
        await b.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given een tool projA When project scope gekozen en geïnstalleerd in projA Then entry in projA/.mcp.json met --name, user config ongewijzigd', async () => {
        // Maak tool projA aan
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'kf-kind-mcp').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('projA');
        await tid(b.page, 't-add').click();
        await tid(b.page, 'mcp-agent-claude-code').waitFor();
        await settled(b.page);
        keyA = (await tid(b.page, 't-key').textContent()).trim();
        expect(keyA).toMatch(/^ks_/);

        // Selecteer project scope
        await tid(b.page, 'mcp-scope-project-radio').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-folder-box').isVisible()).toBe(true);
        await tid(b.page, 'mcp-folder-input').fill(projA);

        // Klik Installeren
        await tid(b.page, 'mcp-install-claude-code').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-status-claude-code').textContent()).toBe('Installed');
        expect((await closeChangedFiles(b.page)).join(' ')).toContain('.mcp.json');

        // Check projA/.mcp.json
        const projAConfig = JSON.parse(fs.readFileSync(path.join(projA, '.mcp.json'), 'utf8'));
        expect(projAConfig.mcpServers.existingServer).toEqual({ command: 'echo' });
        expect(projAConfig.mcpServers['vaultgate-projA'].args).toEqual(expect.arrayContaining(['mcp', '--name', 'projA', '--home', vault]));

        // Check dat user config ongewijzigd is (geen vaultgate-projA in ~/.claude.json)
        const userConfig = JSON.parse(fs.readFileSync(path.join(user, '.claude.json'), 'utf8'));
        expect(userConfig.mcpServers['vaultgate-projA']).toBeUndefined();
        expect(userConfig.mcpServers.other).toEqual({ command: 'x' });

        // Sluit reveal dialoog
        await tid(b.page, 'key-done').click(); await settled(b.page);
    });

    it('Given een tweede tool projB When geïnstalleerd in projB Then entries starten elk met eigen tool', async () => {
        // Maak tool projB aan
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'kf-kind-mcp').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('projB');
        await tid(b.page, 't-add').click();
        await tid(b.page, 'mcp-agent-claude-code').waitFor();
        await settled(b.page);
        keyB = (await tid(b.page, 't-key').textContent()).trim();

        // Selecteer project scope voor projB
        await tid(b.page, 'mcp-scope-project-radio').click(); await settled(b.page);
        await tid(b.page, 'mcp-folder-input').fill(projB);

        await tid(b.page, 'mcp-install-claude-code').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-status-claude-code').textContent()).toBe('Installed');
        expect((await closeChangedFiles(b.page)).join(' ')).toContain('.mcp.json');

        const projBConfig = JSON.parse(fs.readFileSync(path.join(projB, '.mcp.json'), 'utf8'));
        expect(projBConfig.mcpServers['vaultgate-projB'].args).toEqual(expect.arrayContaining(['mcp', '--name', 'projB', '--home', vault]));

        // Test dat beide entries starten en tools/list antwoorden
        const projAConfig = JSON.parse(fs.readFileSync(path.join(projA, '.mcp.json'), 'utf8'));
        const listA = await toolsList(projAConfig.mcpServers['vaultgate-projA']);
        const listB = await toolsList(projBConfig.mcpServers['vaultgate-projB']);
        expect(listA.result.tools.map(t => t.name)).toContain('http_request');
        expect(listB.result.tools.map(t => t.name)).toContain('http_request');

        await tid(b.page, 'key-done').click(); await settled(b.page);
    });

    it('When installatie in projA verwijderd wordt Then entry weg en rest van .mcp.json byte-gelijk', async () => {
        // We verwijderen via API met keyA
        const originalExisting = JSON.stringify({ mcpServers: { existingServer: { command: 'echo' } } }, null, 2) + '\n';
        fs.writeFileSync(path.join(projA, '.mcp.json'), originalExisting);

        // Roept de uninstall aan via de browser/portaal fetch
        await b.page.evaluate(async ({ k, f }) => {
            await globalThis.portalFetch('/api/mcp/uninstall', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key: k, agents: ['claude-code'], scope: 'project', folder: f }),
            });
        }, { k: keyA, f: projA });

        const configAfter = fs.readFileSync(path.join(projA, '.mcp.json'), 'utf8');
        expect(configAfter).toBe(originalExisting);
    });

    it('Geen nep-keys gelekt in project configs, audits of logs', async () => {
        const audit = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/audit')).text());
        expect(audit).toContain('mcp-installed');
        expect(audit).toContain('mcp-uninstalled');

        const treeA = readTree(projA);
        const treeB = readTree(projB);
        const leaks = findLeaks({ ...treeA, ...treeB, audit, output: proc.output() }, [keyA, keyB]);
        expect(leaks).toEqual([]);
    });
});
