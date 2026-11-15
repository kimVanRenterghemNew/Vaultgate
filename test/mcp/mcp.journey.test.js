// MCP-server over stdio: agents doen veilige webrequests via Vaultgate.
// De proxy vult de credentials in ({{secret:...}}) en scrubt de uitvoer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, MAIN } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('mcp-token');

describe.each(MODES)('MCP-server over stdio, %s', (mode, start) => {
    let upstream;
    let proc;
    let key;

    beforeAll(async () => {
        upstream = await startUpstream((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ received: req.headers.authorization, ok: true }));
        });
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'api', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'agent-tool', kind: 'mcp' });
            await registry.addGrant({ toolId: tool.id, secretName: 'api', host: upstream.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    function spawnMcpClient(toolKey) {
        const child = spawn(process.execPath, [MAIN, 'mcp', '--proxy', proc.proxy], {
            env: { ...process.env, VAULTGATE_TOOL_KEY: toolKey },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let idCounter = 1;
        const pending = new Map();
        let buffer = '';
        let stdoutText = '';
        child.stdout.on('data', chunk => {
            const str = chunk.toString('utf8');
            stdoutText += str;
            buffer += str;
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.id && pending.has(msg.id)) {
                        pending.get(msg.id)(msg);
                        pending.delete(msg.id);
                    }
                } catch {
                    // geen json
                }
            }
        });
        return {
            child,
            stdout: () => stdoutText,
            async request(method, params) {
                const reqId = idCounter++;
                const p = new Promise(resolve => pending.set(reqId, resolve));
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params })}\n`);
                return p;
            },
            async callTool(name, args) {
                const res = await this.request('tools/call', { name, arguments: args });
                return res.result;
            },
            close() {
                child.kill();
            },
        };
    }

    it('initialiseert het MCP-protocol en toont http_request als beschikbare tool', async () => {
        const client = spawnMcpClient(key);
        try {
            const init = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
            expect(init.result.protocolVersion).toBe('2024-11-05');
            expect(init.result.serverInfo.name).toBe('vaultgate');

            const list = await client.request('tools/list', {});
            expect(list.result.tools.some(t => t.name === 'http_request')).toBe(true);
        } finally {
            client.close();
        }
    });

    it('Given een agent met een tool-key When http_request naar een toegestane host met {{secret:x}} Then ontvangt de nep-API de waarde en ziet de agent alleen het gescrubde antwoord', async () => {
        const client = spawnMcpClient(key);
        try {
            const res = await client.callTool('http_request', {
                url: `${upstream.origin}/test`,
                method: 'POST',
                headers: { authorization: 'Bearer {{secret:api}}' },
                body: JSON.stringify({ test: 123 }),
            });
            expect(res.isError).toBe(false);
            expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
            expect(res.content[0].text).toContain('Bearer ***');
            expect(res.content[0].text).not.toContain(value);
            expect(findLeaks({ stdout: client.stdout(), out: proc.output() }, [value, key])).toEqual([]);
        } finally {
            client.close();
        }
    });

    it('Given een agent When http_request naar een niet-toegestane host Then krijgt ze target-host-not-allowed', async () => {
        const client = spawnMcpClient(key);
        try {
            const res = await client.callTool('http_request', {
                url: 'https://registry.npmjs.org/vaultgate-pkg',
                method: 'GET',
                headers: { authorization: 'Bearer {{secret:api}}' },
            });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('target-host-not-allowed');
            expect(findLeaks({ stdout: client.stdout(), out: proc.output() }, [value, key])).toEqual([]);
        } finally {
            client.close();
        }
    });

    it('ondersteunt directe MCP Streamable HTTP link (/mcp) via de proxy-URL', async () => {
        // 1. Discovery GET
        const discoveryRes = await fetch(`${proc.proxy}/mcp`);
        expect(discoveryRes.status).toBe(200);
        const discovery = await discoveryRes.json();
        expect(discovery.server).toBe('vaultgate');
        expect(discovery.tools.some(t => t.name === 'http_request')).toBe(true);

        // 2. Initialize POST
        const initRes = await fetch(`${proc.proxy}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
        });
        expect(initRes.status).toBe(200);
        const initData = await initRes.json();
        expect(initData.result.serverInfo.name).toBe('vaultgate');
        expect(initData.result.protocolVersion).toBe('2025-03-26');

        // 3. tools/call over HTTP met tool-key in header
        const callRes = await fetch(`${proc.proxy}/mcp`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-vault-gate-tool-key': key,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'http_request',
                    arguments: {
                        url: `${upstream.origin}/http-mcp-test`,
                        method: 'POST',
                        headers: { authorization: 'Bearer {{secret:api}}' },
                        body: JSON.stringify({ mcpHttp: true }),
                    },
                },
            }),
        });
        expect(callRes.status).toBe(200);
        const callData = await callRes.json();
        expect(callData.result.isError).toBe(false);
        expect(callData.result.content[0].text).toContain('Bearer ***');
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
        expect(findLeaks({ stdout: callData.result.content[0].text, out: proc.output() }, [value, key])).toEqual([]);
    });
});
