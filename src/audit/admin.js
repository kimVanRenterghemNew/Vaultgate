// Beheer in de audit: elke wijziging aan secrets, tools, toekenningen, passkeys en instellingen wordt een regel met
// mode 'admin', de herkomst (portal, tray, device, proxy), de naam van de regel en wat er veranderde (oud → nieuw).
// Het verschil komt uit de lijsten van de registry en alleen uit velden van een vaste lijst: die bevatten nooit een
// secret-waarde, een tool-key of een key-hash. Roteren geeft dus een regel zonder verschil. Deel van de audit (index.js).

/** Per soort: hoe je de huidige toestand leest, welke velden het verschil toont en hoe de regel de rij noemt. */
const KINDS = Object.freeze({
    secret: { list: r => r.listSecrets(), shown: ['name', 'hosts', 'inject', 'sensitive', 'description'], names: s => ({ secret: s.name }) },
    tool: { list: r => r.listTools(), shown: ['name', 'clients', 'revoked', 'kind', 'onUse', 'validMs', 'reaskMs'], names: t => ({ tool: t.name }) },
    grant: { list: r => r.listGrants(), shown: ['mode', 'expiresAt', 'overrideMode', 'overrideUntil'], names: g => ({ tool: g.toolName, secret: g.secretName, host: g.host }) },
    passkey: { list: async r => [...(await r.listPasskeyMeta())].map(([id, m]) => ({ id, name: m.name })), shown: ['name'], names: () => ({}) },
    settings: { list: async r => [{ id: 'settings', ...(await r.getSettings()) }], shown: null, names: () => ({}) },
});

const byId = id => (args, result) => (id === 'result' ? (result?.id ?? result) : args[0]);
const secretByName = (args, result, before) => before.find(s => s.name === args[0])?.id;
const ALWAYS = true; // ook zonder zichtbaar verschil: de waarde of key veranderde, of het ding is weg

/** Methode → [soort, regel (of regel naar de oude toestand), welk id, altijd een regel]. */
const METHODS = Object.freeze({
    addSecret: ['secret', 'secret-added', byId('result')],
    rotateSecret: ['secret', 'secret-rotated', byId(), ALWAYS],
    setSecretHosts: ['secret', 'secret-hosts-changed', byId()],
    addSecretHost: ['secret', 'secret-hosts-changed', secretByName],
    setSecretInject: ['secret', 'secret-places-changed', byId()],
    setSecretSensitive: ['secret', 'secret-sensitive-changed', byId()],
    renameSecret: ['secret', 'secret-renamed', byId()],
    removeSecret: ['secret', 'secret-removed', byId(), ALWAYS],
    addTool: ['tool', 'tool-added', byId('result')],
    renameTool: ['tool', 'tool-renamed', byId()],
    setToolClients: ['tool', 'tool-clients-changed', byId()],
    setToolDefaults: ['tool', 'tool-defaults-changed', byId()],
    setToolReask: ['tool', 'tool-reask-changed', byId()],
    rotateToolKey: ['tool', 'tool-key-rotated', byId(), ALWAYS],
    rePairToolKey: ['tool', 'tool-key-repaired', byId(), ALWAYS],
    revokeTool: ['tool', 'tool-revoked', byId()],
    reactivateTool: ['tool', 'tool-reactivated', byId()],
    removeTool: ['tool', 'tool-removed', byId(), ALWAYS],
    addGrant: ['grant', old => (old ? 'grant-changed' : 'grant-added'), byId('result')],
    setGrant: ['grant', 'grant-changed', byId()],
    removeGrant: ['grant', 'grant-removed', byId(), ALWAYS],
    setPasskeyName: ['passkey', 'passkey-renamed', byId()],
    removePasskeyMeta: ['passkey', 'passkey-removed', byId(), ALWAYS],
    updateSettings: ['settings', 'settings-changed', () => 'settings'],
});

const TIME = /(At|Until)$/;
function show(value, key) {
    if (value === undefined || value === null || value === '') return '–';
    if (typeof value === 'number' && TIME.test(key)) return new Date(value).toISOString();
    if (Array.isArray(value)) return value.length ? value.map(v => v?.text ?? (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ') : '–';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** "veld: oud → nieuw; …" over de getoonde velden die verschillen (leeg = niets veranderd). */
export function describeChange(shown, before = {}, after = {}) {
    const keys = shown ?? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== 'id');
    return keys.filter(k => show(before[k], k) !== show(after[k], k)).map(k => `${k}: ${show(before[k], k)} → ${show(after[k], k)}`).join('; ');
}

/** Een beheerregel schrijven; `fields`: namen (tool, secret, host) en `detail`, nooit een waarde. */
export const adminRecorder = (audit, origin) => (rule, fields = {}) => audit.append({ mode: 'admin', origin, allow: true, rule, ...fields });

/**
 * Dezelfde registry, maar elke wijziging komt in de audit (gewacht: lukt de audit niet, dan ziet de aanroeper een fout).
 * @param {object} registry
 * @param {{ audit: { append: Function }, origin: 'portal'|'tray'|'device'|'proxy' }} deps
 */
export function auditedRegistry(registry, { audit, origin }) {
    const record = adminRecorder(audit, origin);
    const wrap = (method, [kind, rule, idOf, always = false]) => async (...args) => {
        const { list, shown, names } = KINDS[kind];
        const before = await list(registry);
        const result = await registry[method](...args);
        const id = idOf(args, result, before);
        const old = before.find(x => x.id === id);
        const now = (await list(registry)).find(x => x.id === id);
        const detail = describeChange(shown, old, now);
        if (detail || always) await record(typeof rule === 'function' ? rule(old) : rule, { ...names(now ?? old ?? {}), ...(detail ? { detail } : {}) });
        return result;
    };
    return Object.freeze({ ...registry, ...Object.fromEntries(Object.entries(METHODS).map(([method, spec]) => [method, wrap(method, spec)])) });
}
