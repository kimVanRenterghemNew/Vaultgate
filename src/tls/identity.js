// Identiteit van een certificaatketen: uitgever en fingerprint van de root.
const formatName = name => Object.entries(name ?? {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`).join(', ');

/** Het laatste certificaat van de keten (de root), ook als de keten een lus bevat. */
export function rootCert(cert) {
    let current = cert;
    const seen = new Set();
    while (current?.issuerCertificate && current.issuerCertificate !== current && !seen.has(current.fingerprint256)) {
        seen.add(current.fingerprint256);
        current = current.issuerCertificate;
    }
    return current;
}

/**
 * Identiteit van een keten zoals Node ze aan `checkServerIdentity` geeft (`issuerCertificate` tot aan de root).
 * @returns {{ issuer: string, root: string }}
 */
export function chainIdentity(cert) {
    return { issuer: formatName(cert.issuer), root: rootCert(cert).fingerprint256 };
}
