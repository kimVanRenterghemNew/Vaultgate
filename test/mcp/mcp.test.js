import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { handleRpcRequest, runMcpStdio, runMcpCli, createMcpHttpHandler, isMcpPath, MCP_PATHS, TOOLS, MCP_PROTOCOL_VERSION, SERVER_INFO } from '../../src/mcp/index.js';

describe('mcp unit tests', () => {
    it('handleRpcRequest valideert requests en ondersteunt basisprotocol', async () => {
        // ongeldig bericht
        const invalid = await handleRpcRequest(null, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(invalid.error.code).toBe(-32600);

        // initialize
        const init = await handleRpcRequest({ id: 1, method: 'initialize' }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(init.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
        expect(init.result.serverInfo).toEqual(SERVER_INFO);

        // notifications/initialized geeft null
        const notif = await handleRpcRequest({ method: 'notifications/initialized' }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(notif).toBeNull();

        // ping
        const ping = await handleRpcRequest({ id: 2, method: 'ping' }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(ping.result).toEqual({});

        // tools/list
        const list = await handleRpcRequest({ id: 3, method: 'tools/list' }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(list.result.tools).toEqual(TOOLS);

        // onbekende methode
        const unknown = await handleRpcRequest({ id: 4, method: 'unknown/method' }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(unknown.error.code).toBe(-32601);

        // onbekende tool
        const badTool = await handleRpcRequest({ id: 5, method: 'tools/call', params: { name: 'other_tool' } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'k' });
        expect(badTool.result.isError).toBe(true);
        expect(badTool.result.content[0].text).toContain('Unknown tool');
    });

    it('handleRpcRequest voert http_request uit via fetchFn met verschillende methoden en fouten', async () => {
        const calls = [];
        const mockFetch = async (url, opts) => {
            calls.push({ url, opts });
            if (url.includes('throw-err')) throw new Error('network down');
            if (url.includes('empty-err')) {
                return {
                    status: 403,
                    text: async () => '',
                    headers: new Map([['x-vault-gate-rule', 'target-host-not-allowed']]),
                };
            }
            if (url.includes('status-err')) {
                return {
                    status: 500,
                    text: async () => 'internal server error',
                    headers: new Map(),
                };
            }
            return {
                status: 200,
                text: async () => JSON.stringify({ ok: true }),
                headers: new Map(),
            };
        };

        // Ontbrekende URL
        const noUrl = await handleRpcRequest({ id: 10, method: 'tools/call', params: { name: 'http_request', arguments: {} } }, { proxyUrl: 'http://127.0.0.1:8484/', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(noUrl.result.isError).toBe(true);
        expect(noUrl.result.content[0].text).toContain('Missing required argument: url');

        // Geslaagde GET
        const okRes = await handleRpcRequest({ id: 11, method: 'tools/call', params: { name: 'http_request', arguments: { url: 'https://api.github.com/user' } } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(okRes.result.isError).toBe(false);
        expect(calls[0].url).toBe('http://127.0.0.1:8484/forward/https://api.github.com/user');
        expect(calls[0].opts.headers['x-vault-gate-tool-key']).toBe('ks_key');
        expect(calls[0].opts.headers['x-vault-gate-protocol']).toBe('mcp');

        // Geslaagde POST met body
        await handleRpcRequest({ id: 12, method: 'tools/call', params: { name: 'http_request', arguments: { url: 'https://api.github.com/post', method: 'POST', body: '{"hello":1}' } } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(calls[1].opts.method).toBe('POST');
        expect(calls[1].opts.body).toBe('{"hello":1}');

        // Foutstatus met lege body en x-vault-gate-rule header
        const ruleErr = await handleRpcRequest({ id: 13, method: 'tools/call', params: { name: 'http_request', arguments: { url: 'https://empty-err/x' } } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(ruleErr.result.isError).toBe(true);
        expect(ruleErr.result.content[0].text).toContain('Request failed: target-host-not-allowed (status 403)');

        // Foutstatus met inhoud
        const textErr = await handleRpcRequest({ id: 14, method: 'tools/call', params: { name: 'http_request', arguments: { url: 'https://status-err/x' } } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(textErr.result.isError).toBe(true);
        expect(textErr.result.content[0].text).toBe('internal server error');

        // Netwerkfout (fetch gooit exception)
        const netErr = await handleRpcRequest({ id: 15, method: 'tools/call', params: { name: 'http_request', arguments: { url: 'https://throw-err/x' } } }, { proxyUrl: 'http://127.0.0.1:8484', toolKey: 'ks_key', fetchFn: mockFetch });
        expect(netErr.result.isError).toBe(true);
        expect(netErr.result.content[0].text).toContain('Proxy connection error: network down');
    });

    it('runMcpStdio verwerkt stromen over stdin/stdout en meldt JSON-parse fouten', async () => {
        const input = new Readable({ read() {} });
        let outputText = '';
        const output = new Writable({
            write(chunk, enc, cb) {
                outputText += chunk.toString('utf8');
                cb();
            },
        });

        const promise = runMcpStdio({
            toolKey: 'k',
            proxyUrl: 'http://127.0.0.1:8484',
            input,
            output,
            fetchFn: async () => ({ status: 200, text: async () => '{"ok":true}', headers: new Map() }),
        });

        // Stuur een lege regel, parsefout, notificatie en ping
        input.push('\n');
        input.push('bad-json\n');
        input.push(`${JSON.stringify({ method: 'notifications/initialized' })}\n`);
        input.push(`${JSON.stringify({ id: 100, method: 'ping' })}\n`);
        input.push(null);

        await promise;

        const lines = outputText.trim().split('\n').map(l => JSON.parse(l));
        expect(lines[0].error.code).toBe(-32700);
        expect(lines[1].id).toBe(100);
        expect(lines[1].result).toEqual({});
    });

    it('runMcpCli ondersteunt opts.key, env.VAULTGATE_TOOL_KEY en weigert zonder key', async () => {
        let stderrText = '';
        const fakeStderr = { write: msg => { stderrText += msg; } };

        const originalExit = process.exit;
        process.exit = code => { throw new Error(`exit ${code}`); };

        try {
            await runMcpCli({
                opts: { key: 'ks_cli_explicit_key', proxy: 'http://127.0.0.1:9999' },
                env: {},
                input: new Readable({ read() { this.push(null); } }),
                output: new Writable({ write(c, e, cb) { cb(); } }),
                stderr: fakeStderr,
            });

            // Zonder enige key roept CLI process.exit(1) aan
            await expect(runMcpCli({
                opts: {},
                env: {},
                input: new Readable({ read() { this.push(null); } }),
                output: new Writable({ write(c, e, cb) { cb(); } }),
                stderr: fakeStderr,
            })).rejects.toThrow('exit 1');
            expect(stderrText).toContain('no tool key provided');
        } finally {
            process.exit = originalExit;
        }
    });

    it('createMcpHttpHandler ondersteunt Streamable HTTP (/mcp) en legacy SSE (/sse)', async () => {
        function mockReqRes({ method = 'GET', url = '/mcp', headers = {}, body = '' } = {}) {
            const req = new Readable({
                read() {
                    if (body) this.push(body);
                    this.push(null);
                },
            });
            req.method = method;
            req.url = url;
            req.headers = { ...headers };

            let statusCode = 200;
            const responseHeaders = {};
            let responseBody = '';
            const res = {
                setHeader(k, v) { responseHeaders[k.toLowerCase()] = v; },
                writeHead(code, h = {}) {
                    statusCode = code;
                    for (const [k, v] of Object.entries(h)) responseHeaders[k.toLowerCase()] = v;
                    return res;
                },
                write(chunk) { responseBody += chunk; return true; },
                end(chunk = '') { responseBody += chunk; },
            };

            return { req, res, getResult: () => ({ status: statusCode, headers: responseHeaders, body: responseBody }) };
        }

        expect(MCP_PATHS.has('/mcp')).toBe(true);
        expect(isMcpPath('/mcp')).toBe(true);
        expect(isMcpPath('/sse')).toBe(true);
        expect(isMcpPath('/mcp/messages?sessionId=123')).toBe(true);
        expect(isMcpPath('/forward/https://example.com')).toBe(false);

        const handler = createMcpHttpHandler({
            proxyUrl: 'http://127.0.0.1:8484',
            defaultToolKey: 'ks_default_test_key',
            readKeyFn: ({ name }) => (name === 'agent-test' ? 'ks_saved_agent_key' : null),
            fetchFn: async () => ({ status: 200, text: async () => '{"ok":true}', headers: new Map() }),
        });

        // 1. OPTIONS (CORS preflight)
        const opts = mockReqRes({ method: 'OPTIONS', url: '/mcp' });
        await handler(opts.req, opts.res);
        expect(opts.getResult().status).toBe(204);
        expect(opts.getResult().headers['access-control-allow-origin']).toBe('*');

        // 2. GET /mcp (Browser / Agent discovery)
        const getDiscovery = mockReqRes({ method: 'GET', url: '/mcp', headers: { accept: 'application/json' } });
        await handler(getDiscovery.req, getDiscovery.res);
        expect(getDiscovery.getResult().status).toBe(200);
        const discovery = JSON.parse(getDiscovery.getResult().body);
        expect(discovery.status).toBe('ok');
        expect(discovery.protocol).toBe('mcp');
        expect(discovery.tools[0].name).toBe('http_request');

        // 3. POST /mcp initialize
        const initReq = mockReqRes({
            method: 'POST',
            url: '/mcp',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
        });
        await handler(initReq.req, initReq.res);
        expect(initReq.getResult().status).toBe(200);
        const initRes = JSON.parse(initReq.getResult().body);
        expect(initRes.result.serverInfo.name).toBe('vaultgate');
        expect(initRes.result.protocolVersion).toBe('2025-03-26');

        // 4. POST /mcp via text/event-stream (Streamable HTTP response chunk)
        const sseInitReq = mockReqRes({
            method: 'POST',
            url: '/mcp',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        });
        await handler(sseInitReq.req, sseInitReq.res);
        const sseRes = sseInitReq.getResult();
        expect(sseRes.status).toBe(200);
        expect(sseRes.headers['content-type']).toContain('text/event-stream');
        expect(sseRes.body).toContain('event: message');
        expect(sseRes.body).toContain('http_request');

        // 5. POST /mcp met ongeldige JSON
        const badJsonReq = mockReqRes({ method: 'POST', url: '/mcp', body: 'not-json' });
        await handler(badJsonReq.req, badJsonReq.res);
        expect(badJsonReq.getResult().status).toBe(400);

        // 6. Legacy SSE: GET /sse en POST /mcp/messages
        const sseConnect = mockReqRes({ method: 'GET', url: '/sse' });
        const ssePromise = handler(sseConnect.req, sseConnect.res);
        expect(sseConnect.getResult().headers['content-type']).toContain('text/event-stream');
        const match = /data: (\/mcp\/messages\?sessionId=[a-z0-9]+)/.exec(sseConnect.getResult().body);
        expect(match).toBeTruthy();
        const postbackUrl = match[1];

        // Stuur message naar die sessie via ?name=agent-test (laadt ks_saved_agent_key)
        const postback = mockReqRes({
            method: 'POST',
            url: `${postbackUrl}&name=agent-test`,
            body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
        });
        await handler(postback.req, postback.res);
        expect(postback.getResult().status).toBe(202);
        expect(sseConnect.getResult().body).toContain('http_request');

        // Sluit sessie netjes af
        sseConnect.req.emit('close');
        await ssePromise;
    });
});
