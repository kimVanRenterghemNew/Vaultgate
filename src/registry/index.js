// Het domein van Vaultgate bovenop de kluis: secrets (naam, waarde, doelhost-allowlist), tools (naam, key-hash,
// client-allowlist, ingetrokken), toekenningen tool × secret × host (herkomst portaal of tray) en instellingen.
// Alles is een kluisrecord, dus versleuteld op schijf. Geen enkele lijst of lookup geeft een secret-waarde terug; alleen
// `secretValue` doet dat, voor de proxy, op het moment van invullen.
import { parseHostRules, parseClientRules, parseInjectPlaces, DEFAULT_INJECT } from '../policy/index.js';
import { createGrants } from './grants.js';
import { createSettings } from './settings.js';
import { createRename } from './rename.js';
import { createPasskeyMeta } from './passkey-meta.js';
import { createKeyRotation } from './key-rotation.js';
import { createToolPairing, isPairable } from './tool-pairing.js';

export const DUPLICATE_NAME = 'DUPLICATE_NAME';
export const INVALID_NAME = 'INVALID_NAME';
export const NOT_FOUND = 'NOT_FOUND';
export { TOKEN_MS } from './tool-sessions.js';
export { EXCHANGE_RULES } from './key-rotation.js';

const tagged = (code, message) => Object.assign(new Error(message), { code });
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

// Zonder crypto (tests van alleen secrets) faalt pas het maken van een key, luid: nooit een zwakke key.
const NO_CRYPTO = new Proxy({}, { get: () => () => { throw new Error('registry needs crypto.randomToken to create tool keys'); } });
const checkName = name => { if (typeof name !== 'string' || !NAME.test(name)) throw tagged(INVALID_NAME, `invalid name ${JSON.stringify(name)}: letters, digits, _ . - (max 64)`); return name; };

