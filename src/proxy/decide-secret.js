// Beslissen per secret, zonder iets te ontsleutelen. Deel van de proxy (index.js). Dezelfde beslistabel dient twee keer:
// vóór de goedkeuring, en als hercontrole vlak vóór het ophalen van de waarden (tegen TOCTOU: wat er wijzigde terwijl
// een request op de tray wachtte, wint van de goedkeuring die daarna kwam).
import { decideCaller, decideAccess, grantHost, blockRuleFor, sameSiteAs } from '../policy/index.js';
import { readPolicyState } from './policy.js';
import { MANUAL_KEY_MAX_MS } from '../approval/index.js';

/**
 * "Altijd" geldt alleen voor een key die vanzelf roteert. Een toekenning zonder einde voor een handmatige key (van vroeger,
 * of van vóór Rotate) geldt hoogstens 4 uur na haar aanmaak; daarna vraagt de tray opnieuw, met alleen tijdelijke keuzes.
 */
const staleForManualKey = (grant, tool, now) => Boolean(grant) && !grant.temporary && grant.expiresAt === null && grant.mode !== 'confirm'
    && tool.rotating !== true && typeof grant.createdAt === 'number' && now - grant.createdAt >= MANUAL_KEY_MAX_MS;

/**
 * De beslissing voor één secret, met de metadata en de toekenning waarop ze rust.
 * @param {object} registry
 * @param {{ callerCtx: object, name: string, target: URL, locations?: string[], now: number, quietHours: boolean, blocks: object[] }} ctx
 * @returns {Promise<{ decision: object, meta: object|null, grant: object|null }>}
 */
export async function decideSecret(registry, { callerCtx, name, target, locations, shape, now, quietHours, blocks }) {
    const host = grantHost(target);
    const meta = await registry.findSecret(name);
    const grant = meta ? await registry.findGrant(callerCtx.tool.id, name, host) : null;
    const stale = staleForManualKey(grant, callerCtx.tool, now);
    const shapeMismatch = Boolean(grant?.authShape && shape && grant.authShape !== shape);
    const decision = decideAccess({
        ...callerCtx,
        secret: { name, hosts: meta?.hosts ?? null, inject: meta?.inject ?? null },
        target,
        granted: Boolean(grant) && !grant.expired && !stale && !shapeMismatch && grant.mode !== 'confirm',
        grantExpired: grant?.expired === true || stale,
        authShapeMismatch: shapeMismatch,
        locations, subdomainOf: sameSiteAs(target, meta?.hosts),
        quietHours,
        blockRule: blockRuleFor({ now, toolId: callerCtx.tool.id, secretName: name, host }, blocks),
    });
    return { decision, meta, grant, shape };
}

/**
 * Hercontrole: dezelfde beslistabel opnieuw, met de toestand van nu en zonder nieuwe vraag. Dezelfde vraag als waarop
 * goedgekeurd werd (zelfde regel) laat die goedkeuring staan; een andere vraag (de toekenning verdween, alleen nog een
 * subdomein, ...) en elke weigering winnen. Geeft `{ decision, secret }` van de eerste weigering, of null als alles nog mag.
 * @param {{ vault, registry, clock, policyState: Function }} deps
 * @param {{ toolKey: string, client: string, target: URL, found: Map<string, string[]|undefined>, approved: { name: string, askedRule: string|null, shape?: string }[] }} request
 */
export async function recheck({ vault, registry, clock, policyState }, { toolKey, client, target, found, approved }) {
    const { now, quietHours, blocks } = readPolicyState(clock, policyState);
    const unlocked = vault.isUnlocked();
    const callerCtx = { vaultUnlocked: unlocked, tool: unlocked ? await registry.findToolByKey(toolKey) : null, client };
    const caller = decideCaller(callerCtx);
    if (!caller.allow) return { decision: caller, secret: approved[0]?.name };
    for (const { name, askedRule, shape } of approved) {
        const { decision } = await decideSecret(registry, { callerCtx, name, target, locations: found.get(name), shape, now, quietHours, blocks });
        if (decision.allow || (decision.ask && decision.rule === askedRule)) continue;
        return { decision, secret: name };
    }
    return null;
}
