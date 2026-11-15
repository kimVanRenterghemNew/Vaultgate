// Toegangsbeslissing (docs/architecture.md §3, §5): één beslistabel op de compositiekern, standaard dicht, elke uitkomst
// draagt de naam van de regel die won. Puur: geen I/O, geen klok. De proxy vult de context (wie, vanwaar, welk secret,
// waarheen, is er een toekenning); de tabel beslist. Niet configureerbaar en geen poort (architecture.md §4).
import net from 'node:net';
import { decide, not } from '../decision/index.js';
export { INVALID_QUIET_HOURS, LAST_PASSKEY, parseQuietHours, inQuietHours, blockRuleFor, ensureNotLastPasskey } from './blocks.js';
export { registrableDomain, sameSiteAs } from './public-suffix.js';

export const INVALID_HOST_RULE = 'INVALID_HOST_RULE';
export const INVALID_CLIENT_RULE = 'INVALID_CLIENT_RULE';

const invalidHostRule = (text, why) => Object.assign(new Error(`invalid host rule ${JSON.stringify(text)}: ${why}`), { code: INVALID_HOST_RULE });
const invalidClientRule = (text, why) => Object.assign(new Error(`invalid client rule ${JSON.stringify(text)}: ${why}`), { code: INVALID_CLIENT_RULE });

// ---- injectiebeleid ----------------------------------------------------------------------------------

export const INVALID_INJECT_RULE = 'INVALID_INJECT_RULE';
const invalidInjectRule = (text, why) => Object.assign(new Error(`invalid inject rule ${JSON.stringify(text)}: ${why}`), { code: INVALID_INJECT_RULE });

/** Een nieuw secret mag standaard alleen in `Authorization`. */
export const DEFAULT_INJECT = Object.freeze(['header:authorization']);
/** Een secret van vóór 9.4 (zonder ingestelde plekken): elke header, nooit de query. */
export const LEGACY_INJECT = Object.freeze(['header:*']);

const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/; // headernaam (RFC 9110 token), in kleine letters
/** Headers met de tool-key: aanvaard door de proxy, nooit doorgestuurd. */
export const TOOL_KEY_HEADERS = Object.freeze(['x-vault-gate-tool-key']);
const NEVER_HEADERS = new Set(['host', ...TOOL_KEY_HEADERS, 'proxy-authorization', 'connection', 'transfer-encoding', 'content-length', 'cookie']);

/** Plekken waar een secret mag komen: `header:<naam>` of `query:<parameter>`. Minstens één. */
export function parseInjectRules(list) {
    if (!Array.isArray(list) || list.length === 0) throw invalidInjectRule(list, 'at least one location (header:<name> or query:<param>)');
    return [...new Set(list.map(text => {
        const m = /^(header|query):(.+)$/.exec(String(text).trim());
        if (!m) throw invalidInjectRule(text, 'use header:<name> or query:<param>');
        if (m[1] === 'query') {
            if (!/^[A-Za-z0-9_.-]{1,64}$/.test(m[2])) throw invalidInjectRule(text, 'invalid query parameter');
            return `query:${m[2]}`;
        }
        const name = m[2].toLowerCase();
        if (!TOKEN.test(name) || NEVER_HEADERS.has(name)) throw invalidInjectRule(text, 'invalid or reserved header');
        return `header:${name}`;
    }))];
}

/** Hooguit zoveel plekken per secret: niet te veel varianten. */
export const MAX_INJECT = 3;

/** Zoals parseInjectRules, maar een lege lijst mag: het secret leert zijn plek bij het eerste toegestane gebruik. */
export function parseInjectPlaces(list) {
    if (Array.isArray(list) && list.length === 0) return [];
    const places = parseInjectRules(list);
    if (places.length > MAX_INJECT) throw invalidInjectRule(list, `at most ${MAX_INJECT} locations`);
    return places;
}

const learnable = locations => { try { return parseInjectPlaces(locations).length > 0; } catch { return false; } };

/** Elke plek waar de plaatshouder staat, moet toegestaan zijn. `header:*` = elke header (alleen voor oude secrets). */
export const injectAllowed = (rules, locations) => locations.every(loc => rules.includes(loc) || (rules.includes('header:*') && loc.startsWith('header:')));

// ---- doelhost-allowlist -------------------------------------------------------------------------------

