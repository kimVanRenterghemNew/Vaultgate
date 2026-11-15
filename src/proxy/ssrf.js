// SSRF-bescherming: controleert of een doelhost niet uitkomt op beschermde adressen
// zoals cloud-metadata (169.254.169.254, fe80::/10) of onbedoelde loopback.
import net from 'node:net';
import dns from 'node:dns/promises';
import { isLoopback } from '../policy/index.js';

/**
 * Controleert of een IP-adres verboden is voor uitgaande proxy-calls.
 * @param {string} ip
 * @param {{ allowLoopback?: boolean }} options
 */
export function isProhibitedIp(ip, { allowLoopback = false } = {}) {
    if (!ip || typeof ip !== 'string') return true;
    const clean = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
    // Link-local / Cloud metadata: 169.254.0.0/16 en fe80::/10
    if (clean.startsWith('169.254.') || /^fe[89ab][0-9a-f]:/i.test(clean)) return true;
    // Loopback: 127.0.0.0/8 en ::1 (behalve als de doelregel expliciet loopback toestaat)
    if (!allowLoopback && isLoopback(clean)) return true;
    return false;
}

/**
 * Valideert de bestemming van target via DNS-lookup vóór er verbinding wordt gemaakt.
 * @param {URL} target
 * @param {{ lookup?: Function }} options
 * @returns {Promise<{ blocked: boolean, ip?: string, rule?: string, status?: number, detail?: string }>}
 */
export async function validateTarget(target, { lookup = dns.lookup } = {}) {
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const allowLoopback = isLoopback(host) || host === 'localhost';

    if (net.isIP(host)) {
        if (isProhibitedIp(host, { allowLoopback })) {
            return { blocked: true, ip: host, rule: 'ssrf-target-blocked', status: 403, detail: host };
        }
        return { blocked: false, ip: host };
    }

    try {
        const records = await lookup(host, { all: true });
        for (const r of records) {
            if (isProhibitedIp(r.address, { allowLoopback })) {
                return { blocked: true, ip: r.address, rule: 'ssrf-target-blocked', status: 403, detail: r.address };
            }
        }
        return { blocked: false, ip: records[0]?.address };
    } catch {
        // DNS mislukt: connectUpstream of http.request laat dit afhandelen als upstream-error
        return { blocked: false, ip: null };
    }
}
