// Man-in-the-middle en spoofing. De proxy vertrouwt alleen roots uit de lijst van geldige roots (root-store.js): wat Node
// meelevert, NODE_EXTRA_CA_CERTS en de systeemstore zoals ze was bij de eerste start. Alleen de root telt: per doelhost
// onthoudt Vaultgate de root (en, ter info, de uitgever van het blad). Een ander tussencertificaat onder dezelfde root, of een
// andere leverancier met een geldige root, geeft geen melding (wel een audit-regel bij een andere root). Een root buiten de
// lijst faalt al tijdens de handshake: er vertrekt geen byte, dus ook geen secret, tot de gebruiker ze in het portaal vertrouwt.
import tls from 'node:tls';
import { decide } from '../decision/index.js';
import { peekRoot } from './root-probe.js';
import { createRootStore } from './root-store.js';
import { chainIdentity, rootCert } from './identity.js';

export { createRootStore, NODE_STORES } from './root-store.js';
export { chainIdentity } from './identity.js';

export const TLS_CHAIN_CHANGED = 'TLS_CHAIN_CHANGED';

/**
 * Beslisregels voor een keten: eerste keer onthouden, dezelfde root = ok (een nieuwe uitgever wordt onthouden), een andere
 * root uit de lijst = ok (andere leverancier), anders gewijzigd (standaard dicht). ctx.listed: staat de root in de lijst?
 */
export const CHAIN_RULES = Object.freeze([
    { name: 'tls-first-use', when: ctx => !ctx.pin, then: { allow: true, remember: true } },
    { name: 'tls-chain-known', when: ctx => ctx.pin.root === ctx.observed.root && ctx.pin.issuer === ctx.observed.issuer, then: { allow: true } },
    { name: 'tls-issuer-renewed', when: ctx => ctx.pin.root === ctx.observed.root, then: { allow: true, remember: true } },
    { name: 'tls-root-switched', when: ctx => ctx.listed === true, then: { allow: true, remember: true, audit: true } },
    { name: 'tls-chain-changed', when: () => true, then: { allow: false, status: 502 } },
]);

export const decideChain = ctx => decide(ctx, CHAIN_RULES);

/**
 * @param {{ registry: { getTlsPin(origin): Promise<object|null>, setTlsPin(origin, identity): Promise<void> },
 *           audit: { append(entry): Promise<void> }, clock: { now(): number }, extraCa?: string[], stores?: object, log?: Function }} deps
 */
