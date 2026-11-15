// Beheer van secrets, virtuele keys (tools) en toekenningen. Deel van het portaal (index.js); alle routes vragen een
// ingelogde sessie en een open kluis. Een waarde gaat erin, nooit eruit; een tool-key alleen in het antwoord van
// aanmaken of vernieuwen.
import { parseHostRules, targetAllowed } from '../policy/index.js';
import { MANUAL_KEY_MAX_MS } from '../approval/index.js';

// De MCP in de agents van deze pc zetten hoort bij het beheer van tools.
export { mcpRoutes } from './mcp-routes.js';

/**
 * @param {{ registry: object, clock: { now(): number } }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function manageRoutes({ registry, clock, onToolRenamed = null }) {
    /**
     * Een toekenning uit het portaal alleen voor een domein van het secret (de tray neemt de host van de request).
     * `addHost`: de host komt eerst bij de domeinen (een tegengehouden host toestaan); de step-up van een toekenning dekt beide.
     */
    async function grantHostAllowed({ secretName, host, addHost }) {
        const secret = await registry.findSecret(secretName);
        const [rule] = parseHostRules([host]);
        const target = new URL(rule.text);
        if (secret && addHost === true && !targetAllowed(target, secret.hosts)) return registry.addSecretHost(secretName, rule.text);
        if (!secret || !targetAllowed(target, secret.hosts)) throw Object.assign(new Error(`${host} is not a domain of secret ${secretName}`), { code: 'BAD_REQUEST', rule: 'grant-host-not-allowed' });
    }

    /**
     * "Always" alleen voor een key die vanzelf roteert: een handmatige key krijgt hoogstens 4 uur (zonder keuze: 4 uur),
     * behalve "elke keer vragen" (dat laat niets stil door). Geeft het standaardeinde voor een nieuwe toekenning, of {}.
     */
    async function limitForManualKey(toolId, body, mode) {
        const tool = (await registry.listTools()).find(t => t.id === toolId);
        if (!tool || tool.rotating || mode === 'confirm') return {};
        const ms = body.durationMs === undefined ? undefined : Number(body.durationMs);
        if (ms !== undefined && (ms === 0 || ms > MANUAL_KEY_MAX_MS)) throw Object.assign(new Error('a key that does not rotate gets a grant of at most 4 hours'), { code: 'BAD_REQUEST', rule: 'grant-always-needs-rotating-key' });
        return ms === undefined ? { expiresAt: clock.now() + MANUAL_KEY_MAX_MS } : {};
    }
    const grantOf = async id => (await registry.listGrants()).find(g => g.id === id);

    /** Soort (stil/melding) en looptijd uit de body; `durationMs` 0 of weg = geen einde. */
    const grantPatch = body => ({
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
        ...(body.durationMs !== undefined ? { expiresAt: body.durationMs ? clock.now() + Number(body.durationMs) : null } : {}),
        ...(body.endOverride === true ? { endOverride: true } : {}),
    });
    const toolOptions = body => ({
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.onUse !== undefined ? { onUse: body.onUse } : {}),
        ...(body.validMs !== undefined ? { validMs: body.validMs } : {}),
    });

    return [
        // Secrets: de waarde gaat erin, nooit eruit.
        ['GET', /^\/api\/secrets$/, 'unlocked', () => registry.listSecrets()],
        ['POST', /^\/api\/secrets$/, 'unlocked', async ({ body }) => ({ id: await registry.addSecret({ name: body.name, value: body.value, kind: body.kind, username: body.username, password: body.password, totp: body.totp, hosts: body.hosts, ...(body.inject ? { inject: body.inject } : {}), ...(body.sensitive !== undefined ? { sensitive: body.sensitive } : {}), description: body.description }) })],
        ['POST', /^\/api\/secrets\/([0-9a-f]+)\/rotate$/, 'unlocked', async ({ body, match }) => { await registry.rotateSecret(match[1], body.value); return { rotated: true }; }],
        ['PUT', /^\/api\/secrets\/([0-9a-f]+)\/inject$/, 'unlocked', async ({ body, match }) => { await registry.setSecretInject(match[1], body.inject); return { updated: true }; }],
        ['PUT', /^\/api\/secrets\/([0-9a-f]+)\/sensitive$/, 'unlocked', async ({ body, match }) => { await registry.setSecretSensitive(match[1], body.sensitive); return { updated: true }; }],
        ['PUT', /^\/api\/secrets\/([0-9a-f]+)\/name$/, 'unlocked', async ({ body, match }) => { await registry.renameSecret(match[1], body.name); return { updated: true }; }],
        ['PUT', /^\/api\/secrets\/([0-9a-f]+)\/hosts$/, 'unlocked', async ({ body, match }) => { await registry.setSecretHosts(match[1], body.hosts); return { updated: true }; }],
        ['DELETE', /^\/api\/secrets\/([0-9a-f]+)$/, 'unlocked', async ({ match }) => { await registry.removeSecret(match[1]); return { removed: true }; }],

        // Virtuele keys (tools): soort en standaard bij goedkeuring; de key één keer in het antwoord.
        ['GET', /^\/api\/tools$/, 'unlocked', async () => (await registry.listTools()).map(t => ({ ...t, clients: t.clients.map(c => c.text) }))],
        ['POST', /^\/api\/tools$/, 'unlocked', ({ body }) => registry.addTool({ name: body.name, clients: body.clients ?? [], ...toolOptions(body) })],
        ['POST', /^\/api\/tools\/([0-9a-f]+)\/rotate$/, 'unlocked', ({ match }) => registry.rotateToolKey(match[1])],
        ['POST', /^\/api\/tools\/([0-9a-f]+)\/revoke$/, 'unlocked', async ({ match }) => { await registry.revokeTool(match[1]); return { revoked: true }; }],
        // Een nieuwe key heft een intrekking niet op; heractiveren is een aparte, bewuste handeling.
        ['POST', /^\/api\/tools\/([0-9a-f]+)\/reactivate$/, 'unlocked', async ({ match }) => { await registry.reactivateTool(match[1]); return { revoked: false }; }],
        ['PUT', /^\/api\/tools\/([0-9a-f]+)\/name$/, 'unlocked', async ({ body, match }) => {
            const tool = (await registry.listTools()).find(t => t.id === match[1]);
            const oldName = tool?.name;
            await registry.renameTool(match[1], body.name);
            if (oldName && oldName !== body.name && onToolRenamed) {
                await onToolRenamed({ oldName, newName: body.name, toolId: match[1], tool });
            }
            return { updated: true };
        }],
        ['PUT', /^\/api\/tools\/([0-9a-f]+)\/clients$/, 'unlocked', async ({ body, match }) => { await registry.setToolClients(match[1], body.clients ?? []); return { updated: true }; }],
        ['PUT', /^\/api\/tools\/([0-9a-f]+)\/defaults$/, 'unlocked', async ({ body, match }) => { await registry.setToolDefaults(match[1], { onUse: body.onUse, validMs: body.validMs }); return { updated: true }; }],
        ['PUT', /^\/api\/tools\/([0-9a-f]+)\/reask$/, 'unlocked', async ({ body, match }) => { await registry.setToolReask(match[1], body.reaskMs); return { updated: true }; }],
        ['DELETE', /^\/api\/tools\/([0-9a-f]+)$/, 'unlocked', async ({ match }) => { await registry.removeTool(match[1]); return { removed: true }; }],

        // Toekenningen.
        ['GET', /^\/api\/grants$/, 'unlocked', ({ query }) => registry.listGrants({ toolId: query.get('tool') || undefined, secretName: query.get('secret') || undefined })],
        ['POST', /^\/api\/grants$/, 'unlocked', async ({ body }) => { await grantHostAllowed(body); const limit = await limitForManualKey(body.toolId, body, body.mode); return { id: await registry.addGrant({ toolId: body.toolId, secretName: body.secretName, host: body.host, origin: 'portal', ...limit, ...grantPatch(body) }) }; }],
        ['PUT', /^\/api\/grants\/([0-9a-f]+)$/, 'unlocked', async ({ body, match }) => { const g = await grantOf(match[1]); if (g) await limitForManualKey(g.toolId, body, body.mode ?? g.mode); await registry.setGrant(match[1], grantPatch(body)); return { updated: true }; }],
        ['DELETE', /^\/api\/grants\/([0-9a-f]+)$/, 'unlocked', async ({ match }) => { await registry.removeGrant(match[1]); return { removed: true }; }],
    ];
}
