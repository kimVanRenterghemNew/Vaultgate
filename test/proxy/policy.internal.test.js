import { describe, it, expect } from 'vitest';
import { readPolicyState, notificationSnoozed } from '../../src/proxy/policy.js';

describe('proxy policy helpers', () => {
    it('readPolicyState berekent now, quiet-hours en blocks', () => {
        const now = new Date();
        now.setHours(2, 0, 0, 0);
        const state = readPolicyState(
            { now: () => now.getTime() },
            () => ({ quietHours: ['23:00-07:00'], blocks: [{ id: 'b1', kind: 'tool', toolId: 't', until: null }] }),
        );
        expect(state.now).toBe(now.getTime());
        expect(state.quietHours).toBe(true);
        expect(state.blocks).toHaveLength(1);
    });

    it('readPolicyState valt terug op lege state', () => {
        const state = readPolicyState({ now: () => 1 }, () => null);
        expect(state).toMatchObject({ now: 1, quietHours: false, blocks: [] });
    });

    it('notificationSnoozed kijkt naar globaal en per grant', () => {
        const now = 10_000;
        expect(notificationSnoozed({}, 'g1', now)).toBe(false);
        expect(notificationSnoozed({ notificationSnooze: { globalUntil: now + 1, grants: [] } }, 'g1', now)).toBe(true);
        expect(notificationSnoozed({ notificationSnooze: { globalUntil: now - 1, grants: [] } }, 'g1', now)).toBe(false);
        expect(notificationSnoozed({ notificationSnooze: { globalUntil: null, grants: [{ grantId: 'g1', until: now + 5 }] } }, 'g1', now)).toBe(true);
        expect(notificationSnoozed({ notificationSnooze: { globalUntil: null, grants: [{ grantId: 'g1', until: null }] } }, 'g1', now)).toBe(true);
        expect(notificationSnoozed({ notificationSnooze: { globalUntil: null, grants: [{ grantId: 'g2', until: now + 5 }] } }, 'g1', now)).toBe(false);
    });
    it('rustige uren volgen de lokale klok, ook op de nachten van de zomertijd (Europe/Brussels) en over middernacht', () => {
        const before = process.env.TZ;
        process.env.TZ = 'Europe/Brussels';
        try {
            const quiet = iso => readPolicyState({ now: () => Date.parse(iso) }, () => ({ quietHours: ['23:00-07:00'] })).quietHours;
            expect(quiet('2026-03-28T22:30:00Z')).toBe(true); // 23:30 CET, voor middernacht
            expect(quiet('2026-03-29T05:30:00Z')).toBe(false); // 07:30 CEST: de klok sprong vooruit, een vaste UTC+1 zou 06:30 zeggen
            expect(quiet('2026-03-29T04:59:00Z')).toBe(true); // 06:59 CEST
            expect(quiet('2026-10-25T05:30:00Z')).toBe(true); // 06:30 CET: de klok ging terug, een vaste UTC+2 zou 07:30 zeggen
            expect(quiet('2026-10-25T06:01:00Z')).toBe(false); // 07:01 CET: weer normaal
        } finally {
            if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
        }
    });
});
