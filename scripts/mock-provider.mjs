#!/usr/bin/env node
// Mock-provider: een nep-Anthropic/OpenAI/LiteLLM om Vaultgate zonder echte sleutels of kosten te proberen,
// handmatig en in de end-to-end-set. Logt per request welke sleutelheader er was en een korte vingerafdruk ervan
// (om "dezelfde sleutel" te zien), nooit de waarde. `/echo` geeft headers en body terug, om het scrubben te tonen.
//
//   npm run mock-upstream                         luistert op 127.0.0.1:5099
//   node scripts/mock-provider.mjs --port 6000
//   node scripts/mock-provider.mjs --self-test    start, doet een call per route, stopt (probe)
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0, 8);

function keyInfo(headers) {
    if (headers['x-api-key']) return { keyHeader: 'x-api-key', keyFingerprint: fingerprint(headers['x-api-key']) };
    if (headers['x-goog-api-key']) return { keyHeader: 'x-goog-api-key', keyFingerprint: fingerprint(headers['x-goog-api-key']) };
    const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? '')?.[1];
    if (bearer) return { keyHeader: 'authorization', keyFingerprint: fingerprint(bearer) };
    return { keyHeader: null };
}

const WORDS = ['Dit', 'is', 'een', 'antwoord', 'van', 'de', 'mock-provider.'];

function anthropic(body, res) {
    const model = body.model ?? 'mock';
    if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: WORDS.join(' ') }], stop_reason: 'end_turn' }));
        return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start', { type: 'message_start', message: { id: 'msg_mock', model, role: 'assistant' } });
    let i = 0;
    const timer = setInterval(() => {
        if (i < WORDS.length) { send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${i ? ' ' : ''}${WORDS[i]}` } }); i += 1; return; }
        clearInterval(timer);
        send('message_stop', { type: 'message_stop' });
        res.end();
    }, 20);
    res.on('close', () => clearInterval(timer));
}

function openai(body, res) {
    const model = body.model ?? 'mock';
    if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: WORDS.join(' ') }, finish_reason: 'stop' }] }));
        return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    let i = 0;
    const timer = setInterval(() => {
        if (i < WORDS.length) { res.write(`data: ${JSON.stringify({ object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: `${i ? ' ' : ''}${WORDS[i]}` } }] })}\n\n`); i += 1; return; }
        clearInterval(timer);
        res.end('data: [DONE]\n\n');
    }, 20);
    res.on('close', () => clearInterval(timer));
}

export function createMockProvider({ host = '127.0.0.1', log = () => {} } = {}) {
    let server = null;
    let origin = null;

    function handle(req, res) {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body;
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
            const route = req.url.split('?')[0];
            log({ event: 'request', method: req.method, route, ...keyInfo(req.headers), stream: body.stream === true });
            if (route.endsWith('/v1/messages') && req.method === 'POST') return anthropic(body, res);
            if (route.endsWith('/v1/chat/completions') && req.method === 'POST') return openai(body, res);
            if (route.endsWith('/v1/models')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ data: [{ id: 'mock-model', object: 'model' }] }));
            }
            if (route.endsWith('/echo')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: raw }));
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            return res.end('{"error":"not found"}');
        });
    }

    return {
        get origin() { return origin; },
        async start(port = 5099) {
            server = http.createServer(handle);
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
            origin = `http://${host}:${server.address().port}`;
            return origin;
        },
        stop: () => new Promise(resolve => { server?.closeAllConnections?.(); server ? server.close(() => resolve()) : resolve(); }),
    };
}

/** Start op een vrije poort, doet een call per route (ook gestreamd), stopt. */
export async function selfTest({ out = () => {} } = {}) {
    const mock = createMockProvider();
    await mock.start(0);
    const results = [];
    try {
        const call = async (path, body, headers = {}) => fetch(`${mock.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
        results.push(['anthropic', (await (await call('/v1/messages', { model: 'm' }, { 'x-api-key': 'test' })).json()).type === 'message']);
        results.push(['anthropic stream', (await (await call('/v1/messages', { model: 'm', stream: true })).text()).includes('message_stop')]);
        results.push(['openai', Boolean((await (await call('/v1/chat/completions', { model: 'm' })).json()).choices)]);
        results.push(['openai stream', (await (await call('/v1/chat/completions', { model: 'm', stream: true })).text()).includes('[DONE]')]);
        results.push(['echo', (await (await call('/echo', { a: 1 })).json()).method === 'POST']);
    } finally {
        await mock.stop();
    }
    for (const [name, ok] of results) out(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    const all = results.every(([, ok]) => ok);
    out(all ? 'alle routes geslaagd' : 'niet alle routes geslaagd');
    return all;
}

/** De CLI: `--self-test` geeft een exitcode terug; anders start de mock en geeft hem terug (om te stoppen). */
export async function main(argv, { out = text => process.stdout.write(`${text}
`) } = {}) {
    const { values } = parseArgs({ args: argv, options: { port: { type: 'string', default: '5099' }, 'self-test': { type: 'boolean', default: false } } });
    if (values['self-test']) return { code: (await selfTest({ out })) ? 0 : 1 };
    const mock = createMockProvider({ log: e => out(JSON.stringify(e)) });
    const origin = await mock.start(Number(values.port));
    out(`mock-provider op ${origin} (Anthropic: /v1/messages, OpenAI: /v1/chat/completions, /echo). Ctrl+C om te stoppen.`);
    return { mock };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const { code } = await main(process.argv.slice(2));
    if (code !== undefined) process.exit(code);
}
