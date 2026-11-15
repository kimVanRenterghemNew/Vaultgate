// Egress: de ingevulde request naar de doelhost, het antwoord gescrubd terug naar de tool.
// Voor een MCP-request volgt de proxy redirects zelf (redirect.js); de waarden blijven dan in het geheugen tot de
// keten klaar is (nodig voor een redirect binnen dezelfde origin) en worden daarna gewist. Zonder volgen meteen.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { createScrubber } from '../scrub/index.js';
import { throughProxy } from './location.js';
import { connectUpstream, tlsRule, overSocket } from './tls-override.js';
import { outgoingHeaders, fillUrl, scrubStrings } from './fill.js';
import { redirectStep } from './redirect.js';

const RESPONSE_DROP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'trailer', 'upgrade', 'content-length']);
const DECODERS = Object.freeze({ gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress });
/** Naar een andere origin gaan alleen deze headers mee, en alleen zonder placeholder. */
const PLAIN_HEADERS = Object.freeze(['accept', 'accept-language', 'user-agent']);
const plainHeaders = req => Object.fromEntries(PLAIN_HEADERS.filter(n => typeof req.headers[n] === 'string' && !req.headers[n].includes('{{')).map(n => [n, req.headers[n]]));

/**
 * @param {{ tlsTrust: object | null, record: (entry: object) => Promise<boolean>, respondDenied: Function, failUpstream: Function, log: Function }} deps
 */
export function createForward({ tlsTrust, record, respondDenied, failUpstream, log }) {
    return function forward(req, res, { target, route, toolKey, values, audit: entry, socket = null }) {
        const scrubber = createScrubber(scrubStrings(values));
        const follow = req.headers['x-vault-gate-protocol'] === 'mcp';
        let finished = false;
        let upstream = null;
        const done = () => { finished = true; values.clear(); };

        // Afbreken door de client breekt ook de upstream-call af.
        res.on('close', () => { if (!finished) { upstream?.destroy(); done(); } });

        function send(url, { sock, headers, hops, withSecrets, body = null }) {
            const lib = url.protocol === 'https:' ? https : http;
            upstream = lib.request(url, { ...overSocket(url, sock), method: req.method, headers });
            upstream.on('error', error => {
                if (finished) return;
                done();
                if (res.headersSent) { res.destroy(); return; }
                failUpstream(res, entry, tlsRule(error));
            });
            upstream.on('response', upstreamRes => relay(upstreamRes, url, hops, withSecrets));
            if (body) body.pipe(upstream); else upstream.end();
        }

        async function hop(step, hops) {
            const host = step.next.origin; // zonder pad en query: een tijdelijke link draagt zijn handtekening in de query
            if (!(await record({ ...entry, allow: true, rule: step.rule, host }))) { done(); respondDenied(res, { status: 503, rule: 'audit-unavailable' }); return; }
            const connection = await connectUpstream(tlsTrust, step.next);
            if (connection.rule) { done(); failUpstream(res, { ...entry, host }, connection); return; }
            if (finished) { connection.socket?.destroy(); return; }
            const headers = step.secrets ? outgoingHeaders(req, { route, toolKey, values }) : plainHeaders(req);
            send(step.next, { sock: connection.socket, headers, hops: hops + 1, withSecrets: step.secrets });
        }

        function relay(upstreamRes, url, hops, withSecrets) {
            const step = redirectStep({ follow, status: upstreamRes.statusCode, location: upstreamRes.headers.location, method: req.method, current: url, original: target, hops, withSecrets });
            if (step.follow || step.deny) upstreamRes.resume();
            if (step.follow) { hop(step, hops).catch(() => { done(); respondDenied(res, { status: 502, rule: 'upstream-error' }); }); return; }
            if (step.deny) {
                done();
                record({ ...entry, allow: false, rule: step.rule, status: step.status, host: step.next.origin });
                respondDenied(res, { status: step.status, rule: step.rule, host: step.next.origin });
                return;
            }
            const encoding = String(upstreamRes.headers['content-encoding'] ?? 'identity').toLowerCase();
            const decoder = encoding === 'identity' ? null : DECODERS[encoding];
            if (encoding !== 'identity' && !decoder) {
                done();
                upstreamRes.destroy();
                record({ ...entry, allow: false, rule: 'unsupported-encoding', status: 502 });
                respondDenied(res, { status: 502, rule: 'unsupported-encoding', detail: encoding });
                return;
            }
            const headers = { 'x-vault-gate-rule': entry.rule };
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
                if (RESPONSE_DROP.has(name) || (decoder && name === 'content-encoding')) continue;
                headers[name] = Array.isArray(value) ? value.map(v => scrubber.text(v)) : scrubber.text(value);
            }
            if (headers.location) headers.location = throughProxy(headers.location, url, route, req);
            log({ event: 'upstream', requestId: entry.requestId, status: upstreamRes.statusCode });
            res.writeHead(upstreamRes.statusCode, headers);
            res.flushHeaders();

            const source = decoder ? upstreamRes.pipe(decoder()) : upstreamRes;
            source.on('data', chunk => {
                const out = scrubber.push(chunk);
                if (out.length && !res.write(out)) { source.pause(); res.once('drain', () => source.resume()); }
            });
            source.on('end', () => {
                done();
                res.end(scrubber.end());
                // Een waarde die de doelhost terugstuurde en die de tool niet zag: een eigen regel (de teller op het dashboard).
                if (scrubber.replaced() > 0) record({ ...entry, allow: false, rule: 'response-scrubbed', status: upstreamRes.statusCode, count: scrubber.replaced() });
            });
            source.on('error', () => { done(); res.destroy(); });
        }

        send(fillUrl(target, values), { sock: socket, headers: outgoingHeaders(req, { route, toolKey, values }), hops: 0, withSecrets: true, body: req });
        // Zonder volgen houdt de proxy de waarden niet langer vast dan nodig (strings zijn niet te wissen).
        if (!follow) values.clear();
    };
}
