// Toekenningen tool × secret × host, met soort en looptijd. Deel van de registry (index.js).
import { parseHostRules } from '../policy/index.js';

const ORIGINS = new Set(['portal', 'tray']);
const GRANT_MODES = new Set(['silent', 'notify', 'confirm']); // 3.6: ook elke keer opnieuw vragen

/** @param {{ vault, clock, all: Function, must: Function, checkName: Function, tagged: Function }} deps */
export function createGrants({ vault, clock, all, must, checkName, tagged }) {
    async function listGrants({ toolId, secretName } = {}) {
        const tools = new Map((await all('tool', ['name'])).map(t => [t.id, t.name]));
        return (await all('grant', ['toolId', 'secretName', 'host', 'origin', 'createdAt', 'mode', 'expiresAt', 'overrideMode', 'overrideUntil', 'authShape']))
            .map(g => ({ ...g, mode: g.mode ?? 'silent', expiresAt: g.expiresAt ?? null, overrideMode: g.overrideMode ?? null, overrideUntil: g.overrideUntil ?? null, authShape: g.authShape ?? null }))
            .filter(g => (!toolId || g.toolId === toolId) && (!secretName || g.secretName === secretName))
            .map(g => ({ ...g, toolName: tools.get(g.toolId) ?? '(verwijderd)' }))
            .sort((a, b) => a.toolName.localeCompare(b.toolName) || a.secretName.localeCompare(b.secretName) || a.host.localeCompare(b.host));
    }

    async function hasGrant(toolId, secretName, host) {
        const grant = await findGrant(toolId, secretName, host);
        return Boolean(grant) && !grant.expired && grant.mode !== 'confirm';
    }

    function checkGrantPatch({ mode, expiresAt, authShape }) {
        if (mode !== undefined && !GRANT_MODES.has(mode)) throw tagged('INVALID_SETTING', 'grant mode must be silent, notify or confirm');
        if (expiresAt !== undefined && expiresAt !== null && !Number.isFinite(expiresAt)) throw tagged('INVALID_SETTING', 'grant expiresAt must be a time or null');
        if (authShape !== undefined && authShape !== null && typeof authShape !== 'string') throw tagged('INVALID_SETTING', 'grant authShape must be string or null');
    }

    /**
     * Een toekenning; bestaat ze al (zelfde tool, secret en host), dan krijgt ze de nieuwe soort en het nieuwe einde.
     * Zonder keuze krijgt een nieuwe toekenning de standaard die een oudere key nog draagt (`onUse`, `validMs`);
     * `expiresAt: null` is een keuze ("altijd"), weglaten niet.
     */
    async function addGrant({ toolId, secretName, host, origin, mode, expiresAt, authShape }) {
        if (!ORIGINS.has(origin)) throw tagged('INVALID_ORIGIN', `grant origin must be portal or tray, got ${origin}`);
        checkGrantPatch({ mode, expiresAt, authShape });
        const tool = await must('tool', toolId);
        checkName(secretName);
        const normalized = parseHostRules([host])[0].origin;
        const existing = (await listGrants({ toolId, secretName })).find(g => g.host === normalized);
        if (existing) {
            // Een tijdelijke regel boven een vaste: de vaste blijft, de tijdelijke ligt erboven tot ze afloopt.
            if (existing.expiresAt === null && expiresAt) {
                await vault.put({ ...(await must('grant', existing.id)), overrideMode: mode ?? 'silent', overrideUntil: expiresAt }, existing.id);
                return existing.id;
            }
            await setGrant(existing.id, { ...(mode !== undefined ? { mode } : {}), expiresAt: expiresAt ?? null, ...(authShape !== undefined ? { authShape } : {}), endOverride: true });
            return existing.id;
        }
        const now = clock.now();
        const end = expiresAt !== undefined ? expiresAt : (tool.validMs ? now + tool.validMs : null);
        return vault.put({ kind: 'grant', toolId, secretName, host: normalized, origin, mode: mode ?? tool.onUse ?? 'silent', expiresAt: end, createdAt: now, authShape: authShape ?? null });
    }

    /** Soort of einde van een toekenning wijzigen (portaal, 3.4); `endOverride`: de tijdelijke regel eindigen. */
    async function setGrant(id, patch) {
        checkGrantPatch(patch);
        const current = await must('grant', id);
        const next = { ...current };
        if (patch.mode !== undefined) next.mode = patch.mode;
        if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt;
        if (patch.authShape !== undefined) next.authShape = patch.authShape;
        if (patch.endOverride) Object.assign(next, { overrideMode: null, overrideUntil: null });
        return vault.put(next, id);
    }

    /**
     * De toekenning voor tool × secret × host zoals ze nu geldt, of null: met een lopende tijdelijke regel de soort
     * en het einde daarvan (`temporary: true`), anders de vaste met `expired` volgens de klok.
     */
    async function findGrant(toolId, secretName, host) {
        const grant = (await listGrants({ toolId, secretName })).find(g => g.host === host);
        if (!grant) return null;
        const now = clock.now();
        if (grant.overrideUntil !== null && now < grant.overrideUntil) return { ...grant, mode: grant.overrideMode, expiresAt: grant.overrideUntil, expired: false, temporary: true };
        return { ...grant, expired: grant.expiresAt !== null && now >= grant.expiresAt, temporary: false };
    }

    async function removeGrant(id) {
        await must('grant', id);
        await vault.remove(id);
    }


    return Object.freeze({ addGrant, setGrant, findGrant, listGrants, hasGrant, removeGrant });
}
