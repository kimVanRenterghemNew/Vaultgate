// De MCP-entry in de config van elke agent op de machine (het portaal roept het aan), zoals lady-lens `lens install`.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { agentTargets, runAgentInstall, renameMcpTool, runSkillAndPolicyInstall, skillTargets } from '../../src/mcp/index.js';

let home;
let env;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'agents-'));
    env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };
});

const run = (extra = {}) => runAgentInstall({ name: 'agent', env, ...extra });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const target = id => agentTargets(env).find(t => t.id === id);
const status = results => Object.fromEntries(results.map(r => [r.id, r.status]));

describe('vaultgate install: MCP-entry per agent', () => {
    it('Given Claude Code met een andere server When install Then vaultgate erbij, de andere blijft, met back-up', () => {
        const file = target('claude-code').file;
        fs.writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));

        expect(status(run())).toEqual({ 'claude-code': 'installed' });

        const data = read(file);
        expect(data.theme).toBe('dark');
        expect(data.mcpServers.other).toEqual({ command: 'x' });
        expect(data.mcpServers['vaultgate-agent'].command).toBe(process.execPath);
        expect(data.mcpServers['vaultgate-agent'].args.slice(1)).toEqual(['mcp', '--name', 'agent']);
        expect(path.basename(data.mcpServers['vaultgate-agent'].args[0])).toBe('vaultgate.js');
        expect(fs.existsSync(data.mcpServers['vaultgate-agent'].args[0])).toBe(true);
        expect(fs.existsSync(`${file}.vaultgate.bak`)).toBe(true);
    });

    it('nooit een key in de entry: alleen --name, en --home als die gegeven is', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        run({ vaultHome: 'D:/kluis' });
        const entry = read(target('cursor').file).mcpServers['vaultgate-agent'];
        expect(entry.args.slice(1)).toEqual(['mcp', '--name', 'agent', '--home', 'D:/kluis']);
        expect(JSON.stringify(entry)).not.toMatch(/--key|TOOL_KEY/);
    });

    it('Given een geïnstalleerde entry When install, uninstall, uninstall Then unchanged, removed, absent', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        run();
        expect(status(run())).toEqual({ cursor: 'unchanged' });
        expect(status(run({ action: 'uninstall' }))).toEqual({ cursor: 'removed' });
        expect(read(target('cursor').file).mcpServers).toEqual({});
        expect(status(run({ action: 'uninstall' }))).toEqual({ cursor: 'absent' });
    });

    it('Given een config met commentaar When install Then error en het bestand blijft byte-gelijk', () => {
        const file = target('claude-code').file;
        const text = '{ // mijn instellingen\n "mcpServers": {} }';
        fs.writeFileSync(file, text);
        const [result] = run();
        expect(result.status).toBe('error');
        expect(fs.readFileSync(file, 'utf8')).toBe(text);
    });

    it('zonder namen alleen agents op de machine; met een naam altijd; onbekende naam is een fout met de lijst', () => {
        expect(run()).toEqual([]);

        const named = run({ ids: ['cursor', 'foo'] });
        expect(status(named)).toEqual({ foo: 'error', cursor: 'installed' });
        expect(named[0].reason).toContain('claude-code');
        expect(fs.existsSync(target('cursor').file)).toBe(true);
    });

    it('VS Code krijgt servers + type stdio', () => {
        run({ ids: ['vscode'] });
        const data = read(target('vscode').file);
        expect(data.servers['vaultgate-agent'].type).toBe('stdio');
        expect(data.mcpServers).toBeUndefined();
    });

    it('--dry-run schrijft niets', () => {
        const results = run({ ids: ['cursor'], dryRun: true });
        expect(status(results)).toEqual({ cursor: 'installed' });
        expect(fs.existsSync(target('cursor').file)).toBe(false);
    });

    it('--proxy komt in de entry als het proxy-adres gegeven is', () => {
        run({ ids: ['cursor'], proxy: 'http://127.0.0.1:9999' });
        expect(read(target('cursor').file).mcpServers['vaultgate-agent'].args.slice(-2)).toEqual(['--proxy', 'http://127.0.0.1:9999']);
    });
});

