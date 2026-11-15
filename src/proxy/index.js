// De proxy: ingress -> policy -> approval -> hercontrole -> invullen -> egress -> scrub -> response.
// Ingress is forward (`/forward/...` of absolute-form) of reverse (`/<route>/...`).
// Standaard dicht: eerst beslissen, pas daarna ontsleutelen en doorsturen.
import { setTimeout as delay } from 'node:timers/promises';
import { decideCaller, decideAccess, grantHost, sameSiteAs, TOOL_KEY_HEADERS } from '../policy/index.js';
import { decideSecret, recheck } from './decide-secret.js';
import { createDeviceIngress, DEVICE_PATHS } from './device.js';
import { createGuard } from './guard.js';
import { connectUpstream } from './tls-override.js';
import { createForward } from './forward.js';
import { realClock, readPolicyState, notificationSnoozed, auditDetail, answerFor } from './policy.js';
import { parseTarget } from './target.js';
import { FAILURE_RULES } from '../throttle/index.js';
import { createDenyAudit } from './deny-audit.js';
import { denyMessage } from './deny-text.js';
import { placeholders, basicPassword, authShape } from './fill.js';
import { isMcpPath } from '../mcp/index.js';
export { DEVICE_INGRESS_RULES } from './device.js';
export { createKeyExchange } from './key-exchange.js';
export { denyMessage, DENY_SENTENCES } from './deny-text.js';
export { isProhibitedIp, validateTarget } from './ssrf.js';

const TOOL_KEY = /\bks_[A-Za-z0-9_-]{20,}/;
/** Standaardroutes. Extra routes (bv. een eigen LiteLLM) komen uit de instellingen in de kluis. */
export const DEFAULT_ROUTES = Object.freeze([
    { name: 'anthropic', base: 'https://api.anthropic.com', secret: 'anthropic', header: 'x-api-key' },
    { name: 'openai', base: 'https://api.openai.com', secret: 'openai', header: 'authorization' },
]);

