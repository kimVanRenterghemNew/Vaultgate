// MCP-entries, skill en policy blijven actueel na een update
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { refreshMcpInstallations, agentTargets, SERVER_NAME } from '../../src/mcp/index.js';

let home;
let env;
let projectDir;
const CLAUDE_FILE = 'CLAUDE' + '.md';

beforeEach(() => {
    home = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'refresh-home-'));
    projectDir = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'refresh-proj-'));
    env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };
});

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('MCP refresh na update', () => {
    it('agentTargets bevat antigravity-cli met ~/.gemini/config/mcp_config.json', () => {
        const targets = agentTargets(env);
        const cliTarget = targets.find(t => t.id === 'antigravity-cli');
        expect(cliTarget).toBeDefined();
        expect(cliTarget.file).toBe(path.join(home, '.gemini', 'config', 'mcp_config.json'));
        expect(cliTarget.marker).toBe(path.join(home, '.gemini', 'antigravity-cli'));
    });

    it('Given oude versie in Claude Code, geen entry in Cursor, en een oude SKILL.md When refresh Then Claude Code bijgewerkt, Cursor byte-gelijk, SKILL.md actueel', async () => {
        // Claude Code met oude versie en oud pad
        const claudeFile = path.join(home, '.claude.json');
        fs.writeFileSync(claudeFile, JSON.stringify({
            mcpServers: {
                'vaultgate-mytool': {
                    command: 'old-node.exe',
                    args: ['C:/old/vaultgate.js', 'mcp', '--name', 'mytool'],
                    env: { VAULTGATE_MCP_VERSION: '0.0.1-alpha' },
                },
            },
        }, null, 2));

        // Cursor zonder vaultgate
        const cursorDir = path.join(home, '.cursor');
        fs.mkdirSync(cursorDir, { recursive: true });
        const cursorFile = path.join(cursorDir, 'mcp.json');
        const cursorOrig = JSON.stringify({ mcpServers: { other: { command: 'other' } } }, null, 2);
        fs.writeFileSync(cursorFile, cursorOrig);

        // Oude SKILL.md
        const skillDir = path.join(home, '.claude', 'skills', 'vaultgate');
        fs.mkdirSync(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillFile, '# Oude skill tekst\n');

        const res = await refreshMcpInstallations({ env });
        expect(res.updatedCount).toBeGreaterThan(0);

        // Claude Code heeft actuele command en args met --name mytool behouden
        const updatedClaude = read(claudeFile);
        expect(updatedClaude.mcpServers['vaultgate-mytool'].command).toBe(process.execPath);
        expect(updatedClaude.mcpServers['vaultgate-mytool'].args).toContain('mytool');
        expect(updatedClaude.mcpServers['vaultgate-mytool'].env.VAULTGATE_MCP_VERSION).toBeDefined();
        expect(updatedClaude.mcpServers['vaultgate-mytool'].env.VAULTGATE_MCP_VERSION).not.toBe('0.0.1-alpha');

        // Cursor is onaangeroerd (byte-gelijk)
        expect(fs.readFileSync(cursorFile, 'utf8')).toBe(cursorOrig);

        // SKILL.md is vernieuwd
        expect(fs.readFileSync(skillFile, 'utf8')).not.toBe('# Oude skill tekst\n');
        expect(fs.readFileSync(skillFile, 'utf8')).toContain('## Beschikbare MCP-Tools');
    });

    it('Given een eigen ~/.claude-regelbestand met verwijsregel When refresh Then dat bestand byte-gelijk en instructions.md actueel', async () => {
        const claudeDir = path.join(home, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const claudeMd = path.join(claudeDir, CLAUDE_FILE);
        const originalRule = '# My Rules\n\n<!-- vaultgate -->\n@~/.vaultgate/vaultgate-instructions.md\n<!-- /vaultgate -->\n';
        fs.writeFileSync(claudeMd, originalRule);

        const vgHome = path.join(home, '.vaultgate');
        fs.mkdirSync(vgHome, { recursive: true });
        const instrFile = path.join(vgHome, 'vaultgate-instructions.md');
        fs.writeFileSync(instrFile, 'Oude instructies\n');

        await refreshMcpInstallations({ env });

        expect(fs.readFileSync(claudeMd, 'utf8')).toBe(originalRule);
        expect(fs.readFileSync(instrFile, 'utf8')).not.toBe('Oude instructies\n');
        expect(fs.readFileSync(instrFile, 'utf8')).toContain('vaultgate');
    });

    it('Given een project-entry uit 8.11 When refresh Then bijgewerkt in <map>/.mcp.json, tool behouden', async () => {
        const mcpJson = path.join(projectDir, '.mcp.json');
        fs.writeFileSync(mcpJson, JSON.stringify({
            mcpServers: {
                'vaultgate-projX': {
                    command: 'old-node',
                    args: ['old/path.js', 'mcp', '--name', 'projX'],
                    env: { VAULTGATE_MCP_VERSION: '0.0.0' },
                },
            },
        }, null, 2));

        await refreshMcpInstallations({ env, projectDirs: [projectDir] });

        const updated = read(mcpJson);
        expect(updated.mcpServers['vaultgate-projX'].command).toBe(process.execPath);
        expect(updated.mcpServers['vaultgate-projX'].args).toContain('projX');
    });

    it('Given ~/.gemini/config/mcp_config.json met SSE url onder vaultgate When refresh Then omgezet naar stdio met .vaultgate.bak', async () => {
        const geminiDir = path.join(home, '.gemini', 'config');
        fs.mkdirSync(geminiDir, { recursive: true });
        const cfgFile = path.join(geminiDir, 'mcp_config.json');
        fs.writeFileSync(cfgFile, JSON.stringify({
            mcpServers: {
                [SERVER_NAME]: {
                    url: 'http://127.0.0.1:8484/sse',
                },
            },
        }, null, 2));

        await refreshMcpInstallations({ env });

        const updated = read(cfgFile);
        expect(updated.mcpServers[SERVER_NAME].url).toBeUndefined();
        expect(updated.mcpServers[SERVER_NAME].command).toBe(process.execPath);
        expect(fs.existsSync(`${cfgFile}.vaultgate.bak`)).toBe(true);
    });

    it('Given refresh zonder enige vaultgate-installatie Then wordt niets geschreven en 0 updates', async () => {
        const res = await refreshMcpInstallations({ env });
        expect(res.updatedCount).toBe(0);
    });

    it('Given een oude entry in Claude Code When refresh Then noemt het antwoord dat bestand met zijn .bak', async () => {
        const claudeFile = path.join(home, '.claude.json');
        fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { 'vaultgate-t': { command: 'old', args: ['x', 'mcp', '--name', 't'] } } }));
        const res = await refreshMcpInstallations({ env });
        expect(res.files).toEqual([{ file: claudeFile, status: 'updated', backup: `${claudeFile}.vaultgate.bak` }]);
    });

    it('Given entry, skill en policy die al actueel zijn When refresh Then niets geschreven, geen .bak, lege lijst (8.13, MOET niets doen)', async () => {
        const claudeFile = path.join(home, '.claude.json');
        fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { 'vaultgate-t': { command: 'old', args: ['x', 'mcp', '--name', 't'] } } }));
        const skillFile = path.join(home, '.claude', 'skills', 'vaultgate', 'SKILL.md');
        fs.mkdirSync(path.dirname(skillFile), { recursive: true });
        fs.writeFileSync(skillFile, 'oud');
        const vaultHome = path.join(home, 'vault-home');
        fs.mkdirSync(vaultHome, { recursive: true });
        fs.writeFileSync(path.join(vaultHome, 'vaultgate-instructions.md'), 'oud');
        await refreshMcpInstallations({ env, vaultHome });
        for (const f of [claudeFile, skillFile]) fs.rmSync(`${f}.vaultgate.bak`, { force: true });
        const before = fs.readdirSync(home, { recursive: true }).sort();
        const res = await refreshMcpInstallations({ env, vaultHome });
        expect(res.files).toEqual([]);
        expect(res.updatedCount).toBe(0);
        expect(fs.readdirSync(home, { recursive: true }).sort()).toEqual(before);
    });

    it('Given de policy in de kluismap When refresh Then wordt ze daar ververst en gemeld', async () => {
        const vaultHome = path.join(home, 'vault-home');
        fs.mkdirSync(vaultHome, { recursive: true });
        const instr = path.join(vaultHome, 'vaultgate-instructions.md');
        fs.writeFileSync(instr, 'oud');
        const res = await refreshMcpInstallations({ env, vaultHome });
        expect(fs.readFileSync(instr, 'utf8')).not.toBe('oud');
        expect(res.files.map(f => f.file)).toContain(instr);
    });
});