// Een gecodeerde `/`, `\`, `.`, `;` of null-byte (%00), dubbele encoding (%25), opeenvolgende slashes (//),
// een letterlijke backslash, puntkomma, of trailing dot/spatie aan het einde van een pad-segment.
const AMBIGUOUS_PATH = /%(2f|5c|2e|25|3b|00)|[\\;\0]|\/\/|(?:\.|\s|%20)(?=\/|$)/i;
const underPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/**
 * Eén regel: `api.github.com` (= https, poort 443, elk pad) of een expliciete oorsprong met optioneel pad-prefix
 * (`http://127.0.0.1:5002`, `https://api.github.com/repos/user/`). Geen wildcards, geen userinfo, query of fragment.
 * Hosts worden door de WHATWG-URL-parser genormaliseerd: kleine letters, IDN als punycode, standaardpoort weg.
 */
export function parseHostRule(text) {
    if (typeof text !== 'string' || !text.trim()) throw invalidHostRule(text, 'empty');
    if (text.includes('*')) throw invalidHostRule(text, 'wildcards are not allowed');
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url;
    try { url = new URL(raw); } catch { throw invalidHostRule(text, 'not a URL'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalidHostRule(text, 'only http and https');
    if (url.username || url.password) throw invalidHostRule(text, 'no userinfo');
    if (url.search || url.hash || raw.includes('?') || raw.includes('#')) throw invalidHostRule(text, 'no query or fragment');
    if (!url.hostname) throw invalidHostRule(text, 'no host');
    if (AMBIGUOUS_PATH.test(url.pathname)) throw invalidHostRule(text, 'no encoded /, \\, ., ; or % in the path');
    const pathPrefix = url.pathname === '/' ? '/' : url.pathname;
    return Object.freeze({ origin: url.origin, host: url.hostname, pathPrefix, text: `${url.origin}${pathPrefix === '/' ? '' : pathPrefix}` });
}

export function parseHostRules(list) {
    if (!Array.isArray(list) || list.length === 0) throw invalidHostRule(list, 'at least one host is required');
    return Object.freeze(list.map(parseHostRule));
}

/**
 * Zelfde oorsprong (schema, host, poort) en, als de regel een pad heeft, een pad onder dat prefix (na normalisatie)
 * zonder dubbelzinnige encoding.
 */
export function targetAllowed(target, rules) {
    if (!rules || !target) return false;
    return rules.some(rule => rule.origin === target.origin
        && (rule.pathPrefix === '/' || (!AMBIGUOUS_PATH.test(target.pathname) && underPrefix(target.pathname, rule.pathPrefix))));
}

/** Niet toegestaan, en alleen omdat er voor deze oorsprong een pad-prefix geldt en het pad dubbelzinnig gecodeerd is. */
export const ambiguousPath = (target, rules) => Boolean(target) && AMBIGUOUS_PATH.test(target.pathname) && !targetAllowed(target, rules)
    && (rules ?? []).some(rule => rule.origin === target.origin && rule.pathPrefix !== '/');

/** De oorsprong waarop een toekenning slaat: tool × secret × host (`https://api.github.com`). */
export const grantHost = target => target.origin;

// ---- client-allowlist ---------------------------------------------------------------------------------

const unmap = address => (typeof address === 'string' && address.startsWith('::ffff:') && net.isIPv4(address.slice(7)) ? address.slice(7) : address);

export function parseClientRule(text) {
    const [address, prefix, ...rest] = String(text ?? '').split('/');
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    if (!family || rest.length) throw invalidClientRule(text, 'expected an IP address or CIDR subnet');
    const max = family === 'ipv4' ? 32 : 128;
    const bits = prefix === undefined ? max : Number(prefix);
    if (!/^\d+$/.test(prefix ?? String(max)) || bits > max) throw invalidClientRule(text, 'bad prefix length');
    if (bits === 0) throw invalidClientRule(text, 'a rule that allows every address is not allowed');
    return Object.freeze({ address, bits, family, text: `${address}/${bits}` });
}

export const parseClientRules = list => Object.freeze((list ?? []).map(parseClientRule));

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** Loopback mag altijd; elk ander adres alleen als het in een regel valt. Onbekend adres: nooit. */
export function clientAllowed(address, rules) {
    const a = unmap(address);
    const family = net.isIPv4(a) ? 'ipv4' : net.isIPv6(a) ? 'ipv6' : null;
    if (!family) return false;
    if (LOOPBACK.check(a, family)) return true;
    const list = new net.BlockList();
    for (const rule of rules ?? []) list.addSubnet(rule.address, rule.bits, rule.family);
    return list.check(a, family);
}

export const isLoopback = address => {
    const a = unmap(address);
    return net.isIPv4(a) ? LOOPBACK.check(a, 'ipv4') : net.isIPv6(a) ? LOOPBACK.check(a, 'ipv6') : false;
};

// ---- de beslistabel -----------------------------------------------------------------------------------------------

const unlocked = ctx => ctx.vaultUnlocked === true;
const hasTool = ctx => Boolean(ctx.tool);
const clientOk = ctx => clientAllowed(ctx.client, ctx.tool?.clients);
const hasSecretRequest = ctx => Boolean(ctx.secret);
const secretKnown = ctx => Boolean(ctx.secret?.hosts);
// Een ander subdomein van een toegestaan domein (`subdomainOf`, door de proxy bepaald) gaat voorlopig door de host-
// controle, maar eindigt altijd bij `subdomain-ask`: de gebruiker beslist, ook als er een toekenning zou bestaan.
const hostOk = ctx => targetAllowed(ctx.target, ctx.secret?.hosts) || Boolean(ctx.subdomainOf);
// Reverse routes geven geen plekken mee: daar kiest de beheerder de header in de route, niet de tool.
// Een lege lijst: nog te leren; de plekken van deze request mogen, als het geldige plekken zijn (geen gereserveerde header).
const locationOk = ctx => !ctx.locations || (ctx.secret.inject?.length === 0 ? learnable(ctx.locations) : injectAllowed(ctx.secret.inject ?? LEGACY_INJECT, ctx.locations));

/**
 * Context: { vaultUnlocked, tool: null | { revoked, clients, rotating, via }, client, secret: null | { name, hosts|null }, target: URL, granted }.
 * Eén secret per beslissing; een request met meerdere plaatshouders gaat per secret door de tabel (eerste weigering wint).
 */
export const ACCESS_RULES = Object.freeze([
    { name: 'vault-locked', when: not(unlocked), then: { allow: false, status: 423 } },
    { name: 'no-tool-key', when: not(hasTool), then: { allow: false, status: 401 } },
    { name: 'tool-key-revoked', when: ctx => ctx.tool.revoked === true, then: { allow: false, status: 401 } },
    // Een tool die roteert, aanvaardt alleen een token; de lange sleutel is alleen voor de uitwisseling (/device/exchange).
    { name: 'token-required', when: ctx => ctx.tool.rotating === true && ctx.tool.via !== 'token', then: { allow: false, status: 401 } },
    { name: 'mcp-tool-required', when: ctx => ctx.tool?.kind === 'mcp' && ctx.protocol !== 'mcp', then: { allow: false, status: 403 } },
    { name: 'web-tool-required', when: ctx => (ctx.tool?.kind ?? 'web') === 'web' && ctx.protocol === 'mcp', then: { allow: false, status: 403 } },
    { name: 'client-not-allowed', when: not(clientOk), then: { allow: false, status: 403 } },
    { name: 'no-placeholder', when: not(hasSecretRequest), then: { allow: false, status: 400 } },
    { name: 'unknown-secret', when: not(secretKnown), then: { allow: false, status: 403 } },
    { name: 'bad-target', when: ctx => ambiguousPath(ctx.target, ctx.secret.hosts), then: { allow: false, status: 400 } },
    { name: 'target-host-not-allowed', when: not(hostOk), then: { allow: false, status: 403 } },
    { name: 'placeholder-location-not-allowed', when: not(locationOk), then: { allow: false, status: 403 } },
    { name: 'quiet-hours', when: ctx => ctx.quietHours === true, then: { allow: false, status: 403 } },
    { name: 'grant-blocked', when: ctx => ctx.blockRule === 'grant-blocked', then: { allow: false, status: 403 } },
    { name: 'secret-blocked', when: ctx => ctx.blockRule === 'secret-blocked', then: { allow: false, status: 403 } },
    { name: 'tool-blocked', when: ctx => ctx.blockRule === 'tool-blocked', then: { allow: false, status: 403 } },
    { name: 'subdomain-ask', when: ctx => Boolean(ctx.subdomainOf), then: { allow: false, ask: true, subdomain: true } },
    { name: 'auth-shape-changed', when: ctx => ctx.authShapeMismatch === true, then: { allow: false, ask: true, authShape: true } },
    { name: 'granted', when: ctx => ctx.granted === true, then: { allow: true, status: 200 } },
    // 3.4: een toekenning met een einde dat voorbij is, vraagt opnieuw (met haar eigen naam in de audit en de log).
    { name: 'grant-expired', when: ctx => ctx.grantExpired === true, then: { allow: false, ask: true } },
    { name: 'needs-approval', when: () => true, then: { allow: false, ask: true } },
]);

export const decideAccess = ctx => decide(ctx, ACCESS_RULES);

/** Identiteit en herkomst, vóór er naar secrets gekeken wordt: de eerste zeven regels van dezelfde tabel, plus een standaard. */
const CALLER_RULES = Object.freeze([...ACCESS_RULES.slice(0, 7), { name: 'caller-ok', when: () => true, then: { allow: true } }]);
export const decideCaller = ctx => decide(ctx, CALLER_RULES);
