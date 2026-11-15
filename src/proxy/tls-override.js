// De TLS-kant van de proxy: de verbinding naar een https-doelhost openen en de keten controleren vóór er iets ontsleuteld
// wordt. Een geweigerde keten krijgt een eigen regel (tls-chain-changed of tls-untrusted) en ziet nooit een waarde.
import net from 'node:net';
import tls from 'node:tls';
import { validateTarget } from './ssrf.js';

const TLS_UNTRUSTED = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

/** De regel voor een verbindingsfout: een gewijzigde of onvertrouwde keten, of een doelhost die niet bereikbaar is. */
export const tlsRule = error => (error?.code === 'TLS_CHAIN_CHANGED' ? 'tls-chain-changed' : TLS_UNTRUSTED.has(error?.code) ? 'tls-untrusted' : 'upstream-error');

/** TLS-opties voor een doelhost: pin, optionele vertrouwde uitzondering per oorsprong en de lijst van geldige roots. */
export async function tlsOptionsFor(tlsTrust, target) {
    if (!tlsTrust || target.protocol !== 'https:') return {};
    const [pin, trusted, roots] = await Promise.all([tlsTrust.pinFor(target.origin), tlsTrust.trustedCaFor(target.origin), tlsTrust.roots()]);
    return tlsTrust.requestOptions(target, pin, trusted, roots);
}

/** Bij een handmatige uitzondering blijft de hostcontrole actief en geldt alleen de vertrouwde vingerafdruk. */
export function fingerprintError(url, cert, acceptedFingerprint) {
    if (!acceptedFingerprint) return undefined;
    const hostError = tls.checkServerIdentity(url.hostname, cert);
    if (hostError) return hostError;
    return cert?.fingerprint256 === acceptedFingerprint ? undefined : Object.assign(new Error(`certificate fingerprint of ${url.origin} changed`), { code: 'TLS_CHAIN_CHANGED' });
}

/**
 * Opties om de request over de al gecontroleerde `socket` te sturen. Zonder agent rekent Node met poort 80 en zet dan
 * `Host: api.github.com:80` voor https, wat GitHub weigert (400): daarom de standaardpoort van het protocol.
 */
export const overSocket = (url, socket) => (socket ? { createConnection: () => socket, defaultPort: url.protocol === 'https:' ? 443 : 80 } : {});

/**
 * Opent de TLS-verbinding naar `target` en wacht tot de keten gecontroleerd is (tijdens de handshake).
 * @returns {Promise<{ socket?: tls.TLSSocket, rule?: string, status?: number, detail?: string }>} een socket, een weigerregel, of niets (geen https)
 */
export async function connectUpstream(tlsTrust, target, options = {}) {
    const ssrf = await validateTarget(target, options);
    if (ssrf.blocked) return { rule: ssrf.rule, status: ssrf.status, detail: ssrf.detail };
    if (!tlsTrust || target.protocol !== 'https:') return {};
    const { acceptedFingerprint, ...tlsOpts } = await tlsOptionsFor(tlsTrust, target);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    try {
        const socket = await new Promise((resolve, reject) => {
            const s = tls.connect({ ...tlsOpts, host, port: Number(target.port) || 443, servername: net.isIP(host) ? '' : host });
            s.once('error', reject);
            s.once('secureConnect', () => {
                const error = fingerprintError(target, s.getPeerCertificate(true), acceptedFingerprint);
                if (error) { s.destroy(); reject(error); return; }
                s.removeListener('error', reject);
                s.on('error', () => {}); // een fout vóór de request de socket overneemt (bv. tijdens het ontsleutelen): geen crash
                resolve(s);
            });
        });
        return { socket };
    } catch (error) {
        const rule = tlsRule(error);
        if (rule === 'tls-untrusted') tlsTrust.noteUntrusted(target).catch(() => {});
        return { rule };
    }
}
