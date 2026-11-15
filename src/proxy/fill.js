// Plaatshouders zoeken en invullen: {{secret:naam}}, {{basic:naam}}, {{basic:user:pass}} en {{totp:naam}}.
// Uitgaande headers filteren (hop-by-hop weg, tool-key weg) en waarden verzamelen voor de scrubber.
import crypto from 'node:crypto';
import { TOOL_KEY_HEADERS } from '../policy/index.js';

const SECRET_RE = /\{\{secret:([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})\}\}/g;
const BASIC_RE = /\{\{basic:([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,63}))?\}\}/g;
const TOTP_RE = /\{\{totp:([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})\}\}/g;

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade',
    'proxy-authorization', 'proxy-authenticate', 'host', ...TOOL_KEY_HEADERS, 'x-vault-gate-protocol', 'accept-encoding']);

export const basicPassword = value => {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(value ?? ''));
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
};

function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
        const val = alphabet.indexOf(cleaned[i]);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}

export function computeTotp(secret, time = Date.now()) {
    const key = /^[A-Z2-7=\s]+$/i.test(String(secret)) ? base32Decode(secret) : Buffer.from(String(secret));
    const counter = Math.floor(Math.floor(time / 1000) / 30);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
    return String(code).padStart(6, '0');
}

export function placeholders(headers, target) {
    const found = new Map();
    const add = (name, loc) => found.set(name, new Set([...(found.get(name) ?? []), loc]));
    const scan = (text, loc) => {
        const str = String(text ?? '');
        for (const m of str.matchAll(SECRET_RE)) add(m[1], loc);
        for (const m of str.matchAll(BASIC_RE)) { add(m[1], loc); if (m[2]) add(m[2], loc); }
        for (const m of str.matchAll(TOTP_RE)) add(m[1], loc);
    };
    for (const [name, value] of Object.entries(headers)) (Array.isArray(value) ? value : [value]).forEach(v => scan(v, `header:${name}`));
    for (const [param, value] of new URLSearchParams(target.search)) { scan(value, `query:${param}`); scan(param, 'query-name'); }
    for (const m of target.search.matchAll(/(?:%7B%7B|\{\{)(?:secret|basic|totp):([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.-]+))?(?:%7D%7D|\}\})/gi)) {
        if (!found.has(m[1])) add(m[1], 'query-name');
        if (m[2] && !found.has(m[2])) add(m[2], 'query-name');
    }
    return new Map([...found].map(([name, places]) => [name, [...places]]));
}

export function authShape(headers, target, secretName) {
    if (!headers && !target) return null;
    const pat = new RegExp(`(?:%7B%7B|\\{\\{)(?:secret|basic|totp):${secretName}(?::([A-Za-z0-9_.-]+))?(?:%7D%7D|\\}\\})`, 'i');
    for (const [name, val] of Object.entries(headers ?? {})) {
        const str = Array.isArray(val) ? val.join(' ') : String(val ?? '');
        if (pat.test(str)) {
            const lower = name.toLowerCase();
            if (lower === 'authorization') {
                if (/^Bearer\s+/i.test(str)) return 'header:authorization:bearer';
                if (/^Basic\s+/i.test(str) || /(?:%7B%7B|\{\{)basic:/i.test(str)) return 'header:authorization:basic';
                if (/(?:%7B%7B|\{\{)totp:/i.test(str)) return 'header:authorization:totp';
                return 'header:authorization:token';
            }
            return `header:${lower}`;
        }
    }
    if (target?.search) {
        for (const [param, val] of new URLSearchParams(target.search)) {
            if (pat.test(val) || pat.test(param)) return `query:${param}`;
        }
    }
    return null;
}

function resolveVal(val, field) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    return val[field] ?? val.value ?? '';
}

export function fill(text, values) {
    let result = String(text ?? '');
    result = result.replace(SECRET_RE, (whole, name) => (values.has(name) ? resolveVal(values.get(name), 'password') : whole));
    result = result.replace(BASIC_RE, (whole, a, b) => {
        if (!values.has(a) || (b && !values.has(b))) return whole;
        if (!b) {
            const va = values.get(a);
            if (va?.basic) return va.basic;
            const u = resolveVal(va, 'username');
            const p = resolveVal(va, 'password');
            return Buffer.from(u ? `${u}:${p}` : p).toString('base64');
        }
        const user = resolveVal(values.get(a), 'username');
        const pass = resolveVal(values.get(b), 'password');
        return Buffer.from(`${user}:${pass}`).toString('base64');
    });
    result = result.replace(TOTP_RE, (whole, name) => {
        if (!values.has(name)) return whole;
        const seed = resolveVal(values.get(name), 'totp');
        return seed ? computeTotp(seed) : whole;
    });
    return result;
}

export function outgoingHeaders(req, { route, toolKey, values }) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (HOP_BY_HOP.has(name)) continue;
        if (toolKey && (String(value).includes(toolKey) || basicPassword(value)?.includes(toolKey))) continue;
        headers[name] = Array.isArray(value) ? value.map(v => fill(v, values)) : fill(value, values);
    }
    if (route) {
        const val = values.get(route.secret);
        const resolved = typeof val === 'object' ? (val.password ?? val.value ?? '') : val;
        delete headers['x-api-key'];
        delete headers.authorization;
        if (route.header === 'authorization') headers.authorization = `Bearer ${resolved}`;
        else if (route.header === 'basic') headers.authorization = `Basic ${Buffer.from(`x-access-token:${resolved}`).toString('base64')}`;
        else headers[route.header] = resolved;
    }
    headers['accept-encoding'] = 'identity';
    return headers;
}

export function fillUrl(target, values) {
    const url = new URL(target);
    const rep = (whole, kind, a, b) => {
        if (kind.toLowerCase() === 'secret' && values.has(a)) return encodeURIComponent(resolveVal(values.get(a), 'password'));
        if (kind.toLowerCase() === 'totp' && values.has(a)) {
            const seed = resolveVal(values.get(a), 'totp');
            return seed ? encodeURIComponent(computeTotp(seed)) : whole;
        }
        if (kind.toLowerCase() === 'basic' && values.has(a)) {
            if (!b) return encodeURIComponent(values.get(a)?.basic ?? Buffer.from(resolveVal(values.get(a), 'password')).toString('base64'));
            if (values.has(b)) return encodeURIComponent(Buffer.from(`${resolveVal(values.get(a), 'username')}:${resolveVal(values.get(b), 'password')}`).toString('base64'));
        }
        return whole;
    };
    url.search = url.search.replace(/(?:%7B%7B|\{\{)(secret|basic|totp):([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.-]+))?(?:%7D%7D|\}\})/gi, rep);
    return url;
}

export function scrubStrings(values) {
    const strings = [];
    for (const val of values.values()) {
        if (typeof val === 'string' && val.length > 0) { strings.push(val); continue; }
        if (val && typeof val === 'object') {
            for (const k of ['password', 'value', 'basic']) {
                if (typeof val[k] === 'string' && val[k].length > 0) strings.push(val[k]);
            }
            if (typeof val.totp === 'string' && val.totp.length > 0) {
                strings.push(val.totp);
                try {
                    strings.push(computeTotp(val.totp));
                } catch {
                    // ongeldige seed: overslaan
                }
            }
        }
    }
    return [...new Set(strings)];
}
