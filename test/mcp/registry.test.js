// Unit tests voor src/mcp/registry.js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMcpRegistry, checkGitExclude } from '../../src/mcp/index.js';

let tempDir;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'mcp-reg-'));
});

describe('createMcpRegistry', () => {
    function fakeVault() {
        const records = new Map();
        let counter = 1;
        return {
            async ids() { return [...records.keys()]; },
            async get(id) { return records.get(id) || null; },
            async put(data, id = null) {
                const actualId = id || `id-${counter++}`;
                records.set(actualId, data);
                return actualId;
            },
            async remove(id) { records.delete(id); },
        };
    }

    it('beheert MCP installaties: toevoegen, ophalen per tool en verwijderen', async () => {
        const vault = fakeVault();
        const reg = createMcpRegistry(vault);

        expect(await reg.listInstallations()).toEqual([]);

        await reg.recordInstallation({ tool: 'toolA', agent: 'claude-code', scope: 'user', folder: null, file: '/home/.claude.json' });
        await reg.recordInstallation({ tool: 'toolB', agent: 'cursor', scope: 'project', folder: '/proj', file: '/proj/.cursor/mcp.json' });

        const all = await reg.listInstallations();
        expect(all).toHaveLength(2);

        const onlyA = await reg.listInstallations('toolA');
        expect(onlyA).toHaveLength(1);
        expect(onlyA[0].agent).toBe('claude-code');

        // Update bestaande
        await reg.recordInstallation({ tool: 'toolA', agent: 'claude-code', scope: 'user', folder: null, file: '/home/.claude.json', updated: true });
        const updatedA = await reg.listInstallations('toolA');
        expect(updatedA).toHaveLength(1);
        expect(updatedA[0].updated).toBe(true);

        // Verwijder
        await reg.removeInstallation({ tool: 'toolA', agent: 'claude-code', scope: 'user', folder: null });
        expect(await reg.listInstallations('toolA')).toHaveLength(0);
        expect(await reg.listInstallations('toolB')).toHaveLength(1);
    });

    it('checkGitExclude controleert .git/info/exclude op paden', () => {
        const gitDir = path.join(tempDir, '.git', 'info');
        fs.mkdirSync(gitDir, { recursive: true });
        const excludeFile = path.join(gitDir, 'exclude');
        fs.writeFileSync(excludeFile, '# ignores\n.mcp.json\n.vscode/mcp.json\n');

        expect(checkGitExclude(tempDir, path.join(tempDir, '.mcp.json'))).toBe(true);
        expect(checkGitExclude(tempDir, path.join(tempDir, '.vscode', 'mcp.json'))).toBe(true);
        expect(checkGitExclude(tempDir, path.join(tempDir, 'other.json'))).toBe(false);

        // Geen folder of file
        expect(checkGitExclude(null, null)).toBe(false);
        expect(checkGitExclude(path.join(tempDir, 'no-git'), path.join(tempDir, 'no-git', '.mcp.json'))).toBe(false);
    });
});
