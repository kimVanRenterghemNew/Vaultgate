// Device flow aan de proxy-kant: een tool vraagt zijn key aan (`/device/code`) en haalt hem op
// (`/device/token`), zonder login en zonder kopiëren; daarna wisselt de helper hem in voor een token (`/device/exchange`,
// key-exchange.js). Deel van de proxy (index.js).
import net from 'node:net';
import { decide } from '../decision/index.js';

/** Hostnaam uit een Host-header (zonder poort; IPv6 zonder haken). */
const hostName = host => {
    const h = String(host ?? '');
    const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(h);
    return v6 ? v6[1] : h.replace(/:\d+$/, '');
};

/**
 * Wie /device/* mag aanspreken. Een domeinnaam als Host (behalve localhost) wijst op DNS-rebinding vanuit een
 * webpagina; een VM spreekt de proxy aan op een IP-adres. Alleen JSON: een HTML-formulier of een "simple request" zonder
 * CORS-preflight kan dan niets starten.
 */
export const DEVICE_INGRESS_RULES = Object.freeze([
    { name: 'device-bad-host', when: ctx => ctx.host !== 'localhost' && net.isIP(ctx.host) === 0, then: { allow: false, status: 421 } },
    { name: 'device-not-json', when: ctx => !/^application\/json\s*(;|$)/i.test(ctx.contentType ?? ''), then: { allow: false, status: 415 } },
    { name: 'device-ingress-ok', when: () => true, then: { allow: true } },
]);

/** De paden van de device flow en de uitwisseling (alleen POST). */
export const DEVICE_PATHS = Object.freeze(new Set(['/device/code', '/device/token', '/device/exchange']));

const DEVICE_ERRORS = Object.freeze({ TOO_MANY_REQUESTS: [429, 'too_many_requests'], INVALID_NAME: [400, 'invalid_request'], NAME_TAKEN: [409, 'name_taken'] });

function readSmallJson(req) {
    return new Promise(resolve => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', c => { data += c; if (data.length > 4096) { data = ''; req.destroy(); } });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
        req.on('error', () => resolve({}));
    });
}

/** @param {{ device: object|null, exchange: Function|null, log: (event: object) => void }} deps @returns {(req, res) => Promise<void>} */
export function createDeviceIngress({ device, exchange = null, log }) {
    return async function handleDevice(req, res) {
        const send = (status, payload, rule) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(rule ? { 'x-vault-gate-rule': rule } : {}) }); res.end(JSON.stringify(payload)); };
        const ingress = decide({ host: hostName(req.headers.host), contentType: req.headers['content-type'] }, DEVICE_INGRESS_RULES);
        if (!ingress.allow) {
            req.resume();
            log({ event: 'device-refused', rule: ingress.rule });
            return send(ingress.status, { error: 'invalid_request', rule: ingress.rule });
        }
        const body = await readSmallJson(req);
        const client = req.socket.remoteAddress;
        try {
            if (req.url === '/device/exchange') {
                if (!exchange) return send(404, { error: 'invalid_request' });
                const result = await exchange({ key: body.tool_key, client });
                return send(result.status, result.body, result.rule);
            }
            if (!device) return send(404, { error: 'invalid_request' });
            if (req.url === '/device/code') return send(200, await device.request({ clientName: body.client_name, client }));
            const result = await device.poll({ deviceCode: body.device_code, client });
            return send(result.status, result.body);
        } catch (error) {
            const [status, code] = DEVICE_ERRORS[error.code] ?? [500, 'server_error'];
            if (status === 500) log({ event: 'device-error', code: error.code ?? 'unknown' });
            return send(status, { error: code });
        }
    };
}
