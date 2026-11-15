// Afhandeling van legacy SSE (/sse) en SSE postback berichten (/mcp/messages).

export function createSseManager({ handleRpcRequest, fetchFn = fetch }) {
    const sseSessions = new Map();

    async function handleSseConnect(req, res, { toolKey }) {
        if (req.method !== 'GET') {
            res.writeHead(405).end('Method Not Allowed');
            return;
        }
        const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
        });
        res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`);

        const session = { res, toolKey };
        sseSessions.set(sessionId, session);

        const timer = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        req.on('close', () => {
            clearInterval(timer);
            sseSessions.delete(sessionId);
        });
    }

    async function handleSsePostback(req, res, { url, toolKey, currentProxyUrl }) {
        if (req.method !== 'POST') {
            res.writeHead(405).end('Method Not Allowed');
            return;
        }
        const sessionId = url.searchParams.get('sessionId');
        const session = sessionId ? sseSessions.get(sessionId) : null;
        if (!session) {
            res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Session not found' }));
            return;
        }

        let bodyText = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
            bodyText += chunk;
        }

        let msg;
        try {
            msg = JSON.parse(bodyText || '{}');
        } catch {
            res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Parse error' }));
            return;
        }

        const effectiveKey = toolKey || session.toolKey;
        const response = await handleRpcRequest(msg, { proxyUrl: currentProxyUrl, toolKey: effectiveKey, fetchFn });
        if (response !== null) {
            session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }
        res.writeHead(202).end();
    }

    return {
        handleSseConnect,
        handleSsePostback,
    };
}