export function createTlsTrust({ registry, audit, clock, extraCa = [], stores, log = () => {} }) {
    const rootStore = createRootStore({ registry, stores, extraCa });
    const changes = new Map(); // origin -> { origin, pinned, observed, since }
    const untrusted = new Map(); // origin -> { origin, observed, rootPem, validFrom, validTo, since }
    const overrides = new Map(); // origin -> { caPem, fingerprint, root, issuer }
    // Pins die in dit proces al vastgelegd zijn. Synchroon bijgewerkt bij de handshake: de opslag in de kluis is asynchroon,
    // en een request die intussen "geen pin" ophaalde, mag geen tweede "eerste gebruik" worden (gevonden door 9.16).
    const known = new Map();

    const getTlsException = registry.getTlsException ? origin => registry.getTlsException(origin) : async () => null;
    const setTlsException = registry.setTlsException ? (origin, value) => registry.setTlsException(origin, value) : async () => {};
    const removeTlsException = registry.removeTlsException ? origin => registry.removeTlsException(origin) : async () => {};
    const listTlsExceptions = registry.listTlsExceptions ? () => registry.listTlsExceptions() : async () => [];

    const pem = raw => `-----BEGIN CERTIFICATE-----\n${(Buffer.from(raw).toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END CERTIFICATE-----\n`;

    async function trustedCaFor(origin) {
        for (const [k, sc] of [[origin, undefined], ['*', 'global']]) {
            if (overrides.has(k)) return overrides.get(k);
            const s = await getTlsException(k);
            if (s?.caPem || s?.fingerprint) {
                const t = { caPem: s.caPem ?? null, fingerprint: s.fingerprint ?? null, root: s.root ?? null, issuer: s.issuer ?? null, ...(sc ? { scope: sc, origin: '*' } : {}) };
                overrides.set(k, t);
                return t;
            }
        }
        return null;
    }

    /** TLS-opties naar `url`, met de (vooraf opgehaalde) pin, uitzondering en lijst van geldige roots (`roots()`). */
    function requestOptions(url, pin, trustedOverride = null, roots = rootStore.base) {
        const origin = url.origin;
        const trusted = trustedOverride?.caPem ? [...roots.ca, trustedOverride.caPem] : roots.ca;
        return {
            ca: trusted,
            ...(trustedOverride?.fingerprint ? { rejectUnauthorized: false, acceptedFingerprint: trustedOverride.fingerprint } : {}),
            agent: false, // geen hergebruikte verbinding: elke request controleert de keten opnieuw
            checkServerIdentity(host, cert) {
                const hostError = tls.checkServerIdentity(host, cert);
                if (hostError) return hostError;
                const observed = {
                    ...chainIdentity(cert),
                    fingerprint: cert.fingerprint256 ?? null,
                    validFrom: cert.valid_from ?? null,
                    validTo: cert.valid_to ?? null,
                };
                const pinned = known.get(origin) ?? pin;
                const listed = roots.fingerprints.has(observed.root) || trustedOverride?.root === observed.root;
                const decision = decideChain({ pin: pinned, observed, listed });
                if (decision.remember) {
                    known.set(origin, observed);
                    registry.setTlsPin(origin, observed).catch(error => log({ event: 'tls-pin-failed', code: error.code ?? 'unknown' }));
                }
                if (decision.audit) audit.append({ mode: 'tls', host: origin, allow: true, rule: decision.rule, detail: `${pinned.root} -> ${observed.root}` }).catch(() => {});
                if (decision.allow) return undefined;
                if (!changes.has(origin)) {
                    changes.set(origin, { origin, pinned, observed, since: clock.now() });
                    audit.append({ mode: 'tls', host: origin, allow: false, rule: 'tls-chain-changed', detail: `${pinned.issuer} -> ${observed.issuer}` }).catch(() => {});
                    log({ event: 'tls-chain-changed', host: origin });
                }
                return Object.assign(new Error(`certificate chain of ${origin} changed`), { code: TLS_CHAIN_CHANGED });
            },
        };
    }

    /** Noteert genoeg info over een `tls-untrusted` host zodat dezelfde accept-flow in het portaal kan werken. */
    async function noteUntrusted(target) {
        if (untrusted.has(target.origin)) return;
        try {
            const observed = await new Promise((resolve, reject) => {
                const socket = tls.connect({
                    host: target.hostname,
                    port: Number(target.port) || 443,
                    servername: target.hostname,
                    rejectUnauthorized: false,
                }, () => {
                    const cert = socket.getPeerCertificate(true);
                    socket.end();
                    if (!cert?.fingerprint256) { reject(new Error('no certificate')); return; }
                    const root = rootCert(cert);
                    if (!root?.raw) { reject(new Error('no root certificate raw data')); return; }
                    resolve({
                        issuer: chainIdentity(cert).issuer, root: root.fingerprint256,
                        fingerprint: cert.fingerprint256, rootPem: pem(root.raw),
                        validFrom: cert.valid_from ?? null, validTo: cert.valid_to ?? null,
                    });
                });
                socket.once('error', reject);
            });
            const pinned = known.get(target.origin) ?? (registry.getTlsPin ? await registry.getTlsPin(target.origin) : null);
            untrusted.set(target.origin, { origin: target.origin, pinned, observed, since: clock.now() });
            await audit.append({ mode: 'tls', host: target.origin, allow: false, rule: 'tls-untrusted', detail: observed.issuer });
            log({ event: 'tls-untrusted', host: target.origin });
        } catch (error) {
            log({ event: 'tls-untrusted-capture-failed', host: target.origin, code: error.code ?? 'unknown' });
        }
    }

    /** De gebruiker vertrouwt de nieuwe keten (portaal); de volgende request gaat weer door. Beheer: mode 'admin' in de audit. */
    async function accept(origin, { scope = 'host' } = {}) {
        const change = changes.get(origin);
        if (change) {
            await registry.setTlsPin(origin, change.observed);
            known.set(origin, change.observed); changes.delete(origin);
            await audit.append({ mode: 'admin', origin: 'portal', host: origin, allow: true, rule: 'tls-chain-accepted', detail: `issuer: ${change.pinned.issuer} → ${change.observed.issuer}` });
            return;
        }
        const pending = untrusted.get(origin);
        if (!pending) throw Object.assign(new Error(`no pending certificate change for ${origin}`), { code: 'NOT_FOUND' });
        const targetKey = scope === 'global' ? '*' : origin;
        const trustedData = {
            caPem: pending.observed.rootPem, fingerprint: pending.observed.fingerprint,
            root: pending.observed.root, issuer: pending.observed.issuer,
            validFrom: pending.observed.validFrom, validTo: pending.observed.validTo,
            scope, origin: targetKey,
        };
        overrides.set(targetKey, trustedData);
        if (scope === 'global') overrides.set(origin, trustedData);
        await setTlsException(targetKey, trustedData);
        untrusted.delete(origin);
        await audit.append({ mode: 'admin', origin: 'portal', host: origin, allow: true, rule: 'tls-untrusted-accepted', detail: `trusted root (${scope}): – → ${pending.observed.issuer}` });
    }

    async function revoke(originOrRoot) {
        overrides.delete(originOrRoot);
        if (originOrRoot === '*') overrides.clear();
        for (const [k, v] of overrides.entries()) if (v.root === originOrRoot || v.origin === originOrRoot) overrides.delete(k);
        await removeTlsException(originOrRoot);
        await audit.append({ mode: 'admin', origin: 'portal', host: originOrRoot, allow: true, rule: 'tls-exception-revoked', detail: `revoked: ${originOrRoot}` });
    }

    /** Heeft `target` dezelfde certificaat-root als het toegestane `allowedHost`? 'same', 'different' of 'unknown'. */
    async function compareRoot(target, allowedHost) {
        const allowed = new URL(`${target.protocol}//${allowedHost}${target.port ? `:${target.port}` : ''}`);
        const { ca } = await rootStore.current();
        const [theirs, ours] = await Promise.all([peekRoot(target, ca), (known.get(allowed.origin) ?? (await registry.getTlsPin(allowed.origin)))?.root ?? peekRoot(allowed, ca)]);
        return !theirs || !ours ? 'unknown' : theirs === ours ? 'same' : 'different';
    }

    return Object.freeze({
        pinFor: async origin => known.get(origin) ?? registry.getTlsPin(origin),
        roots: () => rootStore.current(),
        addedRoots: async () => (await rootStore.current()).added,
        compareRoot,
        trustedCaFor,
        requestOptions,
        noteUntrusted,
        accept,
        revoke,
        trustedRoots: async () => listTlsExceptions(),
        pendingChanges: () => {
            const mapEntry = (c, kind) => {
                const p = c.pinned, o = c.observed;
                return {
                    origin: c.origin, kind, since: c.since,
                    pinnedIssuer: p ? p.issuer : null, observedIssuer: o.issuer,
                    pinnedRoot: p ? p.root : null, observedRoot: o.root,
                    pinnedFingerprint: p ? p.fingerprint : null, observedFingerprint: o.fingerprint, fingerprint: o.fingerprint,
                    pinnedValidTo: p ? p.validTo : null, observedValidTo: o.validTo, validTo: o.validTo, validFrom: o.validFrom,
                };
            };
            return [...[...changes.values()].map(c => mapEntry(c, 'tls-chain-changed')), ...[...untrusted.values()].map(c => mapEntry(c, 'tls-untrusted'))];
        },
    });
}
