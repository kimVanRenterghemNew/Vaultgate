// Blokkades en stilgezette meldingen in het portaal: een tool, secret, toekenning of passkey tijdelijk of voorgoed
// blokkeren en weer vrijgeven, en meldingen sluimeren en weer aanzetten. Elke wijziging is beheer en komt in de audit (auditAdmin).
// Deel van het portaal (index.js).

const untilText = until => (until === null || until === undefined ? 'always' : new Date(until).toISOString());

/** @param {{ registry: object, auditAdmin: Function, crypto: object, afterSettings: Function, httpError: Function, policy: object }} deps */
export function blockRoutes({ registry, auditAdmin, crypto, afterSettings, httpError, policy }) {
    return [
        ['GET', /^\/api\/blocks$/, 'unlocked', () => policy.activeBlocks()],
        ['POST', /^\/api\/blocks$/, 'unlocked', async ({ body }) => {
            const settings = await registry.getSettings();
            const block = {
                id: body.id ?? crypto.randomToken().slice(0, 24),
                kind: body.kind,
                ...(body.kind === 'tool' ? { toolId: body.toolId } : {}),
                ...(body.kind === 'secret' ? { secretName: body.secretName } : {}),
                ...(body.kind === 'grant' ? { toolId: body.toolId, secretName: body.secretName, host: body.host } : {}),
                ...(body.kind === 'passkey' ? { passkeyId: body.passkeyId } : {}),
                until: policy.pickUntil(body),
            };
            if (block.kind === 'passkey') policy.assertNotLastPasskey(block.passkeyId);
            const blocks = [...(settings.blocks ?? []).filter(entry => !policy.sameBlock(entry, block)), block];
            await registry.updateSettings({ blocks });
            await afterSettings();
            await auditAdmin(`${block.kind}-blocked`, policy.blockFields(block));
            return block;
        }],
        ['DELETE', /^\/api\/blocks\/([A-Za-z0-9_-]{1,128})$/, 'unlocked', async ({ match }) => {
            const settings = await registry.getSettings();
            const found = (settings.blocks ?? []).find(block => block.id === match[1]);
            if (!found) throw httpError('NOT_FOUND', 'unknown block');
            await registry.updateSettings({ blocks: settings.blocks.filter(block => block.id !== match[1]) });
            await afterSettings();
            await auditAdmin(`${found.kind}-unblocked`, policy.blockFields(found));
            return { removed: true };
        }],
        ['GET', /^\/api\/snooze$/, 'unlocked', async () => (await registry.getSettings()).notificationSnooze],
        ['POST', /^\/api\/snooze\/global$/, 'unlocked', async ({ body }) => {
            const settings = await registry.getSettings();
            const notificationSnooze = {
                ...(settings.notificationSnooze ?? { globalUntil: null, grants: [] }),
                globalUntil: policy.pickUntil(body),
            };
            await registry.updateSettings({ notificationSnooze });
            await afterSettings();
            // Zonder einde: de meldingen staan weer aan (globaal betekent null "niet stil", nooit "voorgoed stil").
            if (notificationSnooze.globalUntil === null) await auditAdmin('notifications-resumed');
            else await auditAdmin('notifications-snoozed', { detail: `until: ${untilText(notificationSnooze.globalUntil)}` });
            return notificationSnooze;
        }],
        ['POST', /^\/api\/snooze\/grant$/, 'unlocked', async ({ body }) => {
            const settings = await registry.getSettings();
            const current = settings.notificationSnooze ?? { globalUntil: null, grants: [] };
            const entry = { grantId: String(body.grantId), until: policy.pickUntil(body) };
            const notificationSnooze = {
                ...current,
                grants: [...(current.grants ?? []).filter(g => g.grantId !== entry.grantId), entry],
            };
            await registry.updateSettings({ notificationSnooze });
            await afterSettings();
            await auditAdmin('grant-notifications-snoozed', { detail: `grant ${entry.grantId} until: ${untilText(entry.until)}` });
            return notificationSnooze;
        }],
        ['DELETE', /^\/api\/snooze\/grant\/([A-Za-z0-9_-]{1,128})$/, 'unlocked', async ({ match }) => {
            const current = (await registry.getSettings()).notificationSnooze ?? { globalUntil: null, grants: [] };
            if (!(current.grants ?? []).some(g => g.grantId === match[1])) throw httpError('NOT_FOUND', 'notifications of this grant are not snoozed');
            const notificationSnooze = { ...current, grants: current.grants.filter(g => g.grantId !== match[1]) };
            await registry.updateSettings({ notificationSnooze });
            await afterSettings();
            await auditAdmin('grant-notifications-resumed', { detail: `grant ${match[1]}` });
            return notificationSnooze;
        }],
    ];
}
