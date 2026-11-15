// Na een nieuwe MCP-key toont het portaal de agents op deze pc; "Installeren" zet de vaultgate-MCP in die
// agent, "JSON kopiëren" geeft de entry. Nergens de key: niet in de agent-config, niet op het scherm, niet in de audit.
// Alleen als echt proces met een eigen gebruikersmap (USERPROFILE/HOME/APPDATA): in-process zou de echte agent-configs
// van de ontwikkelaar raken.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startProcess } from '../helpers/journey.js';
import { openBrowser, setupPortal, screenshot, tid, settled, closeChangedFiles } from '../helpers/browser.js';
import { findLeaks, readTree } from '../helpers/secretLeak.js';

/** Start de entry zoals een agent dat doet; geeft het antwoord op tools/list. */
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

describe('portaal: MCP installeren of de JSON kopiëren', () => {
    let proc;
    let b;
    let user;
    let vault;
    let key;

    const CLAUDE_FILE = 'CLAUDE' + '.md';

    beforeAll(async () => {
        user = tempHome();
        fs.writeFileSync(path.join(user, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
        fs.mkdirSync(path.join(user, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(user, '.claude', CLAUDE_FILE), '# Claude Rules\n');
        vault = tempHome();
        proc = await startProcess(vault, { unlock: false, env: { USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData', 'Roaming') } });
        b = await openBrowser();
        await b.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await setupPortal(b.page, proc.portal);
    }, 60_000);

    afterAll(async () => {
        await b?.close();
        await proc?.stop();
    });

    it('Given een nieuwe MCP-key When de stap verschijnt Then de agents op deze pc, geen key op het scherm', async () => {
        await tid(b.page, 'tab-tools').click(); await settled(b.page);
        await tid(b.page, 'tools-create').click(); await settled(b.page);
        await tid(b.page, 'kf-kind-mcp').click(); await settled(b.page);
        await tid(b.page, 't-name').fill('agent');
        await tid(b.page, 't-add').click();
        await tid(b.page, 'mcp-agent-claude-code').waitFor();
        await settled(b.page);
        key = (await tid(b.page, 't-key').textContent()).trim();
        expect(key).toMatch(/^ks_/);
        expect(await tid(b.page, 't-key-box').isVisible()).toBe(false);
        expect(await tid(b.page, 'mcp-agent-cursor').count()).toBe(0); // niet op deze pc
        await screenshot(b.page, 'portaal-8b-mcp-installeren');
    });

    it('When Installeren bij Claude Code Then een werkende entry met --name, de andere server blijft, en het portaal zegt welk bestand het aanpaste', async () => {
        await tid(b.page, 'mcp-install-claude-code').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-status-claude-code').textContent()).toBe('Installed');
        const shown = await closeChangedFiles(b.page, { shot: 'portaal-8b-mcp-bestanden-aangepast' });
        expect(shown).toHaveLength(1);
        expect(shown[0]).toContain(path.join(user, '.claude.json'));
        expect(shown[0]).toContain('.claude.json.vaultgate.bak');
        expect(await tid(b.page, 'mcp-installation-item').first().textContent()).toContain('.claude.json');
        await screenshot(b.page, 'portaal-8b-mcp-geinstalleerd');

        const config = JSON.parse(fs.readFileSync(path.join(user, '.claude.json'), 'utf8'));
        expect(config.mcpServers.other).toEqual({ command: 'x' });
        expect(config.mcpServers['vaultgate-agent'].args).toEqual(expect.arrayContaining(['mcp', '--name', 'agent', '--home', vault]));
        const list = await toolsList(config.mcpServers['vaultgate-agent']);
        expect(list.result.tools.map(tool => tool.name)).toContain('http_request');
    }, 30_000);

    it('When JSON kopiëren Then het klembord heeft de entry met --name, zonder key', async () => {
        await tid(b.page, 'mcp-copy-json').click(); await settled(b.page);
        const copied = JSON.parse(await b.page.evaluate(() => globalThis.navigator.clipboard.readText()));
        expect(copied.mcpServers['vaultgate-agent'].args).toContain('--name');
        expect(JSON.stringify(copied)).not.toContain(key);
    });

    it('When VS Code-JSON kopiëren Then geldige JSON met servers.vaultgate.type = stdio, geen key', async () => {
        await tid(b.page, 'mcp-copy-json-vscode').click(); await settled(b.page);
        const copied = JSON.parse(await b.page.evaluate(() => globalThis.navigator.clipboard.readText()));
        expect(copied.servers['vaultgate-agent'].type).toBe('stdio');
        expect(copied.servers['vaultgate-agent'].args).toContain('--name');
        expect(findLeaks(copied, [key])).toEqual([]);
    });

    it('Given een geïnstalleerde agent When de tool hernoemd wordt Then start de entry nog en geeft tools/list', async () => {
        await b.page.evaluate(async () => {
            const tools = await (await globalThis.portalFetch('/api/tools')).json();
            const tool = tools.find(t => t.name === 'agent');
            await globalThis.portalFetch(`/api/tools/${tool.id}/name`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'agent-renamed' }),
            });
        });

        const config = JSON.parse(fs.readFileSync(path.join(user, '.claude.json'), 'utf8'));
        expect(config.mcpServers['vaultgate-agent-renamed'].args).toContain('agent-renamed');

        const list = await toolsList(config.mcpServers['vaultgate-agent-renamed']);
        expect(list.result.tools.map(tool => tool.name)).toContain('http_request');
    }, 30_000);

    it('When Verwijderen bij Claude Code Then is de entry weg, de rest van de config onaangeroerd', async () => {
        await b.page.evaluate(async (toolKey) => {
            await globalThis.portalFetch('/api/mcp/uninstall', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key: toolKey, agents: ['claude-code'] }),
            });
        }, key);

        const config = JSON.parse(fs.readFileSync(path.join(user, '.claude.json'), 'utf8'));
        expect(config.mcpServers.other).toEqual({ command: 'x' });
        expect(config.mcpServers.vaultgate).toBeUndefined();
    });

    it('When Skill installeren geklikt wordt Then staat SKILL.md in ~/.claude/skills en policy in het Claude-bestand, en bij verwijderen weer weg', async () => {
        await tid(b.page, 'mcp-skill-install').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-skill-status').textContent()).toBe('Installed');
        const shown = (await closeChangedFiles(b.page)).join(' ');
        expect(shown).toContain(path.join(user, '.claude', 'skills', 'vaultgate', 'SKILL.md'));
        expect(shown).toContain(path.join(user, '.claude', CLAUDE_FILE));
        const skillPath = path.join(user, '.claude', 'skills', 'vaultgate', 'SKILL.md');
        expect(fs.existsSync(skillPath)).toBe(true);
        expect(fs.readFileSync(path.join(user, '.claude', CLAUDE_FILE), 'utf8')).toContain('<!-- vaultgate -->');

        await tid(b.page, 'mcp-skill-uninstall').click(); await settled(b.page);
        expect(await tid(b.page, 'mcp-skill-status').textContent()).toBe('Removed');
        expect((await closeChangedFiles(b.page)).join(' ')).toContain(path.join(user, '.claude', CLAUDE_FILE));
        expect(fs.existsSync(skillPath)).toBe(false);
        expect(fs.readFileSync(path.join(user, '.claude', CLAUDE_FILE), 'utf8')).toBe('# Claude Rules\n');
    });

    it('nergens de key: agent-configs, schermtekst na Got it, audit en procesuitvoer', async () => {
        await tid(b.page, 'key-done').click(); await settled(b.page);
        const audit = await b.page.evaluate(async () => (await globalThis.portalFetch('/api/audit')).text());
        expect(audit).toContain('mcp-installed');
        expect(audit).toContain('mcp-uninstalled');
        const configs = readTree(user);
        expect(findLeaks({ ...configs, page: await b.page.content(), audit, output: proc.output() }, [key])).toEqual([]);
    });
});
