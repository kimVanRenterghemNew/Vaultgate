// Instellingen (time-outs, luisteradressen, routes, aanraken), TLS-pins per doelhost en de momentopname van de
// systeemstore. Deel van de registry.
import net from 'node:net';
import { parseHostRules, parseQuietHours } from '../policy/index.js';

const DEFAULT_SETTINGS = Object.freeze({
    approvalTimeoutMs: 30_000,
    autoLockMs: 15 * 60_000,
    listeners: [],
    routes: [],
    touchAuthenticator: 'any',
    quietHours: [],
    blocks: [],
    notificationSnooze: { globalUntil: null, grants: [] },
    rotationNoticeMs: 8 * 60 * 60_000, // hoogstens één melding "key geroteerd" per tool per zoveel tijd
});
const TOUCH_AUTHENTICATORS = new Set(['any', 'external']); // 9.17
const ROUTE_HEADERS = new Set(['x-api-key', 'authorization', 'x-goog-api-key', 'basic']); // basic: git over HTTPS
const BLOCK_KINDS = new Set(['tool', 'grant', 'secret', 'passkey']);
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const normalizeTime = (value, what, bad) => {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) throw bad(`${what} must be a timestamp or null`);
    return Number(value);
};

function normalizeBlock(block, { bad, checkName }) {
    if (!block || typeof block !== 'object') throw bad('block must be an object');
    const kind = String(block.kind ?? '');
    if (!BLOCK_KINDS.has(kind)) throw bad('block kind must be tool, grant, secret or passkey');
    const id = String(block.id ?? '');
    if (!SIMPLE_ID.test(id)) throw bad('block id invalid');
    const until = normalizeTime(block.until, 'block.until', bad);
    if (kind === 'tool') {
        const toolId = String(block.toolId ?? '');
        if (!SIMPLE_ID.test(toolId)) throw bad('tool block needs a valid toolId');
        return { id, kind, toolId, until };
    }
    if (kind === 'secret') {
        const secretName = checkName(block.secretName);
        return { id, kind, secretName, until };
    }
    if (kind === 'grant') {
        const toolId = String(block.toolId ?? '');
        if (!SIMPLE_ID.test(toolId)) throw bad('grant block needs a valid toolId');
        const secretName = checkName(block.secretName);
        const host = parseHostRules([block.host])[0].origin;
        return { id, kind, toolId, secretName, host, until };
    }
    const passkeyId = String(block.passkeyId ?? '');
    if (!SIMPLE_ID.test(passkeyId)) throw bad('passkey block needs a valid passkeyId');
    return { id, kind, passkeyId, until };
}

function normalizeSnooze(input, bad) {
    if (input === undefined || input === null) return { globalUntil: null, grants: [] };
    if (typeof input !== 'object' || Array.isArray(input)) throw bad('notificationSnooze must be an object');
    const globalUntil = normalizeTime(input.globalUntil, 'notificationSnooze.globalUntil', bad);
    if (!Array.isArray(input.grants)) throw bad('notificationSnooze.grants must be a list');
    const grants = input.grants.map(item => {
        if (!item || typeof item !== 'object') throw bad('notificationSnooze grant must be an object');
        const grantId = String(item.grantId ?? '');
        if (!SIMPLE_ID.test(grantId)) throw bad('notificationSnooze grantId invalid');
        return { grantId, until: normalizeTime(item.until, 'notificationSnooze grants[].until', bad) };
    });
    return { globalUntil, grants };
}

