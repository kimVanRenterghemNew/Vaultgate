import fs from 'node:fs';
import path from 'node:path';

export function createMcpRegistry(vault) {
    async function getRecord() {
        for (const id of await vault.ids()) {
            const h = await vault.get(id, ['kind']);
            if (h.kind === 'mcp_installations') return { id, ...(await vault.get(id, ['list', 'version'])) };
        }
        return null;
    }

    async function listInstallations(toolName = null) {
        const rec = await getRecord();
        const list = rec?.list ?? [];
        return toolName ? list.filter(item => item.tool === toolName) : [...list];
    }

    async function recordInstallation(entry) {
        const rec = await getRecord();
        const list = rec?.list ? [...rec.list] : [];
        const idx = list.findIndex(item => item.tool === entry.tool && item.agent === entry.agent && item.scope === entry.scope && item.folder === entry.folder);
        if (idx >= 0) list[idx] = entry;
        else list.push(entry);
        await vault.put({ kind: 'mcp_installations', list, version: rec?.version ?? null }, rec?.id);
    }

    async function removeInstallation({ tool, agent, scope, folder }) {
        const rec = await getRecord();
        if (!rec?.list) return;
        const list = rec.list.filter(item => !(item.tool === tool && item.agent === agent && item.scope === scope && item.folder === folder));
        await vault.put({ kind: 'mcp_installations', list, version: rec.version ?? null }, rec.id);
    }

    /** De vaultgate-versie die de installaties het laatst ververste (null: nog nooit). */
    async function lastVersion() {
        return (await getRecord())?.version ?? null;
    }

    async function rememberVersion(version) {
        const rec = await getRecord();
        await vault.put({ kind: 'mcp_installations', list: rec?.list ?? [], version }, rec?.id);
    }

    return Object.freeze({ listInstallations, recordInstallation, removeInstallation, lastVersion, rememberVersion });
}

export function checkGitExclude(folder, filePath) {
    if (!folder || !filePath) return false;
    const gitDir = path.join(folder, '.git');
    if (!fs.existsSync(gitDir)) return false;
    const excludeFile = path.join(gitDir, 'info', 'exclude');
    if (!fs.existsSync(excludeFile)) return false;
    try {
        const rel = path.relative(folder, filePath).replace(/\\/g, '/');
        const text = fs.readFileSync(excludeFile, 'utf8');
        return text.split('\n').some(l => l.trim() === rel || l.trim() === `/${rel}` || l.trim() === path.basename(filePath));
    } catch {
        return false;
    }
}
