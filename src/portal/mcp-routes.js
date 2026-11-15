// De vaultgate-MCP in de agents van deze pc zetten, of de JSON-entry geven om te kopiëren. Deel van het
// portaal (index.js). De key die de pagina net kreeg, is het bewijs: zonder geldige MCP-key gebeurt er niets. Die key
// wordt beschermd bewaard (`clients/<tool>.key`, DPAPI op Windows, zoals `login`); een agent-config krijgt alleen
// `--name`, nooit de key, en de key staat nooit in een antwoord, fout of audit.
import { agentTargets, runAgentInstall, mcpEntry, runSkillAndPolicyInstall, refreshMcpInstallations, createMcpRegistry, checkGitExclude, packageVersion, SERVER_NAME } from '../mcp/index.js';
import { saveKey, keyProtector } from '../device/index.js';
import fs from 'node:fs';

export function mcpRoutes({ registry, vault = registry?.vault, home, proxyUrl, auditAdmin, httpError, protector = keyProtector(), env = {} }) {
    const refuse = (rule, message) => Object.assign(httpError('BAD_REQUEST', message), { rule });
    // De kluis zelf (niet de registry: die geeft ze niet vrij): waar de MCP-installaties en de laatste versie staan.
    const mcpReg = vault ? createMcpRegistry(vault) : null;

    async function keyedTool(key) {
        const tool = typeof key === 'string' && key ? await registry.findToolByKey(key) : null;
        if (!tool || tool.revoked) throw refuse('mcp-key-unknown', 'this key is not a key of a tool in this vault');
        if (tool.kind !== 'mcp') throw refuse('mcp-tool-required', `tool ${tool.name} is not an MCP tool`);
        saveKey({ home, name: tool.name, key, protector, proxy: proxyUrl() });
        return tool;
    }

    /** De bestanden die een actie echt aanpaste, met de `.vaultgate.bak` als die er staat. */
    const CHANGED = new Set(['installed', 'updated', 'removed']);
    const changedFiles = results => results.filter(r => CHANGED.has(r.status) && r.file).map(({ file, status }) => {
        const backup = `${file}.vaultgate.bak`;
        return { file, status, backup: fs.existsSync(backup) ? backup : null };
    });

    function targetInstalled(target, toolName) {
        if (!fs.existsSync(target.file)) return false;
        try {
            const serverKey = toolName ? `vaultgate-${toolName}` : null;
            if (target.toml) {
                const text = fs.readFileSync(target.file, 'utf8');
                return text.includes(`[mcp_servers.${SERVER_NAME}]`) || (serverKey && text.includes(`[mcp_servers.${serverKey}]`)) || text.includes('[[mcp_servers]]');
            }
            const text = fs.readFileSync(target.file, 'utf8').trim();
            if (!text) return false;
            const data = JSON.parse(text);
            const servers = data[target.key] || {};
            if (serverKey && servers[serverKey]) return true;
            return Boolean(servers[SERVER_NAME]);
        } catch {
            return false;
        }
    }

    return [
        ['GET', /^\/api\/mcp\/agents$/, 'unlocked', ({ query }) => {
            const toolName = query?.get?.('tool') || null;
            return agentTargets(env).map(t => ({ id: t.id, label: t.label, present: fs.existsSync(t.marker), installed: targetInstalled(t, toolName) }));
        }],

        ['GET', /^\/api\/mcp\/installations$/, 'unlocked', async ({ query }) => {
            if (!mcpReg) return { installations: [] };
            const toolName = query?.get?.('tool') || null;
            const list = await mcpReg.listInstallations(toolName);
            const verified = list.map(item => {
                const fileExists = fs.existsSync(item.file);
                let entryExists = false;
                if (fileExists) {
                    try {
                        const content = fs.readFileSync(item.file, 'utf8');
                        entryExists = content.includes(`vaultgate-${item.tool}`) || content.includes(`--name", "${item.tool}`) || content.includes(`--name', '${item.tool}`);
                    } catch { /* ignore */ }
                }
                const gitExclude = item.folder ? checkGitExclude(item.folder, item.file) : false;
                return { ...item, status: entryExists ? 'active' : 'missing', gitExclude };
            });
            return { installations: verified };
        }],

        ['POST', /^\/api\/mcp\/install$/, 'unlocked', async ({ body }) => {
            const agents = Array.isArray(body.agents) ? body.agents.filter(a => typeof a === 'string') : [];
            if (!agents.length) throw refuse('mcp-agent-required', 'name at least one agent');
            const tool = await keyedTool(body.key);
            const scope = body.scope === 'project' ? 'project' : 'user';
            const targetDir = scope === 'project' ? body.folder : null;
            const rawResults = runAgentInstall({ scope, targetDir, ids: agents, name: tool.name, vaultHome: home, proxy: proxyUrl(), env });
            const results = rawResults.map(({ id, label, file, status, reason }) => ({ id, label, file, status, ...(reason ? { reason } : {}) }));
            if (mcpReg) {
                for (const r of results) {
                    if (r.status === 'installed' || r.status === 'updated' || r.status === 'unchanged') {
                        await mcpReg.recordInstallation({ tool: tool.name, agent: r.id, scope, folder: targetDir, file: r.file });
                    }
                }
            }
            await auditAdmin('mcp-installed', { tool: tool.name, scope, ...(targetDir ? { folder: targetDir } : {}), detail: results.map(r => `${r.id}: ${r.status}`).join('; ') });
            return { results, changed: changedFiles(results) };
        }],

        ['POST', /^\/api\/mcp\/uninstall$/, 'unlocked', async ({ body }) => {
            const agents = Array.isArray(body.agents) ? body.agents.filter(a => typeof a === 'string') : [];
            if (!agents.length) throw refuse('mcp-agent-required', 'name at least one agent');
            const tool = await keyedTool(body.key);
            const scope = body.scope === 'project' ? 'project' : 'user';
            const targetDir = scope === 'project' ? body.folder : null;
            const rawResults = runAgentInstall({ action: 'uninstall', scope, targetDir, ids: agents, name: tool.name, vaultHome: home, proxy: proxyUrl(), env });
            const results = rawResults.map(({ id, label, file, status, reason }) => ({ id, label, file, status, ...(reason ? { reason } : {}) }));
            if (mcpReg) {
                for (const r of results) {
                    if (r.status === 'removed' || r.status === 'absent') {
                        await mcpReg.removeInstallation({ tool: tool.name, agent: r.id, scope, folder: targetDir });
                    }
                }
            }
            await auditAdmin('mcp-uninstalled', { tool: tool.name, scope, ...(targetDir ? { folder: targetDir } : {}), detail: results.map(r => `${r.id}: ${r.status}`).join('; ') });
            return { results, changed: changedFiles(results) };
        }],

        ['POST', /^\/api\/mcp\/entry$/, 'unlocked', async ({ body }) => {
            const tool = await keyedTool(body.key);
            const keyName = `vaultgate-${tool.name}`;
            if (body.format === 'vscode') {
                return { servers: { [keyName]: mcpEntry({ name: tool.name, vaultHome: home, proxy: proxyUrl(), typed: true }) } };
            }
            return { mcpServers: { [keyName]: mcpEntry({ name: tool.name, vaultHome: home, proxy: proxyUrl() }) } };
        }],

        ['POST', /^\/api\/mcp\/skill\/install$/, 'unlocked', async ({ body = {} }) => {
            let toolName = 'global';
            if (body.key) {
                try {
                    const tool = await keyedTool(body.key);
                    toolName = tool.name;
                } catch { /* ignore optional key */ }
            }
            const results = runSkillAndPolicyInstall({ action: 'install', env, vaultHome: home });
            await auditAdmin('mcp-skill-installed', { tool: toolName, detail: results.map(r => `${r.id} (${r.type}): ${r.status}`).join('; ') });
            return { results, changed: changedFiles(results) };
        }],

        // `auto`: de pagina vraagt het na het ontgrendelen; alleen na een versiewissel. Een kluis zonder bewaarde versie
        // onthoudt ze alleen: er is nog geen "na een update" (en een journey raakt zo nooit de echte agent-configs).
        ['POST', /^\/api\/mcp\/refresh$/, 'unlocked', async ({ body = {} }) => {
            const version = packageVersion();
            if (body.auto && mcpReg) {
                const last = await mcpReg.lastVersion();
                if (last === version) return { updatedCount: 0, files: [], skipped: true };
                await mcpReg.rememberVersion(version);
                if (last === null) return { updatedCount: 0, files: [], skipped: true };
            }
            const installs = mcpReg ? await mcpReg.listInstallations() : [];
            const projectDirs = [...new Set(installs.filter(i => i.scope === 'project' && i.folder).map(i => i.folder))];
            const res = await refreshMcpInstallations({ env, projectDirs, vaultHome: home });
            await auditAdmin('mcp-refreshed', { detail: `updated: ${res.updatedCount}` });
            return res;
        }],

        ['POST', /^\/api\/mcp\/skill\/uninstall$/, 'unlocked', async ({ body = {} }) => {
            let toolName = 'global';
            if (body.key) {
                try {
                    const tool = await keyedTool(body.key);
                    toolName = tool.name;
                } catch { /* ignore optional key */ }
            }
            const results = runSkillAndPolicyInstall({ action: 'uninstall', env, vaultHome: home });
            await auditAdmin('mcp-skill-uninstalled', { tool: toolName, detail: results.map(r => `${r.id} (${r.type}): ${r.status}`).join('; ') });
            return { results, changed: changedFiles(results) };
        }],
    ];
}