const COALESCE_DENY_RULES = Object.freeze(new Set([...FAILURE_RULES, 'unknown-route', 'bad-target']));
/** Na zoveel opeenvolgende auditfouten vergrendelt de proxy de kluis. */
export const AUDIT_LOCKDOWN_AFTER = 3;
export function createProxy({ vault, registry, audit, approval, device = null, keyExchange = null, tlsTrust = null, routes = async () => DEFAULT_ROUTES, newRequestId, log = () => {}, throttle = null, tarpitMs = 30_000, notify = () => {}, translate = key => key, clock = realClock, policyState = () => ({}), denyCoalesceMs = 500, closedWaitMs = () => policyState().approvalTimeoutMs ?? 30_000, mcp = null }) {
    function extractToolKey(headers) {
        const candidates = [...TOOL_KEY_HEADERS.map(h => headers[h]), headers['proxy-authorization'], headers.authorization, headers['x-api-key'], basicPassword(headers.authorization)];
        return candidates.map(v => typeof v === 'string' && TOOL_KEY.exec(v)?.[0]).find(Boolean) ?? null;
    }

    // ---- antwoorden -------------------------------------------------------------------------------------------------
    function respondDenied(res, { status, rule, secret, message, tool, host, detail }) {
        if (res.headersSent) { res.destroy(); return; }
        const resolved = message ?? denyMessage(rule, { secret, tool, host, detail });
        const body = JSON.stringify({ error: { type: 'vaultgate', rule, message: resolved, ...(secret ? { secret } : {}) } });
        // Bij 401 vraagt de proxy om Basic-auth: zo roept git zijn credential helper aan (die alleen de tool-key levert, 5.4).
        res.writeHead(status, { 'content-type': 'application/json', 'x-vault-gate-rule': rule, 'cache-control': 'no-store', ...(status === 401 ? { 'www-authenticate': 'Basic realm="vaultgate"' } : {}) });
        res.end(body);
    }

    let auditFailures = 0; // Opeenvolgende auditfouten: bij AUDIT_LOCKDOWN_AFTER vergrendelt de kluis.
    /** Schrijft de audit-regel; geeft `false` als dat niet lukte (een toestemming mag dan niet doorgaan). */
    async function record(entry) {
        if (entry.allow === true) await denyAudit.flushPending();
        let ok = true;
        try {
            await audit.append(entry);
            auditFailures = 0;
        } catch (error) {
            ok = false;
            auditFailures += 1;
            log({ event: 'audit-failed', code: error.code ?? 'unknown' });
            if (auditFailures === AUDIT_LOCKDOWN_AFTER) {
                log({ event: 'audit-lockdown', failures: auditFailures });
                vault.lock();
            }
        }
        log({ event: 'request', requestId: entry.requestId, mode: entry.mode, rule: entry.rule, status: entry.status });
        return ok;
    }
    const denyAudit = createDenyAudit({ record, clock, coalesceMs: denyCoalesceMs, rules: COALESCE_DENY_RULES });

    // ---- de request ---------------------------------------------------------------------------------------------
    const handleDevice = device || keyExchange ? createDeviceIngress({ device, exchange: keyExchange, log }) : null;
    const guard = createGuard({ throttle, tarpitMs, notify, log, record: entry => record(entry), t: translate });

    async function handle(req, res) {
        if (handleDevice && req.method === 'POST' && DEVICE_PATHS.has(req.url)) return handleDevice(req, res);
        if (mcp && isMcpPath(req.url)) return mcp(req, res);
        const requestId = newRequestId();
        const base = { requestId, client: req.socket.remoteAddress, method: req.method };
        let throttleKey = guard.keyFor(null, base.client); // 9.13: wordt de tool zodra de key bekend is
        const deny = async (decision, extra = {}) => {
            const { closed, ...shown } = answerFor(decision); // de audit houdt de echte reden, de tool ziet `shown`
            await denyAudit.recordDenied({ ...base, ...extra, allow: false, rule: decision.rule, status: shown.status });
            if (closed) await delay(closedWaitMs());
            respondDenied(res, { ...shown, secret: extra.secret, tool: extra.tool, host: extra.host, detail: extra.detail, message: decision.message });
            await guard.afterDeny(throttleKey, decision.rule, { ...base, ...extra });
        };
        let names = [];
        try {
            const parsed = await parseTarget(req, routes);
            if (parsed.rule) return await deny({ rule: parsed.rule });
            const { mode, target, route } = parsed;
            const where = { mode, host: target.origin };
            const { now, state, quietHours, blocks } = readPolicyState(clock, policyState);

            const generation = registry.generation?.(); // vóór de eerste lezing: elke wijziging daarna geeft een hercontrole
            const unlocked = vault.isUnlocked();
            const toolKey = extractToolKey(req.headers);
            const tool = unlocked && toolKey ? await registry.findToolByKey(toolKey) : null;
            throttleKey = guard.keyFor(tool, base.client);
            const held = guard.check(throttleKey);
            if (held.blocked) return await guard.tarpit(req, res, held);
            // Reverse: de beheerder koos de header in de route, dus geen plekken te controleren (locations: undefined).
            const found = mode === 'reverse' ? new Map([[route.secret, undefined]]) : placeholders(req.headers, target);
            names = [...found.keys()];
            const callerCtx = { vaultUnlocked: unlocked, tool, client: base.client, protocol: req.headers['x-vault-gate-protocol'] };
            const caller = decideCaller(callerCtx);
            if (!caller.allow) return await deny(caller, { ...where, tool: tool?.name, secret: caller.rule === 'vault-locked' ? names[0] : undefined });
            if (names.length === 0) return await deny(decideAccess({ ...callerCtx, secret: null, target }), { ...where, tool: tool.name });

            // Beslissen per secret, zonder iets te ontsleutelen. De eerste weigering wint.
            const approved = [];
            for (const name of names) {
                const shape = authShape(req.headers, target, name);
                const { decision: first, meta, grant } = await decideSecret(registry, { callerCtx, name, target, locations: found.get(name), shape, now, quietHours, blocks });
                let decision = first;
                if (decision.rule === 'grant-expired') log({ event: 'grant-expired', tool: tool.name, secret: name, host: grantHost(target) });
                if (decision.ask) {
                    decision = await approval.request({ toolId: tool.id, tool: tool.name, secret: name, host: grantHost(target), client: base.client, method: req.method, path: target.pathname, sensitive: meta?.sensitive === true, manualKey: tool.rotating !== true, ...(decision.subdomain ? { variant: 'subdomain', certRoot: tlsTrust ? await tlsTrust.compareRoot(target, sameSiteAs(target, meta.hosts)) : 'unknown' } : {}), ...(decision.authShape ? { variant: 'auth-shape', shape } : {}) });
                }
                if (!decision.allow) return await deny(decision, { ...where, tool: tool.name, secret: name, ...(decision.rule === 'placeholder-location-not-allowed' ? { detail: found.get(name).join(',') } : decision.certRoot ? { detail: `root ${decision.certRoot}` } : {}) });
                approved.push({
                    name, askedRule: first.ask ? first.rule : null, id: meta.id, learn: meta.inject?.length === 0 ? found.get(name) : null,
                    temporary: decision.rule === 'granted' && grant?.temporary === true, certRoot: decision.certRoot, rule: decision.rule,
                    grantRemainingMs: decision.rule === 'granted' && grant?.expiresAt ? Math.max(0, grant.expiresAt - now) : null,
                });
                if (decision.rule === 'granted' && grant.mode === 'notify' && !notificationSnoozed(state, grant.id, now)) {
                    guard.notifyUse(grant, { tool: tool.name, secret: name, host: grantHost(target), shownHost: target.host });
                }
            }
            // Na een goedkeuring, of als de registry intussen wijzigde: dezelfde beslissing opnieuw; een weigering wint.
            const again = (approved.some(a => a.askedRule) || registry.generation?.() !== generation) ? await recheck({ vault, registry, clock, policyState }, { toolKey, client: base.client, target, found, approved }) : null;
            if (again) return await deny(again.decision, { ...where, tool: tool.name, secret: again.secret });

            const [rule, secretNames] = [approved.map(a => a.rule).join(','), approved.map(a => a.name).join(',')];
            const remaining = approved.filter(a => a.grantRemainingMs !== null).map(a => a.grantRemainingMs);
            const entry = { ...base, ...where, tool: tool.name, secret: secretNames, rule, ...(remaining.length ? { grantRemainingMs: Math.min(...remaining) } : {}), ...auditDetail(approved) };
            // Eerst de toestemming in de audit (afgewacht). Lukt dat niet, dan wordt er niets ontsleuteld en vertrekt er
            // niets (fail-closed).
            const trusted = await tlsTrust?.trustedCaFor(target.origin);
            if (!(await record({ ...entry, allow: true, ...(trusted ? { inspected: trusted.issuer || trusted.root || 'inspected' } : {}) }))) {
                respondDenied(res, { status: 503, rule: 'audit-unavailable' });
                return undefined;
            }
            for (const a of approved) if (a.learn) await registry.setSecretInject?.(a.id, a.learn, true);
            // Eerst de verbinding (keten en root gecontroleerd tijdens de handshake), pas dan de waarden: een geweigerde keten ziet er geen.
            const connection = await connectUpstream(tlsTrust, target);
            if (connection.rule) return failUpstream(res, entry, connection);
            const values = new Map();
            try { for (const { name, id } of approved) values.set(name, await registry.secretValue(id)); } catch (error) { connection.socket?.destroy(); throw error; }
            guard.succeed(throttleKey);
            forward(req, res, { target, route, toolKey, values, audit: entry, socket: connection.socket });
        } catch (error) {
            if (error.code === 'VAULT_LOCKED') return deny({ rule: 'vault-locked' }, { secret: names[0] });
            log({ event: 'proxy-error', requestId, code: error.code ?? 'unknown' });
            return deny({ rule: 'internal-error', status: 500 });
        }
        return undefined;
    }

    /** Gewijzigde keten of geblokkeerde bestemming: er is geen byte (dus geen secret) verstuurd. */
    const failUpstream = (res, entry, r) => { const [rule, status, detail] = [typeof r === 'string' ? r : r.rule, r.status ?? 502, r.detail]; record({ ...entry, allow: false, rule, status, ...(detail ? { detail } : {}) }); respondDenied(res, { status, rule, host: entry.host, detail }); };
    const forward = createForward({ tlsTrust, record, respondDenied, failUpstream, log });

    /** CONNECT: een tunnel zonder invulling en zonder scrubbing; niet in v1. */
    function handleConnect(req, socket) {
        const requestId = newRequestId();
        record({ requestId, client: socket.remoteAddress, method: 'CONNECT', mode: 'tunnel', host: req.url, allow: false, rule: 'tunnel-not-supported', status: 405 });
        socket.end('HTTP/1.1 405 Method Not Allowed\r\nx-vault-gate-rule: tunnel-not-supported\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
    }

    return Object.freeze({ handle, handleConnect });
}
