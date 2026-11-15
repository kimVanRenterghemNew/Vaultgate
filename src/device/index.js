// Tools koppelen met een device flow: een tool vraagt een key en toont een korte code in de terminal; een mens typt die code
// in het portaal en keurt goed (ontgrendelde kluis, aanraking van de passkey); de tool haalt zijn key één keer op. Zo komt
// een tool-key nooit op een scherm, een klembord of in een chat. De clientkant staat in client.js, de opslag van de key in key-file.js.
//
// Standaard dicht: alles in het geheugen (een herstart wist wachtende aanvragen), `device_code` alleen als hash, verloopt na
// 10 minuten, hoogstens 5 wachtende aanvragen per client-adres. De poll-beslissing is een tabel met benoemde regels; de
// overgangen een pure reducer met effecten als data (docs/architecture.md §5).
import { decide, defineMachine } from '../decision/index.js';
import { isLoopback } from '../policy/index.js';
import { createPairingCode } from './pairing-code.js';
import { NAME } from './client.js';

export { runDeviceLogin, gitCredential } from './client.js';
export { savedKeyPath, readSavedKey, saveKey, keyProtector, createDpapi } from './key-file.js';
export { rotateSavedKey, DEFAULT_PROXY } from './exchange-client.js';
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS';
export const NOT_FOUND = 'NOT_FOUND';
const LIFETIME_MS = 10 * 60_000;
const MAX_PENDING_PER_CLIENT = 5;
const tagged = (code, message) => Object.assign(new Error(message), { code });
/** Antwoord op een poll (RFC 8628 §3.5): eerste regel die past wint. */
export const POLL_RULES = Object.freeze([
    { name: 'device-unknown', when: ctx => !ctx.request, then: { status: 400, error: 'invalid_grant' } },
    { name: 'device-expired', when: ctx => ctx.now > ctx.request.expiresAt, then: { status: 400, error: 'expired_token' } },
    { name: 'device-denied', when: ctx => ctx.request.state === 'denied', then: { status: 400, error: 'access_denied' } },
    { name: 'device-ready', when: ctx => ctx.request.state === 'approved', then: { status: 200 } },
    { name: 'device-slow-down', when: ctx => ctx.now - (ctx.request.lastPoll ?? -Infinity) < ctx.intervalMs, then: { status: 400, error: 'slow_down' } },
    { name: 'device-pending', when: () => true, then: { status: 400, error: 'authorization_pending' } },
]);

/** wachtend -> goedgekeurd | geweigerd -> uitgeleverd. Een beslissing op een al besliste aanvraag is geen geldige overgang. */
const step = defineMachine({
    pending: {
        approve: (state, event) => ({ state: { ...state, state: 'approved', toolKey: event.toolKey }, effects: [{ type: 'audit', rule: 'device-approved', allow: true }] }),
        // event.rule: waarom (bv. `touch-denied`, 9.17); standaard `device-denied`.
        deny: (state, event) => ({ state: { ...state, state: 'denied' }, effects: [{ type: 'audit', rule: event.rule ?? 'device-denied', allow: false }] }),
    },
    approved: { deliver: state => ({ state: { ...state, state: 'delivered', toolKey: null }, effects: [{ type: 'audit', rule: 'device-delivered', allow: true }] }) },
});

