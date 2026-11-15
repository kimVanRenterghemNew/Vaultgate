// HTTP-routes voor MCP over Streamable HTTP (/mcp) en legacy SSE (/sse).
import { SERVER_INFO, MCP_PROTOCOL_VERSION } from './server-info.js';
import { TOOLS } from './tools.js';
import { createMcpStatusHtml } from './status-page.js';
import { createSseManager } from './sse-handler.js';

export const MCP_PATHS = Object.freeze(new Set(['/mcp', '/sse', '/mcp/messages']));

export function isMcpPath(url) {
    if (!url || typeof url !== 'string') return false;
    const pathname = url.split('?')[0].replace(/\/$/, '') || '/';
    return MCP_PATHS.has(pathname);
}

/** Maakt een HTTP handler voor MCP over Streamable HTTP (/mcp) en legacy SSE (/sse). */
export function createMcpHttpHandler({
    proxyUrl = 'http://127.0.0.1:8484',
    defaultToolKey = null,
    fetchFn = fetch,
    home = null,
    readKeyFn = null,
    handleRpcRequest,
} = {}) {
    const sse = createSseManager({ handleRpcRequest, fetchFn });

    function resolveToolKey(req, url) {
        const hKey = req.headers?.['x-vault-gate-tool-key'];
        if (hKey) return hKey;

        const auth = req.headers?.authorization;
        if (typeof auth === 'string') {
            const match = auth.replace(/^Bearer\s+/i, '').trim();
            if (match.startsWith('ks_')) return match;
        }

        const qKey = url.searchParams.get('key') || url.searchParams.get('tool_key');
        if (qKey) return qKey;

        const qName = url.searchParams.get('name');
        if (qName && readKeyFn && home) {
            try {
                const loaded = readKeyFn({ home, name: qName });
                if (loaded) return loaded;
            } catch { /* ignore */ }
        }

        return defaultToolKey || process.env.VAULTGATE_TOOL_KEY || null;
    }

    async function handleStreamableHttp(req, res, { currentProxyUrl, toolKey }) {
        if (req.method === 'POST') {
            const accept = req.headers?.accept || '';
            const isEventStream = accept.includes('text/event-stream');

            let bodyText = '';
            req.setEncoding('utf8');
            for await (const chunk of req) {
                bodyText += chunk;
                if (bodyText.length > 1_000_000) {
                    res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({
                        jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload Too Large' },
                    }));
                    return;
                }
            }

            let msg;
            try {
                msg = JSON.parse(bodyText || '{}');
            } catch {
                res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({
                    jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' },
                }));
                return;
            }

            const response = await handleRpcRequest(msg, { proxyUrl: currentProxyUrl, toolKey, fetchFn });
            if (response === null) {
                res.writeHead(202).end();
                return;
            }

            if (isEventStream) {
                res.writeHead(200, {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-transform',
                    connection: 'keep-alive',
                });
                res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
            } else {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(response));
            }
            return;
        }

        if (req.method === 'GET') {
            const accept = req.headers?.accept || '';
            if (accept.includes('text/event-stream')) {
                res.writeHead(200, {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-transform',
                    connection: 'keep-alive',
                });
                res.write('event: endpoint\ndata: /mcp\n\n');
                const timer = setInterval(() => { res.write(': keepalive\n\n'); }, 15000);
                req.on('close', () => clearInterval(timer));
                return;
            }

            if (accept.includes('text/html')) {
                const html = createMcpStatusHtml({
                    serverInfo: SERVER_INFO,
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    tools: TOOLS,
                    proxyUrl: currentProxyUrl,
                });
                res.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                    'x-content-type-options': 'nosniff',
                    'cache-control': 'no-store',
                    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
                });
                res.end(html);
                return;
            }

            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                status: 'ok',
                server: SERVER_INFO.name,
                version: SERVER_INFO.version,
                protocol: 'mcp',
                transports: ['streamable-http', 'sse'],
                protocolVersion: MCP_PROTOCOL_VERSION,
                endpoint: '/mcp',
                sseEndpoint: '/sse',
                tools: TOOLS,
            }, null, 2));
            return;
        }

        res.writeHead(405).end('Method Not Allowed');
    }

    return async function handleMcp(req, res) {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        res.setHeader('access-control-allow-headers', 'content-type, authorization, x-vault-gate-tool-key, accept');

        if (req.method === 'OPTIONS') {
            res.writeHead(204).end();
            return;
        }

        const host = req.headers?.host || '127.0.0.1';
        const currentProxyUrl = req.headers?.host ? `http://${req.headers.host}` : proxyUrl;
        const url = new URL(req.url, `http://${host}`);
        const pathname = url.pathname.replace(/\/$/, '') || '/';
        const toolKey = resolveToolKey(req, url);

        if (pathname === '/mcp') {
            await handleStreamableHttp(req, res, { currentProxyUrl, toolKey });
            return;
        }
        if (pathname === '/sse') {
            await sse.handleSseConnect(req, res, { toolKey });
            return;
        }
        if (pathname === '/mcp/messages') {
            await sse.handleSsePostback(req, res, { url, toolKey, currentProxyUrl });
            return;
        }

        res.writeHead(404).end('Not Found');
    };
}
