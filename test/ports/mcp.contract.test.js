// Contracttest voor de MCP-poort over alle ondersteunde transporten (stdio, /mcp, /sse)
// plus strikte schemacontrole over elke tool in TOOLS.
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
    TOOLS,
    SERVER_INFO,
    MCP_PROTOCOL_VERSION,
    runMcpStdio,
    createMcpHttpHandler,
    validateToolSchema,
    schemaProblems,
} from '../../src/mcp/index.js';

// ---- Schematests voor strikte MCP clients -------------------------------------------------------------

describe('MCP tool schema contract', () => {
    it('elke tool in TOOLS heeft een geldig schema zonder combinators of ontbrekende types', () => {
        expect(TOOLS.length).toBeGreaterThanOrEqual(1);
        for (const tool of TOOLS) {
            const problems = validateToolSchema(tool);
            expect(problems, `Tool ${tool.name} heeft schemaproblemen: ${problems.join('; ')}`).toEqual([]);
        }
    });

    it('MOET weigeren: een tool in TOOLS met een oneOf of missende types faalt de contracttest', () => {
        const badToolOneOf = {
            name: 'bad_tool',
            description: 'bad',
            inputSchema: {
                type: 'object',
                properties: {
                    value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                },
            },
        };
        const badToolNoItemsType = {
            name: 'bad_array',
            description: 'bad',
            inputSchema: {
                type: 'object',
                properties: {
                    items: { type: 'array' },
                },
            },
        };
        expect(validateToolSchema(badToolOneOf).join(' ')).toContain("'oneOf' is not accepted");
        expect(validateToolSchema(badToolNoItemsType).join(' ')).toContain('array without items');
        expect(schemaProblems({ type: 'array', items: {} }).join(' ')).toContain('no type');
    });
});

// ---- Scenario's over alle transporten: stdio, Streamable HTTP (/mcp), SSE (/sse) --------------------

function createMockHttpReq({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (body) {
        req.push(body);
    }
    req.push(null);
    return req;
}

function createMockHttpRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.body = '';
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.writeHead = (code, headers = {}) => {
        res.statusCode = code;
        for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v;
        return res;
    };
    res.write = (chunk) => {
        res.body += chunk;
        res.emit('data', chunk);
        return true;
    };
    res.end = (chunk = '') => {
        res.body += chunk;
        res.emit('end');
        return res;
    };
    return res;
}

