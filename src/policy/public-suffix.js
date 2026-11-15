// Het registreerbare domein van een host volgens de Public Suffix List (data in `public-suffix-list.dat`, geen
// dependency). Gebruikt om een subdomein van een toegestaan domein te herkennen: daarvoor komt een vraag, nooit een
// stille toelating.
import fs from 'node:fs';
import net from 'node:net';
import { domainToASCII } from 'node:url';

const LIST = new URL('./public-suffix-list.dat', import.meta.url);

let rules = null;
function load() {
    if (rules) return rules;
    rules = { exact: new Set(), wild: new Set(), except: new Set() };
    for (const line of fs.readFileSync(LIST, 'utf8').split('\n')) {
        const text = line.trim();
        if (!text || text.startsWith('//')) continue;
        if (text.startsWith('!')) rules.except.add(domainToASCII(text.slice(1)));
        else if (text.startsWith('*.')) rules.wild.add(domainToASCII(text.slice(2)));
        else rules.exact.add(domainToASCII(text));
    }
    return rules;
}

/** Het registreerbare domein (`api.github.com` -> `github.com`), of null voor een suffix, een IP-adres of één label. */
export function registrableDomain(host) {
    const name = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!name || net.isIP(name) || !name.includes('.')) return null;
    const labels = name.split('.');
    const { exact, wild, except } = load();
    let suffixLength = 1; // geen regel: het laatste label (de standaardregel "*")
    for (let i = 0; i < labels.length; i++) {
        const candidate = labels.slice(i).join('.');
        if (except.has(candidate)) { suffixLength = labels.length - i - 1; break; }
        if (exact.has(candidate)) { suffixLength = labels.length - i; break; }
        if (i + 1 < labels.length && wild.has(labels.slice(i + 1).join('.'))) { suffixLength = labels.length - i; break; }
    }
    return labels.length > suffixLength ? labels.slice(-(suffixLength + 1)).join('.') : null;
}

/**
 * Het toegestane domein (`api.github.com`) waarvan `target` een ander subdomein is:
 * zelfde schema, poort en registreerbare domeinnaam. Null als er geen is, of als de host al toegestaan is.
 * @param {URL} target
 * @param {{ origin: string, host: string }[]|null} hostRules
 */
export function sameSiteAs(target, hostRules) {
    const site = registrableDomain(target.hostname);
    if (!site || !hostRules) return null;
    if (hostRules.some(r => r.origin === target.origin)) return null;
    const match = hostRules.find(r => {
        if (r.host === target.hostname) return false;
        const u = new URL(r.origin);
        if (u.protocol !== target.protocol || u.port !== target.port) return false;
        return registrableDomain(r.host) === site;
    });
    return match ? match.host : null;
}
