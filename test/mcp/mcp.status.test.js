import { describe, it, expect } from 'vitest';
import { createMcpStatusHtml, TOOLS, SERVER_INFO, MCP_PROTOCOL_VERSION } from '../../src/mcp/index.js';

describe('MCP statuspagina (unit)', () => {
    it('genereert HTML met serverinfo, endpoints, installatiecommando en tools', () => {
        const html = createMcpStatusHtml({
            serverInfo: SERVER_INFO,
            protocolVersion: MCP_PROTOCOL_VERSION,
            tools: TOOLS,
            proxyUrl: 'http://127.0.0.1:8484',
        });

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain(SERVER_INFO.name);
        expect(html).toContain(SERVER_INFO.version);
        expect(html).toContain(MCP_PROTOCOL_VERSION);
        expect(html).toContain('/mcp');
        expect(html).toContain('/sse');
        expect(html).toContain('vaultgate install');
        expect(html).toContain('vaultgate install --skill');
        expect(html).toContain('http_request');
        expect(html).toContain('Execute an HTTP request through Vaultgate');
        expect(html).toContain('url');
    });

    it('voegt dynamisch nieuwe tools toe aan de tooltabel', () => {
        const customTools = [
            ...TOOLS,
            {
                name: 'custom_search',
                description: 'Search documentation safely',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search keywords' },
                    },
                    required: ['query'],
                },
            },
        ];

        const html = createMcpStatusHtml({
            serverInfo: SERVER_INFO,
            protocolVersion: MCP_PROTOCOL_VERSION,
            tools: customTools,
            proxyUrl: 'http://127.0.0.1:8484',
        });

        expect(html).toContain('custom_search');
        expect(html).toContain('Search documentation safely');
        expect(html).toContain('query');
    });
});
