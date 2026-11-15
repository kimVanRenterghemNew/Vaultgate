// De lijst van geldige roots. Geldig: wat Node meelevert (de Mozilla-lijst), NODE_EXTRA_CA_CERTS (expliciet meegegeven,
// bv. een bedrijfsroot) en de systeemstore zoals ze was bij de eerste start: een momentopname, versleuteld in de kluis.
// Een root die daarna in de systeemstore bijkwam, telt niet: een stil geïnstalleerde root wordt zo geen stille onderschepper.
// Zo'n root staat bij `added`, zodat het portaal kan tonen wat er sinds de momentopname bijkwam.
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

/** De stores van Node. Niet 'default': met --use-system-ca bevat die ook de systeemstore, buiten de momentopname om. */
export const NODE_STORES = Object.freeze({
    bundled: () => tls.getCACertificates('bundled'),
    extra: () => tls.getCACertificates('extra'),
    system: () => tls.getCACertificates('system'),
});

/** @returns {{ pem: string, fingerprint: string, subject: string } | null} null voor wat geen certificaat is */
function describeCert(pem) {
    try {
        const cert = new X509Certificate(pem);
        return { pem, fingerprint: cert.fingerprint256, subject: cert.subject };
    } catch {
        return null;
    }
}

/**
 * @param {{ registry: { getRootSnapshot?(): Promise<string[]|null>, setRootSnapshot?(list: string[]): Promise<void> },
 *           stores?: typeof NODE_STORES, extraCa?: string[] }} deps
 */
export function createRootStore({ registry, stores = NODE_STORES, extraCa = [] }) {
    const ca = [...new Set([...stores.bundled(), ...stores.extra(), ...extraCa])];
    const base = Object.freeze({ ca, fingerprints: new Set(ca.map(describeCert).filter(Boolean).map(c => c.fingerprint)), added: [] });
    let loading = null;

    async function load() {
        const system = stores.system().map(describeCert).filter(Boolean);
        let snapshot = registry.getRootSnapshot ? await registry.getRootSnapshot() : null;
        if (!snapshot && registry.getRootSnapshot && registry.setRootSnapshot) {
            snapshot = system.map(c => c.fingerprint);
            await registry.setRootSnapshot(snapshot);
        }
        // Zonder momentopname-poort telt geen enkele systeemroot (standaard dicht).
        const known = new Set(snapshot ?? []);
        const kept = system.filter(c => known.has(c.fingerprint));
        return Object.freeze({
            ca: [...new Set([...base.ca, ...kept.map(c => c.pem)])],
            fingerprints: new Set([...base.fingerprints, ...kept.map(c => c.fingerprint)]),
            // Een systeemkopie van een root die Node zelf meelevert, is niet nieuw.
            added: system.filter(c => !known.has(c.fingerprint) && !base.fingerprints.has(c.fingerprint)).map(({ fingerprint, subject }) => ({ fingerprint, subject })),
        });
    }

    return Object.freeze({
        /** Zonder kluis: alleen Node en NODE_EXTRA_CA_CERTS. */
        base,
        /** Met de momentopname (eenmaal geladen; een mislukte lading, bv. een vergrendelde kluis, wordt later opnieuw geprobeerd). */
        current: () => (loading ??= load().catch(error => { loading = null; throw error; })),
    });
}
