// MCP per map en per agent
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runAgentInstall } from '../../src/mcp/index.js';

let home;
let env;
let projectDir;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'scope-home-'));
    projectDir = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'scope-proj-'));
    env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };
});

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const status = results => Object.fromEntries(results.map(r => [r.id, r.status]));

describe('MCP install-scope: user vs project', () => {
    it('Given project scope voor Claude Code Then schrijft in <map>/.mcp.json onder mcpServers met vaultgate-<toolId>', () => {
        const mcpJson = path.join(projectDir, '.mcp.json');
        fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: { other: { command: 'other-cmd' } } }));

        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'projA',
            env,
        });

        expect(status(results)).toEqual({ 'claude-code': 'installed' });
        expect(fs.existsSync(mcpJson)).toBe(true);
        const data = read(mcpJson);
        expect(data.mcpServers.other).toEqual({ command: 'other-cmd' });
        expect(data.mcpServers['vaultgate-projA']).toBeDefined();
        expect(data.mcpServers['vaultgate-projA'].args).toContain('projA');

        // user config mag niet aangeraakt zijn
        const userClaude = path.join(home, '.claude.json');
        expect(fs.existsSync(userClaude)).toBe(false);
    });

    it('Given project scope voor VS Code Then schrijft in <map>/.vscode/mcp.json onder servers met type: stdio', () => {
        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['vscode'],
            name: 'projVS',
            env,
        });

        expect(status(results)).toEqual({ vscode: 'installed' });
        const vscodeMcp = path.join(projectDir, '.vscode', 'mcp.json');
        expect(fs.existsSync(vscodeMcp)).toBe(true);
        const data = read(vscodeMcp);
        expect(data.servers['vaultgate-projVS']).toBeDefined();
        expect(data.servers['vaultgate-projVS'].type).toBe('stdio');
    });

    it('Given project scope voor Cursor Then schrijft in <map>/.cursor/mcp.json onder mcpServers', () => {
        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['cursor'],
            name: 'projCursor',
            env,
        });

        expect(status(results)).toEqual({ cursor: 'installed' });
        const cursorMcp = path.join(projectDir, '.cursor', 'mcp.json');
        expect(fs.existsSync(cursorMcp)).toBe(true);
        const data = read(cursorMcp);
        expect(data.mcpServers['vaultgate-projCursor']).toBeDefined();
    });

    it('Given project scope voor Gemini CLI Then schrijft in <map>/.gemini/settings.json onder mcpServers', () => {
        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['gemini-cli'],
            name: 'projGemini',
            env,
        });

        expect(status(results)).toEqual({ 'gemini-cli': 'installed' });
        const geminiSettings = path.join(projectDir, '.gemini', 'settings.json');
        expect(fs.existsSync(geminiSettings)).toBe(true);
        const data = read(geminiSettings);
        expect(data.mcpServers['vaultgate-projGemini']).toBeDefined();
    });

    it('Given project scope voor Codex Then status unsupported en niets geschreven', () => {
        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['codex'],
            name: 'projCodex',
            env,
        });

        expect(status(results)).toEqual({ codex: 'unsupported' });
        expect(results[0].reason).toMatch(/no project config/i);
        expect(fs.readdirSync(projectDir)).toHaveLength(0);
    });

    it('Given twee tools in dezelfde agent en dezelfde scope Then twee entries naast elkaar, opnieuw geeft unchanged', () => {
        runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'tool1',
            env,
        });
        const r2 = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'tool2',
            env,
        });
        expect(status(r2)).toEqual({ 'claude-code': 'installed' });

        const data = read(path.join(projectDir, '.mcp.json'));
        expect(data.mcpServers['vaultgate-tool1']).toBeDefined();
        expect(data.mcpServers['vaultgate-tool2']).toBeDefined();

        // Opnieuw dezelfde tool installeren
        const r3 = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'tool2',
            env,
        });
        expect(status(r3)).toEqual({ 'claude-code': 'unchanged' });
    });

    it('Given een bestaande entry "vaultgate" When nieuwe tool install Then gemigreerd naar vaultgate-<id>', () => {
        const mcpJson = path.join(projectDir, '.mcp.json');
        fs.writeFileSync(mcpJson, JSON.stringify({
            mcpServers: {
                vaultgate: { command: process.execPath, args: ['vaultgate.js', 'mcp', '--name', 'legacyTool'] },
            },
        }));

        const results = runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'legacyTool',
            env,
        });

        expect(status(results)).toEqual({ 'claude-code': 'updated' });
        const data = read(mcpJson);
        expect(data.mcpServers.vaultgate).toBeUndefined();
        expect(data.mcpServers['vaultgate-legacyTool']).toBeDefined();
    });

    it('MOET weigeren: targetDir niet bestaand, niet absoluut, systeemmap of vaultHome', () => {
        // Niet bestaand
        const r1 = runAgentInstall({
            scope: 'project',
            targetDir: path.join(projectDir, 'niet-bestaand'),
            ids: ['claude-code'],
            name: 'toolX',
            env,
        });
        expect(status(r1)).toEqual({ 'claude-code': 'error' });
        expect(r1[0].reason).toContain('targetDir');

        // Relatief
        const r2 = runAgentInstall({
            scope: 'project',
            targetDir: 'relatief/pad',
            ids: ['claude-code'],
            name: 'toolX',
            env,
        });
        expect(status(r2)).toEqual({ 'claude-code': 'error' });

        // C:\Windows
        const r3 = runAgentInstall({
            scope: 'project',
            targetDir: 'C:\\Windows',
            ids: ['claude-code'],
            name: 'toolX',
            env,
        });
        expect(status(r3)).toEqual({ 'claude-code': 'error' });

        // vaultHome
        const r4 = runAgentInstall({
            scope: 'project',
            targetDir: home,
            vaultHome: home,
            ids: ['claude-code'],
            name: 'toolX',
            env,
        });
        expect(status(r4)).toEqual({ 'claude-code': 'error' });
    });

    it('When uninstall van specifieke tool in project scope Then entry verwijderd, rest blijft byte-gelijk', () => {
        const mcpJson = path.join(projectDir, '.mcp.json');
        fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: { other: { command: 'other' } } }, null, 2) + '\n');
        const originalContent = fs.readFileSync(mcpJson, 'utf8');

        runAgentInstall({
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'myTool',
            env,
        });

        const uninst = runAgentInstall({
            action: 'uninstall',
            scope: 'project',
            targetDir: projectDir,
            ids: ['claude-code'],
            name: 'myTool',
            env,
        });
        expect(status(uninst)).toEqual({ 'claude-code': 'removed' });
        expect(fs.readFileSync(mcpJson, 'utf8')).toBe(originalContent);
    });
});