export function createDeviceFlow({ crypto, clock, registry, vault, audit, notifier = null, touch = null, throttle = null, intervalSeconds = 5, verificationUri = () => null, log = () => {} }) {
    const requests = new Map(); // hash(device_code) -> aanvraag
    const intervalMs = intervalSeconds * 1000;
    const hash = code => crypto.keyedHash(hashKey, code);
    const hashKey = crypto.randomKey(); // per proces: hashes zijn niet tussen herstarts te vergelijken, en dat hoeft niet
    const pairingCode = createPairingCode({ crypto, hash, throttle });

    const record = entry => audit.append({ mode: 'device', ...entry }).catch(error => log({ event: 'audit-failed', code: error.code ?? 'unknown' }));

    function sweep() {
        const now = clock.now();
        for (const [key, r] of requests) {
            if (now > r.expiresAt) {
                requests.delete(key);
                if (r.state === 'pending') record({ tool: r.clientName, client: r.client, allow: false, rule: 'device-expired' });
            }
        }
    }

    async function apply(key, request, event) {
        const result = step({ status: request.state, ...request }, event);
        const next = { ...request, ...result.state, state: result.state.state };
        delete next.status;
        requests.set(key, next);
        for (const effect of result.effects) if (effect.type === 'audit') await record({ tool: request.clientName, client: request.client, allow: effect.allow, rule: effect.rule });
        return next;
    }

    async function request({ clientName, client }) {
        sweep();
        if (typeof clientName !== 'string' || !NAME.test(clientName)) throw tagged('INVALID_NAME', `invalid tool name ${JSON.stringify(clientName)}`);
        if ([...requests.values()].filter(r => r.client === client && r.state === 'pending').length >= MAX_PENDING_PER_CLIENT) {
            throw tagged(TOO_MANY_REQUESTS, 'too many pending device requests from this address');
        }
        // Een device-aanvraag neemt nooit een bestaande tool over (die heeft toekenningen), behalve binnen 10 minuten na
        // Rotate. Met een vergrendelde kluis kan deze controle pas bij goedkeuren (zie approve).
        const existing = vault.isUnlocked() ? await toolNamed(clientName) : null;
        if (existing && !existing.pairableAfterRotate) {
            await record({ tool: clientName, client, allow: false, rule: 'device-name-taken' });
            throw tagged('NAME_TAKEN', `a tool named ${clientName} already exists; issue a new key in the portal`);
        }
        const deviceCode = crypto.randomToken();
        const entry = {
            id: crypto.randomId(), clientName, client, userCode: pairingCode.create(), state: 'pending', created: clock.now(),
            expiresAt: clock.now() + LIFETIME_MS, lastPoll: null, toolKey: null,
            ...(existing ? { replaceToolId: existing.id } : {}),
        };
        requests.set(hash(deviceCode), entry);
        await record({ tool: clientName, client, allow: true, rule: 'device-requested' });
        if (notifier) askTray(entry);
        return { device_code: deviceCode, user_code: entry.userCode, verification_uri: verificationUri(), expires_in: LIFETIME_MS / 1000, interval: intervalSeconds };
    }

    /**
     * De vraag in de tray; "toestaan" (once/always) keurt goed, "weigeren" weigert, geen antwoord laat de aanvraag wachten
     * (portaal kan nog). Zonder de koppelcode: die staat alleen in de terminal en wordt in het portaal ingetypt.
     */
    function askTray(entry) {
        Promise.resolve()
            .then(() => notifier.ask({ id: `device-${entry.id}`, variant: 'device', tool: entry.clientName, secret: '', host: '', client: entry.client, timeoutMs: 120_000 }))
            .then(async answer => {
                // Een klik in de tray vervangt het intypen van de terminalcode in het portaal niet.
                if (answer === 'once' || answer === 'always') await approve(entry.id, { requireCode: true });
                else if (answer === 'deny') await deny(entry.id);
            })
            .catch(error => log({ event: 'device-tray-failed', code: error.code ?? 'unknown' }));
    }
    function find(id) {
        sweep();
        for (const [key, r] of requests) if (r.id === id && r.state === 'pending') return [key, r];
        throw tagged(NOT_FOUND, 'no pending device request with this id');
    }

    const verifyCode = (id, supplied) => pairingCode.verify(id, supplied, { find, requests });

    const toolNamed = async name => (await registry.listTools()).find(t => t.name === name) ?? null;
    /** Een tool met deze naam die deze aanvraag niet mag overnemen: niet (meer) open na Rotate, of een andere tool dan bij de aanvraag. */
    const takenBy = (tool, request) => Boolean(tool) && (!tool.pairableAfterRotate || (request.replaceToolId && tool.id !== request.replaceToolId));

    /**
     * Keurt een wachtende aanvraag goed na een aanraking van de passkey.
     * @param {string} id
     * @param {{ openTouch?: (touchId: string) => void, requireCode?: boolean }} [options] openTouch: het portaal vraagt de
     *   aanraking zelf; requireCode: alleen als de terminalcode eerst gecontroleerd is (verifyCode).
     */
    async function approve(id, { openTouch, requireCode = false } = {}) {
        const [key, r] = find(id);
        if (requireCode && !r.codeVerified) throw Object.assign(tagged('DEVICE_CODE_INVALID', 'verify the pairing code first'), { rule: 'device-code-required' });
        if (!vault.isUnlocked()) throw Object.assign(tagged('VAULT_LOCKED', 'vault is locked'), { rule: 'vault-locked' });
        // De naam kan ontstaan (of Rotate verlopen) zijn terwijl de aanvraag wachtte: dan weigeren, nooit de tool overnemen.
        if (takenBy(await toolNamed(r.clientName), r)) {
            await record({ tool: r.clientName, client: r.client, allow: false, rule: 'device-name-taken' });
            await apply(key, r, { type: 'deny' });
            return { denied: 'device-name-taken' };
        }
        // Een blijvende key pas na een aanraking van de passkey (een klik kan een programma geven). Tijdens het
        // wachten kan een tweede goedkeuring (tray en portaal tegelijk) niet nog eens vragen.
        if (r.touching) return { pending: true };
        requests.set(key, { ...r, touching: true });
        const touched = await Promise.resolve().then(() => (touch ? touch.confirm({ tool: r.clientName, secret: '', host: r.userCode, method: '', path: '', reason: 'device' }, openTouch ? { open: openTouch } : {}) : 'unavailable')).catch(() => 'unavailable');
        const current = requests.get(key);
        if (!current || current.state !== 'pending') return { denied: 'device-expired' };
        requests.set(key, { ...current, touching: false });
        if (touched !== 'ok') {
            await apply(key, requests.get(key), { type: 'deny', rule: `touch-${touched}` });
            return { denied: `touch-${touched}` };
        }
        // Opnieuw na de aanraking: tijdens het wachten kan de naam ontstaan zijn, of de tool ingetrokken of niet meer open.
        const currentTool = await toolNamed(r.clientName);
        if (takenBy(currentTool, r)) {
            await record({ tool: r.clientName, client: r.client, allow: false, rule: 'device-name-taken' });
            await apply(key, requests.get(key), { type: 'deny' });
            return { denied: 'device-name-taken' };
        }
        const { key: toolKey } = currentTool
            ? await registry.rePairToolKey(currentTool.id)
            : await registry.addTool({ name: r.clientName, clients: isLoopback(r.client) ? [] : [r.client] });
        await apply(key, requests.get(key), { type: 'approve', toolKey });
        return { approved: true };
    }

    async function deny(id) {
        const [key, r] = find(id);
        await apply(key, r, { type: 'deny' });
    }

    async function poll({ deviceCode }) {
        // Eerst beslissen, dan opruimen: een verlopen aanvraag hoort `expired_token` te geven, niet `invalid_grant`.
        const key = typeof deviceCode === 'string' ? hash(deviceCode) : null;
        const request = key ? requests.get(key) : undefined;
        const decision = decide({ request, now: clock.now(), intervalMs }, POLL_RULES);
        if (decision.rule === 'device-expired') {
            requests.delete(key);
            if (request.state === 'pending') await record({ tool: request.clientName, client: request.client, allow: false, rule: 'device-expired' });
        }
        sweep();
        if (request && decision.rule === 'device-pending') requests.set(key, { ...request, lastPoll: clock.now() });
        if (decision.rule === 'device-denied') requests.delete(key);
        if (decision.rule === 'device-ready') {
            const toolKey = request.toolKey;
            await apply(key, request, { type: 'deliver' });
            requests.delete(key);
            return { status: 200, rule: decision.rule, body: { tool_key: toolKey, tool_name: request.clientName } };
        }
        return { status: decision.status, rule: decision.rule, body: { error: decision.error } };
    }

    async function pending() {
        sweep();
        const tools = vault.isUnlocked() ? await registry.listTools() : [];
        const byName = new Map(tools.map(t => [t.name, t]));
        return [...requests.values()].filter(r => r.state === 'pending')
            .map(r => {
                const tool = byName.get(r.clientName);
                return { id: r.id, clientName: r.clientName, client: r.client, since: r.created, expiresAt: r.expiresAt, existing: Boolean(tool), pairable: tool?.pairableAfterRotate === true };
            });
    }

    return Object.freeze({ request, poll, approve, deny, pending, verifyCode });
}