describe.each(['stdio', 'streamable-http', 'sse'])('MCP poortcontract over transport: %s', (transport) => {
    let receivedUpstream = null;
    let mockFetch;
    let client;

    beforeEach(async () => {
        receivedUpstream = null;
        mockFetch = async (url, options = {}) => {
            const parsed = new URL(url);
            const path = parsed.pathname;

            if (path.includes('denied.example.com')) {
                return {
                    status: 403,
                    headers: new Map([['x-vault-gate-rule', 'target-host-not-allowed']]),
                    text: async () => 'target-host-not-allowed',
                };
            }

            receivedUpstream = {
                url,
                method: options.method,
                headers: options.headers,
                body: options.body,
            };

            return {
                status: 200,
                headers: new Map(),
                text: async () => 'upstream-response-without-secret',
            };
        };

        const toolKey = 'ks_test_key_contract_12345';
        const proxyUrl = 'http://127.0.0.1:8484';

        if (transport === 'stdio') {
            client = async (msg) => {
                let stdoutData = '';
                const stdin = new Readable({ read() {} });
                const stdout = new Writable({
                    write(chunk, enc, cb) {
                        stdoutData += chunk.toString();
                        cb();
                    },
                });

                const stdioPromise = runMcpStdio({
                    toolKey,
                    proxyUrl,
                    input: stdin,
                    output: stdout,
                    fetchFn: mockFetch,
                });

                stdin.push(`${JSON.stringify(msg)}\n`);
                stdin.push(null);

                await stdioPromise;
                const lines = stdoutData.trim().split('\n').filter(Boolean);
                return JSON.parse(lines[lines.length - 1]);
            };
        } else if (transport === 'streamable-http') {
            const handler = createMcpHttpHandler({
                proxyUrl,
                defaultToolKey: toolKey,
                fetchFn: mockFetch,
            });

            client = async (msg) => {
                const req = createMockHttpReq({
                    method: 'POST',
                    url: '/mcp',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(msg),
                });
                const res = createMockHttpRes();
                await handler(req, res);
                expect(res.statusCode).toBe(200);
                return JSON.parse(res.body);
            };
        } else if (transport === 'sse') {
            const handler = createMcpHttpHandler({
                proxyUrl,
                defaultToolKey: toolKey,
                fetchFn: mockFetch,
            });

            // Start SSE session
            const sseReq = createMockHttpReq({ method: 'GET', url: '/sse' });
            const sseRes = createMockHttpRes();
            await handler(sseReq, sseRes);

            expect(sseRes.statusCode).toBe(200);
            expect(sseRes.body).toContain('event: endpoint\ndata: /mcp/messages?sessionId=');

            const match = sseRes.body.match(/sessionId=([a-zA-Z0-9]+)/);
            expect(match).toBeTruthy();
            const sessionId = match[1];

            client = async (msg) => {
                const responsePromise = new Promise((resolve) => {
                    const listener = (chunk) => {
                        const str = chunk.toString();
                        if (str.includes('event: message\ndata: ')) {
                            const dataLine = str.split('\n').find(l => l.startsWith('data: '));
                            if (dataLine) {
                                sseRes.removeListener('data', listener);
                                resolve(JSON.parse(dataLine.slice(6)));
                            }
                        }
                    };
                    sseRes.on('data', listener);
                });

                const postReq = createMockHttpReq({
                    method: 'POST',
                    url: `/mcp/messages?sessionId=${sessionId}`,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(msg),
                });
                const postRes = createMockHttpRes();
                await handler(postReq, postRes);
                expect(postRes.statusCode).toBe(202);

                return responsePromise;
            };
        }
    });

    it('initialize geeft protocolversie en SERVER_INFO', async () => {
        const res = await client({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2024-11-05' },
        });
        expect(res).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            result: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: SERVER_INFO,
            },
        });
    });

    it('tools/list geeft precies TOOLS', async () => {
        const res = await client({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
        });
        expect(res).toEqual({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: TOOLS },
        });
    });

    it('tools/call http_request naar een niet-toegestane host geeft weigering met regelnaam', async () => {
        const res = await client({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'http_request',
                arguments: {
                    url: 'https://denied.example.com/api',
                    method: 'GET',
                },
            },
        });
        expect(res.id).toBe(3);
        expect(res.result.isError).toBe(true);
        expect(res.result.content[0].text).toContain('target-host-not-allowed');
    });

    it('een toegestane call bereikt de doelserver en de respons bevat geen geheim', async () => {
        const secretVal = 'top-secret-val-abc123';
        const res = await client({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'http_request',
                arguments: {
                    url: 'https://allowed.example.com/api',
                    method: 'POST',
                    headers: { 'authorization': `Bearer {{secret:mytoken}}` },
                    body: 'data',
                },
            },
        });
        expect(res.id).toBe(4);
        expect(res.result.isError).toBe(false);
        expect(res.result.content[0].text).toBe('upstream-response-without-secret');
        expect(res.result.content[0].text).not.toContain(secretVal);
        expect(receivedUpstream).not.toBeNull();
        expect(receivedUpstream.method).toBe('POST');
    });

    it('onbekende methode geeft JSON-RPC fout -32601', async () => {
        const res = await client({
            jsonrpc: '2.0',
            id: 5,
            method: 'non_existent_rpc_method',
        });
        expect(res).toMatchObject({
            jsonrpc: '2.0',
            id: 5,
            error: {
                code: -32601,
                message: expect.stringContaining('Method not found'),
            },
        });
    });
});
