// MCP-statuspagina met alle tools, zoals lady-lens
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { TOOLS } from '../../src/mcp/index.js';

const secretValue = fakeSecret('mcp-status-secret');

describe.each(MODES)('MCP statuspagina (journey), %s', (mode, start) => {
    let proc;
    let toolKey;

    beforeAll(async () => {
        const home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'mcp-secret-name', value: secretValue, hosts: ['https://example.com'] });
            const tool = await registry.addTool({ name: 'mcp-agent-tool', kind: 'mcp' });
            await registry.addGrant({ toolId: tool.id, secretName: 'mcp-secret-name', host: 'https://example.com', origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
    });

    it('GET /mcp met Accept: text/html toont HTML statuspagina zonder gevoelige data', async () => {
        const res = await fetch(`${proc.proxy}/mcp`, {
            headers: { accept: 'text/html,application/xhtml+xml' },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');

        const html = await res.text();
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('vaultgate');
        expect(html).toContain('/mcp');
        expect(html).toContain('/sse');
        expect(html).toContain('vaultgate install');
        expect(html).toContain('vaultgate install --skill');

        for (const tool of TOOLS) {
            expect(html).toContain(tool.name);
            expect(html).toContain(tool.description);
        }

        // Veiligheid: geen secrets, waarden of keys in de HTML
        expect(html).not.toContain(secretValue);
        expect(html).not.toContain('mcp-secret-name');
        expect(html).not.toContain(toolKey);
        expect(findLeaks(html, [secretValue, toolKey])).toEqual([]);
    });

    it('GET /mcp zonder Accept: text/html geeft het bestaande JSON-antwoord', async () => {
        const res = await fetch(`${proc.proxy}/mcp`, {
            headers: { accept: 'application/json' },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');

        const json = await res.json();
        expect(json.status).toBe('ok');
        expect(json.server).toBe('vaultgate');
        expect(json.endpoint).toBe('/mcp');
        expect(Array.isArray(json.tools)).toBe(true);
    });
});
