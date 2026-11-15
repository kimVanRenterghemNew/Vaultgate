import { describe, it, expect } from 'vitest';
import { blockRoutes } from '../../src/portal/block-routes.js';

function makeContext() {
    const settings = { blocks: [], notificationSnooze: { globalUntil: null, grants: [] } };
    const updates = [];
    const audit = [];
    const calls = [];
    const policy = {
        activeBlocks: () => settings.blocks,
        pickUntil: body => (body.until ?? null),
        assertNotLastPasskey: id => { calls.push(['assert', id]); },
        sameBlock: (a, b) => a.kind === b.kind && a.toolId === b.toolId && a.secretName === b.secretName && a.host === b.host && a.passkeyId === b.passkeyId,
        blockFields: block => ({ detail: JSON.stringify({ kind: block.kind }) }),
    };
    const registry = {
        getSettings: async () => settings,
        updateSettings: async patch => {
            if (patch.blocks) settings.blocks = patch.blocks;
            if (patch.notificationSnooze) settings.notificationSnooze = patch.notificationSnooze;
            updates.push(patch);
        },
    };
    const routes = blockRoutes({
        registry,
        auditAdmin: async (rule, fields = {}) => { audit.push({ rule, ...fields }); },
        crypto: { randomToken: () => 'tok_abcdefghijklmnopqrstuvwxyz' },
        afterSettings: async () => { calls.push(['after']); },
        httpError: (code, message) => Object.assign(new Error(message), { code }),
        policy,
    });
    const pick = (method, path) => routes.find(([m, re]) => m === method && re.test(path));
    return { settings, updates, audit, calls, pick };
}

describe('block routes', () => {
    it('GET /api/blocks geeft actieve blokkades', async () => {
        const ctx = makeContext();
        ctx.settings.blocks.push({ id: 'b1', kind: 'tool', toolId: 't1', until: null });
        const [, , , handler] = ctx.pick('GET', '/api/blocks');
        expect(handler({})).toEqual(ctx.settings.blocks);
    });

    it('POST /api/blocks maakt of vervangt een blokkade en auditeert', async () => {
        const ctx = makeContext();
        ctx.settings.blocks.push({ id: 'old', kind: 'tool', toolId: 't1', until: null });
        const [, , , handler] = ctx.pick('POST', '/api/blocks');
        const created = await handler({ body: { kind: 'tool', toolId: 't1', until: 123 } });
        expect(created).toMatchObject({ kind: 'tool', toolId: 't1', until: 123 });
        expect(ctx.settings.blocks).toHaveLength(1);
        expect(ctx.audit.at(-1)).toMatchObject({ rule: 'tool-blocked' });
    });

    it('POST /api/blocks ondersteunt secret en grant, ook als blocks ontbreekt', async () => {
        const ctx = makeContext();
        ctx.settings.blocks = undefined;
        const [, , , handler] = ctx.pick('POST', '/api/blocks');
        const secret = await handler({ body: { kind: 'secret', secretName: 'demo', until: null } });
        expect(secret).toMatchObject({ kind: 'secret', secretName: 'demo' });
        const grant = await handler({ body: { kind: 'grant', toolId: 't1', secretName: 'demo', host: 'https://api.example.com', until: 999 } });
        expect(grant).toMatchObject({ kind: 'grant', toolId: 't1', secretName: 'demo', host: 'https://api.example.com', until: 999 });
    });

    it('POST /api/blocks voor passkey vraagt last-passkey-check', async () => {
        const ctx = makeContext();
        const [, , , handler] = ctx.pick('POST', '/api/blocks');
        await handler({ body: { kind: 'passkey', passkeyId: 'pk1', until: null } });
        expect(ctx.calls).toContainEqual(['assert', 'pk1']);
    });

    it('DELETE /api/blocks verwijdert en auditeert; onbekend id geeft NOT_FOUND', async () => {
        const ctx = makeContext();
        ctx.settings.blocks = [{ id: 'b1', kind: 'secret', secretName: 's', until: null }];
        const [, , , remove] = ctx.pick('DELETE', '/api/blocks/b1');
        await expect(remove({ match: ['x', 'b1'] })).resolves.toEqual({ removed: true });
        expect(ctx.settings.blocks).toEqual([]);
        expect(ctx.audit.at(-1)).toMatchObject({ rule: 'secret-unblocked' });

        const [, , , again] = ctx.pick('DELETE', '/api/blocks/missing');
        await expect(again({ match: ['x', 'missing'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });

        ctx.settings.blocks = undefined;
        const [, , , absentList] = ctx.pick('DELETE', '/api/blocks/missing');
        await expect(absentList({ match: ['x', 'missing'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('globale en grant-snooze worden bewaard', async () => {
        const ctx = makeContext();
        const [, , , getSnooze] = ctx.pick('GET', '/api/snooze');
        expect(await getSnooze({})).toEqual({ globalUntil: null, grants: [] });

        const [, , , setGlobal] = ctx.pick('POST', '/api/snooze/global');
        ctx.settings.notificationSnooze = undefined;
        await setGlobal({ body: { until: 123 } });
        expect(ctx.settings.notificationSnooze.globalUntil).toBe(123);

        const [, , , setGrant] = ctx.pick('POST', '/api/snooze/grant');
        ctx.settings.notificationSnooze = undefined;
        await setGrant({ body: { grantId: 'g0', until: 1 } });
        ctx.settings.notificationSnooze = { globalUntil: null };
        await setGrant({ body: { grantId: 'g1', until: 456 } });
        await setGrant({ body: { grantId: 'g1', until: null } });
        expect(ctx.settings.notificationSnooze.grants).toEqual([{ grantId: 'g1', until: null }]);
        // sluimeren is beheer: elke keer een regel met tot wanneer
        expect(ctx.audit.map(e => [e.rule, e.detail])).toEqual([
            ['notifications-snoozed', `until: ${new Date(123).toISOString()}`],
            ['grant-notifications-snoozed', `grant g0 until: ${new Date(1).toISOString()}`],
            ['grant-notifications-snoozed', `grant g1 until: ${new Date(456).toISOString()}`],
            ['grant-notifications-snoozed', 'grant g1 until: always'],
        ]);
    });
    it('meldingen weer aan: globaal met until null, per toekenning met DELETE; elk in de audit als hervat', async () => {
        const ctx = makeContext();
        ctx.settings.notificationSnooze = { globalUntil: 123, grants: [{ grantId: 'g1', until: 456 }, { grantId: 'g2', until: 789 }] };
        const [, , , setGlobal] = ctx.pick('POST', '/api/snooze/global');
        await setGlobal({ body: { until: null } });
        expect(ctx.settings.notificationSnooze.globalUntil).toBeNull();
        const [, , , resume] = ctx.pick('DELETE', '/api/snooze/grant/g1');
        await expect(resume({ match: ['x', 'g1'] })).resolves.toMatchObject({ grants: [{ grantId: 'g2', until: 789 }] });
        expect(ctx.audit.map(e => [e.rule, e.detail])).toEqual([['notifications-resumed', undefined], ['grant-notifications-resumed', 'grant g1']]);
        // MOET weigeren: een toekenning zonder sluimer
        await expect(resume({ match: ['x', 'g9'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});
