import fs from 'node:fs';
import path from 'node:path';

/** Valideert een project directory. */
export function validateTargetDir(targetDir, vaultHome = null) {
    if (!targetDir || typeof targetDir !== 'string') return { valid: false, reason: 'targetDir is required' };
    if (!path.isAbsolute(targetDir)) return { valid: false, reason: 'targetDir must be an absolute path' };
    const normalized = path.resolve(targetDir);
    if (!fs.existsSync(normalized)) return { valid: false, reason: `targetDir does not exist: ${targetDir}` };
    try {
        const stat = fs.statSync(normalized);
        if (!stat.isDirectory()) return { valid: false, reason: `targetDir is not a directory: ${targetDir}` };
    } catch {
        return { valid: false, reason: `targetDir cannot be accessed: ${targetDir}` };
    }
    const lower = normalized.toLowerCase();
    if (lower.startsWith('c:\\windows') || lower === 'c:\\windows' || lower.startsWith('/system') || lower.startsWith('/bin')) {
        return { valid: false, reason: 'targetDir cannot be a system directory' };
    }
    if (vaultHome) {
        const normVault = path.resolve(vaultHome).toLowerCase();
        if (lower === normVault || lower.startsWith(normVault + path.sep)) {
            return { valid: false, reason: 'targetDir cannot be inside vaultHome' };
        }
    }
    return { valid: true, path: normalized };
}

/** Project targets per agent; geeft null als de agent geen projectconfig kent. */
export function projectAgentTarget(agentId, targetDir) {
    switch (agentId) {
        case 'claude-code':
            return { id: agentId, label: 'Claude Code', file: path.join(targetDir, '.mcp.json'), key: 'mcpServers', typed: false };
        case 'vscode':
            return { id: agentId, label: 'VS Code', file: path.join(targetDir, '.vscode', 'mcp.json'), key: 'servers', typed: true };
        case 'cursor':
            return { id: agentId, label: 'Cursor', file: path.join(targetDir, '.cursor', 'mcp.json'), key: 'mcpServers', typed: false };
        case 'gemini-cli':
        case 'antigravity':
            return { id: agentId, label: agentId === 'antigravity' ? 'Antigravity' : 'Gemini CLI', file: path.join(targetDir, '.gemini', 'settings.json'), key: 'mcpServers', typed: false };
        default:
            return null;
    }
}