describe('vaultgate install: TOML (Codex, Mistral Vibe)', () => {
    it('Given een eigen config.toml When install en uninstall Then een gemarkeerd blok, daarna byte-gelijk', () => {
        const file = target('codex').file;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const mine = 'model = "o3"\r\n';
        fs.writeFileSync(file, mine);

        expect(status(run())).toEqual({ codex: 'installed' });
        const text = fs.readFileSync(file, 'utf8');
        expect(text).toContain('[mcp_servers.vaultgate]  # vaultgate:mcp');
        expect(text).toMatch(/^args = \[.*"mcp","--name","agent"] {2}# vaultgate:mcp$/m);
        expect(status(run())).toEqual({ codex: 'unchanged' });

        expect(status(run({ action: 'uninstall' }))).toEqual({ codex: 'removed' });
        expect(fs.readFileSync(file, 'utf8')).toBe(mine);
    });

    it('Vibe krijgt een [[mcp_servers]]-blok met name en transport', () => {
        run({ ids: ['vibe'] });
        const text = fs.readFileSync(target('vibe').file, 'utf8');
        expect(text).toContain('[[mcp_servers]]  # vaultgate:mcp');
        expect(text).toContain('transport = "stdio"  # vaultgate:mcp');
    });

    it('een entry met de hand geschreven blijft staan: error, niets gewijzigd', () => {
        const file = target('codex').file;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const mine = '[mcp_servers.vaultgate]\ncommand = "vaultgate"\n';
        fs.writeFileSync(file, mine);
        expect(status(run())).toEqual({ codex: 'error' });
        expect(fs.readFileSync(file, 'utf8')).toBe(mine);
    });

    it('renameMcpTool past agent-configs aan en neemt het sleutelbestand mee', () => {
        const file = target('claude-code').file;
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
        run({ name: 'agent-old' });

        const vaultHome = path.join(home, 'vault');
        const clientsDir = path.join(vaultHome, 'clients');
        fs.mkdirSync(clientsDir, { recursive: true });
        fs.writeFileSync(path.join(clientsDir, 'agent-old.key'), 'test-protected-key\n');

        renameMcpTool({ oldName: 'agent-old', newName: 'agent-new', vaultHome, env });

        // Agent-config is bijgewerkt
        const cfg = read(file);
        expect(cfg.mcpServers['vaultgate-agent-new'].args).toContain('agent-new');
        expect(cfg.mcpServers['vaultgate-agent-new'].args).not.toContain('agent-old');
        expect(cfg.mcpServers['vaultgate-agent-old']).toBeUndefined();
        expect(cfg.mcpServers.other).toEqual({ command: 'x' });

        // Sleutelbestand staat ook onder de nieuwe naam
        expect(fs.existsSync(path.join(clientsDir, 'agent-new.key'))).toBe(true);
        expect(fs.readFileSync(path.join(clientsDir, 'agent-new.key'), 'utf8')).toBe('test-protected-key\n');
    });

    const CLAUDE_FILE = 'CLAUDE' + '.md';

    it('Given ~/.claude bestaat met een eigen policybestand, ~/.copilot niet When install skill en daarna uninstall Then eerst SKILL.md en mark-regel, niets voor Copilot; daarna bestand byte-gelijk', () => {
        const claudeDir = path.join(home, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const claudeMd = path.join(claudeDir, CLAUDE_FILE);
        const originalContent = '# Mijn Project Regels\n\n- Eerste regel\n- Tweede regel\n';
        fs.writeFileSync(claudeMd, originalContent);

        // Install
        const installResults = runSkillAndPolicyInstall({ action: 'install', env });
        const pClaude = installResults.find(r => r.type === 'policy' && r.id === 'claude');
        const sClaude = installResults.find(r => r.type === 'skill' && r.id === 'claude');
        const pCopilot = installResults.find(r => r.id === 'copilot');

        expect(pClaude?.status).toBe('installed');
        expect(sClaude?.status).toBe('installed');
        expect(pCopilot).toBeUndefined(); // Copilot bestond niet

        // Bestanden staan er
        const skillFile = skillTargets(env).find(t => t.id === 'claude').file;
        expect(fs.existsSync(skillFile)).toBe(true);
        expect(fs.readFileSync(skillFile, 'utf8')).toContain('## Beschikbare MCP-Tools');

        const claudeAfterInstall = fs.readFileSync(claudeMd, 'utf8');
        expect(claudeAfterInstall).toContain('<!-- vaultgate -->');
        expect(claudeAfterInstall).toContain('@');

        // Uninstall
        const uninstallResults = runSkillAndPolicyInstall({ action: 'uninstall', env });
        const unPClaude = uninstallResults.find(r => r.type === 'policy' && r.id === 'claude');
        const unSClaude = uninstallResults.find(r => r.type === 'skill' && r.id === 'claude');

        expect(unPClaude?.status).toBe('removed');
        expect(unSClaude?.status).toBe('removed');
        expect(fs.existsSync(skillFile)).toBe(false);

        // Bestand is exact byte-voor-byte gelijk aan voor de installatie!
        expect(fs.readFileSync(claudeMd, 'utf8')).toBe(originalContent);
    });

    it('Given een leeg policybestand dat door install is aangemaakt When uninstall Then is het bestand verwijderd', () => {
        const claudeDir = path.join(home, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const claudeMd = path.join(claudeDir, CLAUDE_FILE);

        // Geen bestaand bestand
        runSkillAndPolicyInstall({ action: 'install', env });
        expect(fs.existsSync(claudeMd)).toBe(true);

        runSkillAndPolicyInstall({ action: 'uninstall', env });
        expect(fs.existsSync(claudeMd)).toBe(false);
    });
});
