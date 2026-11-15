/**
 * Zet de vaultgate-MCP-server in de config van coding agents op deze machine.
 * Ondersteunt user-scope en project-scope.
 *
 * @module mcp/install
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tomlInstall, tomlUninstall } from './install-toml.js';
import { validateTargetDir, projectAgentTarget } from './install-scope.js';

export const SERVER_NAME = 'vaultgate';
export { validateTargetDir, projectAgentTarget };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'bin', 'vaultgate.js');

export function packageVersion() {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return null; }
}

export function agentTargets({ home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {}) {
    const appSupport = (app, ...rest) => (platform === 'win32'
        ? path.join(appData || path.join(home, 'AppData', 'Roaming'), app, ...rest)
        : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', app, ...rest) : path.join(home, '.config', app, ...rest));
    const target = (id, label, marker, file, extra = {}) => ({ id, label, marker, file, key: 'mcpServers', typed: false, ...extra });
    return [
        target('claude-code', 'Claude Code', path.join(home, '.claude.json'), path.join(home, '.claude.json')),
        target('claude-desktop', 'Claude Desktop', appSupport('Claude'), appSupport('Claude', 'claude_desktop_config.json')),
        target('cursor', 'Cursor', path.join(home, '.cursor'), path.join(home, '.cursor', 'mcp.json')),
        target('windsurf', 'Windsurf', path.join(home, '.codeium', 'windsurf'), path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
        target('gemini-cli', 'Gemini CLI', path.join(home, '.gemini', 'settings.json'), path.join(home, '.gemini', 'settings.json')),
        target('antigravity', 'Antigravity', path.join(home, '.gemini', 'antigravity'), path.join(home, '.gemini', 'antigravity', 'mcp_config.json')),
        target('antigravity-cli', 'Antigravity CLI', path.join(home, '.gemini', 'antigravity-cli'), path.join(home, '.gemini', 'config', 'mcp_config.json')),
        target('vscode', 'VS Code', appSupport('Code', 'User'), appSupport('Code', 'User', 'mcp.json'), { key: 'servers', typed: true }),
        target('codex', 'Codex', path.join(home, '.codex'), path.join(home, '.codex', 'config.toml'), { toml: 'codex' }),
        target('vibe', 'Mistral Vibe', path.join(home, '.vibe'), path.join(home, '.vibe', 'config.toml'), { toml: 'vibe' }),
    ];
}

export function mcpEntry({ name, vaultHome = null, proxy = null, typed = false }) {
    const version = packageVersion();
    return {
        ...(typed ? { type: 'stdio' } : {}),
        command: process.execPath,
        args: [BIN, 'mcp', '--name', name, ...(vaultHome ? ['--home', vaultHome] : []), ...(proxy ? ['--proxy', proxy] : [])],
        ...(version ? { env: { VAULTGATE_MCP_VERSION: version } } : {}),
    };
}

function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.vaultgate.bak`);
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
}

function readConfig(file) {
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? JSON.parse(text) : {};
}

function entryKey(name) {
    return name ? `vaultgate-${name}` : SERVER_NAME;
}

function update(target, serverKey, dryRun, change) {
    let data;
    try { data = readConfig(target.file); } catch (error) { return { status: 'error', reason: `cannot parse (comments?): ${error.message}` }; }
    const servers = { ...(data[target.key] || {}) };
    const before = JSON.stringify(servers[serverKey]);
    const hadLegacy = Boolean(servers[SERVER_NAME]);
    const status = change(servers, servers[serverKey]);
    if (JSON.stringify(servers[serverKey]) === before && !hadLegacy) {
        return { status: before === undefined ? 'absent' : 'unchanged' };
    }
    if (!dryRun) write(target.file, `${JSON.stringify({ ...data, [target.key]: servers }, null, 2)}\n`);
    return { status };
}

const jsonInstall = (target, serverKey, entry, dryRun) => update(target, serverKey, dryRun, (servers, before) => {
    let hadLegacy = false;
    if (servers[SERVER_NAME]) {
        delete servers[SERVER_NAME];
        hadLegacy = true;
    }
    servers[serverKey] = entry;
    if (before === undefined) return hadLegacy ? 'updated' : 'installed';
    return 'updated';
});

const jsonUninstall = (target, serverKey, dryRun) => update(target, serverKey, dryRun, servers => {
    delete servers[serverKey];
    delete servers[SERVER_NAME];
    return 'removed';
});

function apply(target, serverKey, { action, name, vaultHome, proxy, dryRun }) {
    if (target.toml) {
        return action === 'uninstall' ? tomlUninstall(target, dryRun, write) : tomlInstall(target, mcpEntry({ name, vaultHome, proxy }), dryRun, write);
    }
    return action === 'uninstall' ? jsonUninstall(target, serverKey, dryRun) : jsonInstall(target, serverKey, mcpEntry({ name, vaultHome, proxy, typed: target.typed }), dryRun);
}

export function runAgentInstall({
    action = 'install',
    scope = 'user',
    targetDir = null,
    ids = [],
    name,
    vaultHome = null,
    proxy = null,
    dryRun = false,
    env = {},
}) {
    const all = agentTargets(env);
    const explicit = ids.length > 0 && !ids.includes('all');
    const unknown = explicit ? ids.filter(id => !all.some(target => target.id === id)) : [];
    const known = all.map(target => target.id).join(', ');

    if (scope === 'project') {
        const validation = validateTargetDir(targetDir, vaultHome);
        if (!validation.valid) {
            const targetsToFail = explicit ? ids : ['project'];
            return targetsToFail.map(id => ({ id, label: id, file: '', status: 'error', reason: validation.reason }));
        }
        const resolvedDir = validation.path;
        const serverKey = entryKey(name);
        const wantedIds = explicit ? ids : all.map(t => t.id);

        return [
            ...unknown.map(id => ({ id, label: id, file: '', status: 'error', reason: `unknown agent; try: ${known}` })),
            ...wantedIds.filter(id => !unknown.includes(id)).map(id => {
                const pTarget = projectAgentTarget(id, resolvedDir);
                if (!pTarget) return { id, label: id, file: '', status: 'unsupported', reason: `no project config for ${id}` };
                return { id: pTarget.id, label: pTarget.label, file: pTarget.file, ...apply(pTarget, serverKey, { action, name, vaultHome, proxy, dryRun }) };
            }),
        ];
    }

    const serverKey = entryKey(name);
    const wanted = explicit ? all.filter(target => ids.includes(target.id)) : all.filter(target => fs.existsSync(target.marker));
    return [
        ...unknown.map(id => ({ id, label: id, file: '', status: 'error', reason: `unknown agent; try: ${known}` })),
        ...wanted.map(target => ({ id: target.id, label: target.label, file: target.file, ...apply(target, serverKey, { action, name, vaultHome, proxy, dryRun }) })),
    ];
}

export function renameMcpTool({ oldName, newName, vaultHome = null, env = {} }) {
    if (!oldName || !newName || oldName === newName) return;

    if (vaultHome) {
        const clientsDir = path.join(vaultHome, 'clients');
        const oldFile = path.join(clientsDir, `${oldName}.key`);
        const newFile = path.join(clientsDir, `${newName}.key`);
        if (fs.existsSync(oldFile)) {
            fs.mkdirSync(clientsDir, { recursive: true });
            fs.copyFileSync(oldFile, newFile);
        }
    }

    const oldKey = entryKey(oldName);
    const newKey = entryKey(newName);

    const targets = agentTargets(env);
    for (const target of targets) {
        if (!fs.existsSync(target.file)) continue;
        if (target.toml) {
            try {
                const text = fs.readFileSync(target.file, 'utf8');
                const replaced = text.replace(new RegExp(`(["'])--name\\1\\s*,\\s*(["'])${oldName}\\2`), `$1--name$1, $2${newName}$2`);
                if (replaced !== text) write(target.file, replaced);
            } catch { /* ignore */ }
            continue;
        }
        update(target, newKey, false, servers => {
            const entry = servers[oldKey] || servers[SERVER_NAME];
            if (!entry || !Array.isArray(entry.args)) return 'unchanged';
            delete servers[oldKey];
            delete servers[SERVER_NAME];
            const nameIdx = entry.args.indexOf('--name');
            if (nameIdx >= 0 && entry.args[nameIdx + 1] === oldName) {
                entry.args[nameIdx + 1] = newName;
            }
            servers[newKey] = entry;
            return 'updated';
        });
    }
}