export function createRegistry({ vault: raw, clock, crypto }) {
    // Generatieteller: elke schrijfactie telt, na afloop. Zo ziet de proxy goedkoop of er iets wijzigde tijdens een request.
    let generation = 0;
    const counted = write => async (...args) => { try { return await write(...args); } finally { generation += 1; } };
    const vault = Object.freeze({ ...raw, put: counted(raw.put), remove: counted(raw.remove) });

    /** Alle records van een soort, met de gevraagde velden (de waarde van een secret wordt nooit gevraagd). */
    async function all(kind, fields) {
        const out = [];
        for (const id of await vault.ids()) {
            const head = await vault.get(id, ['kind']);
            if (head.kind === kind) out.push({ id, ...(await vault.get(id, fields)) });
        }
        return out;
    }

    async function must(kind, id) {
        const ids = await vault.ids();
        if (!ids.includes(id) || (await vault.get(id, ['kind'])).kind !== kind) throw tagged(NOT_FOUND, `no ${kind} ${id}`);
        return vault.get(id);
    }

    // ---- secrets ------------------------------------------------------------------------------------------------

    const SECRET_META = ['name', 'hosts', 'inject', 'sensitive', 'description', 'secretKind', 'username', 'createdAt', 'updatedAt'];
    // inject: de plekken waar het secret mag komen; null = van vóór 9.4 (LEGACY_INJECT); [] = nog te leren.
    const secretView = s => ({ id: s.id, name: s.name, kind: s.secretKind ?? 'key', username: s.username ?? '', hosts: s.hosts, inject: s.inject ?? null, sensitive: s.sensitive === true, description: s.description ?? '', createdAt: s.createdAt, updatedAt: s.updatedAt });

    function checkSensitive(sensitive) {
        if (typeof sensitive !== 'boolean') throw tagged('INVALID_SETTING', 'sensitive must be true or false');
        return sensitive;
    }

    function checkValue(value) {
        if (typeof value !== 'string' || value.length === 0) throw tagged('INVALID_VALUE', 'a secret value must be a non-empty string');
        return value;
    }

    async function addSecret({ name, value, kind = 'key', username = '', password = '', totp = '', hosts, inject = DEFAULT_INJECT, sensitive = false, description = '' }) {
        checkName(name);
        checkSensitive(sensitive);
        const secretVal = kind === 'login' ? checkValue(password || value) : checkValue(value);
        const rules = parseHostRules(hosts);
        const places = parseInjectPlaces(inject);
        if ((await all('secret', ['name'])).some(s => s.name === name)) throw tagged(DUPLICATE_NAME, `secret ${name} exists`);
        const now = clock.now();
        return vault.put({
            kind: 'secret', secretKind: kind, name, hosts: rules.map(r => r.text), inject: places, sensitive,
            description: String(description), createdAt: now, updatedAt: now, value: secretVal,
            ...(username ? { username: String(username) } : {}), ...(totp ? { totp: String(totp) } : {}),
        });
    }

    const listSecrets = async () => (await all('secret', SECRET_META)).map(secretView).sort((a, b) => a.name.localeCompare(b.name));

    /** Metadata (geen waarde) met geparste doelhost-regels, of null. */
    async function findSecret(name) {
        const found = (await all('secret', SECRET_META)).find(s => s.name === name);
        return found ? { ...secretView(found), hosts: parseHostRules(found.hosts) } : null;
    }

    async function secretValue(id) {
        const s = await vault.get(id, ['value', 'secretKind', 'username', 'totp']);
        if (s.secretKind === 'login') {
            const user = s.username ?? '';
            const pass = s.value;
            return { kind: 'login', username: user, password: pass, basic: Buffer.from(`${user}:${pass}`).toString('base64'), value: pass, ...(s.totp ? { totp: s.totp } : {}) };
        }
        return s.value;
    }

    async function updateSecret(id, patch) {
        const current = await must('secret', id);
        return vault.put({ ...current, ...patch, updatedAt: clock.now() }, id);
    }

    const rotateSecret = async (id, value) => updateSecret(id, { value: checkValue(value) });
    const setSecretHosts = async (id, hosts) => updateSecret(id, { hosts: parseHostRules(hosts).map(r => r.text) });
    // `learn`: alleen als het secret zijn plek nog moet leren (lege lijst); de eerste toegestane call legt ze vast.
    const setSecretInject = async (id, inject, learn = false) => ((learn && (await must('secret', id)).inject?.length !== 0) ? id : updateSecret(id, { inject: parseInjectPlaces(inject) }));
    // Gevoelig: elke goedkeuring, ook "eenmalig", vraagt dan een aanraking van de passkey.
    const setSecretSensitive = async (id, sensitive) => updateSecret(id, { sensitive: checkSensitive(sensitive) });

    async function removeSecret(id) {
        const { name } = await must('secret', id);
        for (const g of await listGrants({ secretName: name })) await vault.remove(g.id);
        await vault.remove(id);
    }

    // ---- tools --------------------------------------------------------------------------------------------------

    // Een tool is een "virtuele key": soort (webrequests via de proxy, of MCP). "Bij gebruik" en "geldig" horen bij een
    // toekenning; een key die ze nog draagt (`onUse`, `validMs`; 0 = altijd) geeft ze als standaard aan haar nieuwe
    // toekenningen. Zonder die velden: web, stil, altijd.
    // rotating: de helper wisselt de key uit (vanaf de eerste uitwisseling); reaskMs: "opnieuw vragen elke N uur" (0 = uit).
    const TOOL_FIELDS = ['name', 'clients', 'revoked', 'createdAt', 'toolKind', 'onUse', 'validMs', 'pairableAfterRotate', 'pairableUntil', 'rotating', 'reaskMs'];
    const toolView = t => ({ id: t.id, name: t.name, clients: parseClientRules(t.clients), revoked: t.revoked === true, createdAt: t.createdAt, kind: t.toolKind ?? 'web', onUse: t.onUse ?? 'silent', validMs: t.validMs ?? 0, pairableAfterRotate: isPairable(t, clock.now()), rotating: t.rotating === true, reaskMs: t.reaskMs ?? 0 });
    const rotation = createKeyRotation({ vault, clock, crypto: crypto ?? NO_CRYPTO, all, toolView, toolFields: TOOL_FIELDS });
    const { newFamilyKey, findToolByKey, exchangeToolKey } = rotation;

    function checkChoice(value, allowed, what) {
        if (!allowed.includes(value)) throw tagged('INVALID_SETTING', `${what} must be one of ${allowed.join(', ')}`);
        return value;
    }
    function checkDefaults({ onUse, validMs }) {
        if (!Number.isSafeInteger(validMs) || validMs < 0) throw tagged('INVALID_SETTING', 'validMs must be 0 (always) or a positive number of milliseconds');
        return { onUse: checkChoice(onUse, ['silent', 'notify', 'confirm'], 'onUse'), validMs };
    }

    /** Een geldige naam die nog geen andere tool heeft (`id`: de tool zelf mag haar naam houden). */
    const freeToolName = async (name, id = null) => { checkName(name); if ((await all('tool', ['name'])).some(t => t.name === name && t.id !== id)) throw tagged(DUPLICATE_NAME, `tool ${name} exists`); return name; };
    async function addTool({ name, clients = [], kind = 'web', onUse = 'silent', validMs = 0 }) {
        await freeToolName(name);
        const rules = parseClientRules(clients);
        const defaults = { toolKind: checkChoice(kind, ['web', 'mcp'], 'kind'), ...checkDefaults({ onUse, validMs }) };
        const { key, family } = newFamilyKey();
        const id = await vault.put({ kind: 'tool', name, keyHash: vault.toolKeyHash(key), family, clients: rules.map(r => r.text), revoked: false, pairableAfterRotate: false, createdAt: clock.now(), ...defaults });
        rotation.clearKeys();
        return { id, key };
    }

    const listTools = async () => (await all('tool', TOOL_FIELDS)).map(toolView).sort((a, b) => a.name.localeCompare(b.name));

    async function updateTool(id, patch) {
        const current = await must('tool', id);
        rotation.clearKeys();
        if ('keyHash' in patch || patch.revoked === true) rotation.dropSessions(id); // een nieuwe key of ingetrokken: geen enkel token meer
        return vault.put({ ...current, ...patch }, id);
    }

    const revokeTool = async id => updateTool(id, { revoked: true });
    const setToolClients = async (id, clients) => updateTool(id, { clients: parseClientRules(clients).map(r => r.text) });
    const setToolDefaults = async (id, { onUse, validMs }) => updateTool(id, checkDefaults({ onUse, validMs }));
    const setToolReask = async (id, reaskMs) => { if (!Number.isSafeInteger(reaskMs) || reaskMs < 0) throw tagged('INVALID_SETTING', 'reaskMs must be 0 (off) or a positive number of milliseconds'); return updateTool(id, { reaskMs, touchedAt: 0 }); };

    const { rotateToolKey, rePairToolKey } = createToolPairing({ vault, clock, must, updateTool, newFamilyKey });

    const reactivateTool = async id => updateTool(id, { revoked: false });

    /** Hernoemt een tool; key, toekenningen (via het id) en clients blijven. */
    const renameTool = async (id, name) => updateTool(id, { name: await freeToolName(name, id) });

    async function removeTool(id) {
        await must('tool', id);
        for (const g of await listGrants({ toolId: id })) await vault.remove(g.id);
        await vault.remove(id);
        rotation.clearKeys();
        rotation.dropSessions(id);
    }

    // Toekenningen (grants.js) en instellingen + TLS-pins (settings.js): zelfde kluis, zelfde hulpfuncties.
    const grants = createGrants({ vault, clock, all, must, checkName, tagged });
    const { listGrants } = grants;
    const settings = createSettings({ vault, clock, all, checkName, tagged });
    const { renameSecret, addSecretHost } = createRename({ vault, clock, all, must, checkName, tagged, duplicate: DUPLICATE_NAME, ...settings });

    return Object.freeze({
        addSecret, listSecrets, findSecret, secretValue, rotateSecret, setSecretHosts, setSecretInject, setSecretSensitive, removeSecret, renameSecret, addSecretHost,
        addTool, listTools, findToolByKey, exchangeToolKey, revokeTool, reactivateTool, rotateToolKey, rePairToolKey, renameTool, setToolClients, setToolDefaults, setToolReask, removeTool,
        ...grants, ...settings, ...createPasskeyMeta({ vault, clock, all, tagged }), generation: () => generation,
    });
}
