// De root van de certificaatketen van een host bekijken, zonder request: alleen een TLS-handshake, dan meteen dicht.
// Er gaat niets mee (geen secret, geen pad); de host ziet wel dat deze pc verbindt. Gebruikt bij een nieuw subdomein om
// te tonen of het dezelfde root heeft als het toegestane domein (informatief, geen garantie).
import tls from 'node:tls';

/**
 * @param {URL} url een https-adres
 * @param {string[]} ca vertrouwde roots
 * @param {number} [timeoutMs]
 * @returns {Promise<string|null>} de vingerafdruk van de root, of null (geen https, geen antwoord, geen keten)
 */
export function peekRoot(url, ca, timeoutMs = 2_500) {
    if (url.protocol !== 'https:') return Promise.resolve(null);
    return new Promise(resolve => {
        const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, ca, rejectUnauthorized: false });
        const done = value => { socket.destroy(); resolve(value); };
        socket.setTimeout(timeoutMs, () => done(null));
        socket.once('error', () => done(null));
        socket.once('secureConnect', () => {
            // Alleen een keten die tot een vertrouwde root loopt, heeft een root; anders stopt ze bij een tussencertificaat.
            if (!socket.authorized) { done(null); return; }
            let current = socket.getPeerCertificate(true);
            const seen = new Set();
            while (current?.issuerCertificate && current.issuerCertificate !== current && !seen.has(current.fingerprint256)) {
                seen.add(current.fingerprint256);
                current = current.issuerCertificate;
            }
            done(current?.fingerprint256 ?? null);
        });
    });
}