/** @param {{ vault, clock, all: Function, checkName: Function, tagged: Function }} deps */
export function createSettings({ vault, clock, all, checkName, tagged }) {
    function checkSettings(s) {
        const bad = why => tagged('INVALID_SETTING', why);
        if (!Number.isInteger(s.approvalTimeoutMs) || s.approvalTimeoutMs < 1000 || s.approvalTimeoutMs > 600_000) throw bad('approvalTimeoutMs: 1000..600000');
        if (!Number.isInteger(s.autoLockMs) || s.autoLockMs < 10_000) throw bad('autoLockMs: at least 10000');
        if (!Number.isInteger(s.rotationNoticeMs) || s.rotationNoticeMs < 0) throw bad('rotationNoticeMs: 0 or more milliseconds');
        if (!Array.isArray(s.listeners)) throw bad('listeners must be a list');
        for (const l of s.listeners) {
            // Een extra luisteradres is altijd een concreet adres: nooit 0.0.0.0 of :: (eis 4: expliciet).
            if (!net.isIP(l?.host) || ['0.0.0.0', '::'].includes(l.host)) throw bad(`listener host must be a specific IP address, got ${l?.host}`);
            if (!Number.isInteger(l.port) || l.port < 1 || l.port > 65535) throw bad(`listener port invalid: ${l.port}`);
        }
        if (!TOUCH_AUTHENTICATORS.has(s.touchAuthenticator)) throw bad('touchAuthenticator: any or external');
        if (!Array.isArray(s.routes)) throw bad('routes must be a list');
        for (const r of s.routes) {
            if (!/^[a-z0-9-]{1,32}$/.test(r?.name ?? '') || r.name === 'forward') throw bad(`route name invalid: ${r?.name}`);
            if (!ROUTE_HEADERS.has(r.header)) throw bad(`route header must be one of ${[...ROUTE_HEADERS].join(', ')}`);
            checkName(r.secret);
            try { parseHostRules([r.base]); } catch { throw bad(`route base invalid: ${r.base}`); }
        }
        const quietHours = parseQuietHours(s.quietHours ?? []).map(w => w.text);
        if (!Array.isArray(s.blocks)) throw bad('blocks must be a list');
        const blocks = s.blocks.map(block => normalizeBlock(block, { bad, checkName }));
        const ids = blocks.map(b => b.id);
        if (new Set(ids).size !== ids.length) throw bad('block id must be unique');
        const notificationSnooze = normalizeSnooze(s.notificationSnooze, bad);
        return { ...s, quietHours, blocks, notificationSnooze };
    }

    async function settingsRecord() {
        return (await all('settings', ['values']))[0] ?? null;
    }

    async function getSettings() {
        const record = await settingsRecord();
        return checkSettings({ ...DEFAULT_SETTINGS, ...(record?.values ?? {}) });
    }

    async function updateSettings(patch) {
        const next = checkSettings({ ...(await getSettings()), ...patch });
        const record = await settingsRecord();
        await vault.put({ kind: 'settings', values: next }, record?.id);
        return next;
    }

    // ---- TLS-pins: de eerste geziene keten per doelhost, versleuteld zoals alles -------------------------

    async function getTlsPin(origin) {
        const found = (await all('tlspin', ['origin', 'issuer', 'root', 'fingerprint', 'validFrom', 'validTo'])).find(p => p.origin === origin);
        return found ? {
            issuer: found.issuer, root: found.root,
            ...(found.fingerprint ? { fingerprint: found.fingerprint } : {}),
            ...(found.validFrom ? { validFrom: found.validFrom } : {}),
            ...(found.validTo ? { validTo: found.validTo } : {}),
        } : null;
    }

    async function setTlsPin(origin, { issuer, root, fingerprint = null, validFrom = null, validTo = null }) {
        const existing = (await all('tlspin', ['origin'])).find(p => p.origin === origin);
        await vault.put({ kind: 'tlspin', origin, issuer, root, fingerprint, validFrom, validTo, updatedAt: clock.now() }, existing?.id);
    }

    // ---- TLS-uitzonderingen: expliciet vertrouwde root per doelhost --------------------------------------------

    async function getTlsException(origin) {
        const found = (await all('tlsexception', ['origin', 'caPem', 'issuer', 'root', 'fingerprint', 'validFrom', 'validTo', 'scope', 'updatedAt'])).find(p => p.origin === origin);
        return found ? {
            caPem: found.caPem,
            issuer: found.issuer,
            root: found.root,
            fingerprint: found.fingerprint ?? null,
            validFrom: found.validFrom ?? null,
            validTo: found.validTo ?? null,
        } : null;
    }

    async function listTlsExceptions() {
        return (await all('tlsexception', ['origin', 'caPem', 'issuer', 'root', 'fingerprint', 'validFrom', 'validTo', 'scope', 'updatedAt'])).map(found => ({
            origin: found.origin,
            issuer: found.issuer,
            root: found.root,
            fingerprint: found.fingerprint || null,
            validFrom: found.validFrom || null,
            validTo: found.validTo || null,
            scope: found.scope || 'host',
            updatedAt: found.updatedAt,
        }));
    }

    async function setTlsException(origin, value) {
        const existing = (await all('tlsexception', ['origin'])).find(p => p.origin === origin);
        await vault.put({
            kind: 'tlsexception',
            origin,
            caPem: String(value.caPem),
            issuer: String(value.issuer ?? ''),
            root: String(value.root ?? ''),
            fingerprint: value.fingerprint ?? null,
            validFrom: value.validFrom ?? null,
            validTo: value.validTo ?? null,
            scope: value.scope ?? (origin === '*' ? 'global' : 'host'),
            updatedAt: clock.now(),
        }, existing?.id);
    }

    async function removeTlsException(originOrRoot) {
        const records = await all('tlsexception', ['origin', 'root']);
        for (const r of records) {
            if (r.origin === originOrRoot || r.root === originOrRoot) {
                await vault.remove(r.id);
            }
        }
    }

    // ---- Momentopname van de systeemstore bij de eerste start: welke roots er toen al waren (vingerafdrukken) ----

    /** @returns {Promise<string[]|null>} de vingerafdrukken, of null als er nog geen momentopname is */
    async function getRootSnapshot() {
        const found = (await all('rootsnapshot', ['fingerprints']))[0];
        return found ? [...found.fingerprints] : null;
    }

    /** @param {string[]} fingerprints */
    async function setRootSnapshot(fingerprints) {
        const existing = (await all('rootsnapshot', []))[0];
        await vault.put({ kind: 'rootsnapshot', fingerprints: fingerprints.map(String), takenAt: clock.now() }, existing?.id);
    }

    return Object.freeze({ getSettings, updateSettings, getTlsPin, setTlsPin, getTlsException, listTlsExceptions, setTlsException, removeTlsException, getRootSnapshot, setRootSnapshot });
}
