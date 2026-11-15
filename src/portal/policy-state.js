import { parseQuietHours, inQuietHours, blockRuleFor, ensureNotLastPasskey } from '../policy/index.js';

const activeUntil = (until, now) => until === null || until === undefined || now < until;

const minutes = now => {
    const d = new Date(now);
    return d.getHours() * 60 + d.getMinutes();
};

const sameBlock = (a, b) => (a.kind === b.kind)
    && (a.kind !== 'tool' || a.toolId === b.toolId)
    && (a.kind !== 'secret' || a.secretName === b.secretName)
    && (a.kind !== 'passkey' || a.passkeyId === b.passkeyId)
    && (a.kind !== 'grant' || (a.toolId === b.toolId && a.secretName === b.secretName && a.host === b.host));

export function createPolicyState({ clock, policyState, vault }) {
    const activeBlocks = (now = clock.now()) => (policyState().blocks ?? []).filter(block => activeUntil(block.until, now));
    const activePasskeyBlocks = (now = clock.now()) => activeBlocks(now).filter(block => block.kind === 'passkey');
    const blockedPasskeyIds = (now = clock.now()) => new Set(activePasskeyBlocks(now).map(block => block.passkeyId));

    const availableCredentials = (credentials, now = clock.now()) => {
        const blocked = blockedPasskeyIds(now);
        return credentials.filter(c => !blocked.has(c.id));
    };

    const pickUntil = body => {
        if (body.until !== undefined) return body.until;
        if (body.durationMs === undefined || body.durationMs === null || Number(body.durationMs) === 0) return null;
        return clock.now() + Number(body.durationMs);
    };

    const checkContext = ({ toolId, secretName, host }) => {
        const now = clock.now();
        const state = policyState();
        return {
            quietHours: inQuietHours(minutes(now), parseQuietHours(state.quietHours ?? [])),
            blockRule: blockRuleFor({ now, toolId, secretName, host }, state.blocks ?? []),
        };
    };

    const assertNotLastPasskey = passkeyId => {
        ensureNotLastPasskey({
            passkeyId,
            passkeys: vault.listCredentials().map(c => c.id),
            blockedPasskeys: activePasskeyBlocks().filter(entry => entry.passkeyId !== passkeyId),
        });
    };

    const blockedUntilFor = (passkeyId, now = clock.now()) => {
        const finite = activePasskeyBlocks(now)
            .filter(block => block.passkeyId === passkeyId)
            .map(block => block.until)
            .filter(until => until !== null && until !== undefined)
            .sort((a, b) => a - b);
        const forever = activePasskeyBlocks(now).some(block => block.passkeyId === passkeyId && (block.until === null || block.until === undefined));
        return forever ? null : (finite[0] ?? undefined);
    };

    const blockFields = block => ({
        ...(block.kind === 'tool' || block.kind === 'grant' ? { tool: block.toolId } : {}),
        ...(block.kind === 'secret' || block.kind === 'grant' ? { secret: block.secretName } : {}),
        ...(block.kind === 'grant' ? { host: block.host } : {}),
        origin: 'portal',
        detail: JSON.stringify({ kind: block.kind, ...(block.passkeyId ? { passkeyId: block.passkeyId } : {}), until: block.until ?? null }),
    });

    return Object.freeze({
        activeBlocks,
        activePasskeyBlocks,
        availableCredentials,
        pickUntil,
        sameBlock,
        checkContext,
        assertNotLastPasskey,
        blockedUntilFor,
        blockFields,
    });
}
