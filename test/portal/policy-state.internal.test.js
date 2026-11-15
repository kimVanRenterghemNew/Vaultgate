import { describe, it, expect } from 'vitest';
import { createPolicyState } from '../../src/portal/policy-state.js';

function setup({ now = 1_000, blocks = [], passkeys = ['a', 'b'], quietHours = [] } = {}) {
    const clock = { now: () => now };
    const state = () => ({ blocks, quietHours });
    const vault = { listCredentials: () => passkeys.map(id => ({ id })) };
    return createPolicyState({ clock, policyState: state, vault });
}

describe('portal policy state', () => {
    it('filtert credentials met actieve passkey-blokkades', () => {
        const policy = setup({ blocks: [{ id: 'x', kind: 'passkey', passkeyId: 'a', until: null }] });
        expect(policy.availableCredentials([{ id: 'a' }, { id: 'b' }]).map(c => c.id)).toEqual(['b']);
    });

    it('pickUntil ondersteunt until, geen duur, nul en positieve duur', () => {
        const policy = setup({ now: 5_000 });
        expect(policy.pickUntil({ until: 123 })).toBe(123);
        expect(policy.pickUntil({})).toBeNull();
        expect(policy.pickUntil({ durationMs: 0 })).toBeNull();
        expect(policy.pickUntil({ durationMs: 250 })).toBe(5_250);
    });

    it('sameBlock vergelijkt op soortspecifieke sleutel', () => {
        const policy = setup();
        expect(policy.sameBlock({ kind: 'tool', toolId: 't1' }, { kind: 'tool', toolId: 't1' })).toBe(true);
        expect(policy.sameBlock({ kind: 'tool', toolId: 't1' }, { kind: 'tool', toolId: 't2' })).toBe(false);
        expect(policy.sameBlock({ kind: 'secret', secretName: 's1' }, { kind: 'secret', secretName: 's1' })).toBe(true);
        expect(policy.sameBlock({ kind: 'passkey', passkeyId: 'p1' }, { kind: 'passkey', passkeyId: 'p2' })).toBe(false);
        expect(policy.sameBlock({ kind: 'grant', toolId: 't', secretName: 's', host: 'https://a' }, { kind: 'grant', toolId: 't', secretName: 's', host: 'https://a' })).toBe(true);
    });

    it('checkContext levert quiet-hours en blockRule', () => {
        const atNight = new Date();
        atNight.setHours(2, 30, 0, 0);
        const now = atNight.getTime();
        const policy = setup({
            now,
            quietHours: ['23:00-07:00'],
            blocks: [{ id: 'b', kind: 'secret', secretName: 'demo', until: now + 10_000 }],
        });
        expect(policy.checkContext({ toolId: 't', secretName: 'demo', host: 'https://api.example.com' })).toEqual({ quietHours: true, blockRule: 'secret-blocked' });
    });

    it('checkContext valt terug op geen rustige uren en geen blokkade', () => {
        const policy = setup({ blocks: [], quietHours: [] });
        expect(policy.checkContext({ toolId: 't', secretName: 'demo', host: 'https://api.example.com' })).toEqual({ quietHours: false, blockRule: null });
    });

    it('checkContext werkt ook zonder quietHours/blocks in de state', () => {
        const clock = { now: () => 0 };
        const vault = { listCredentials: () => [] };
        const policy = createPolicyState({ clock, policyState: () => ({}), vault });
        expect(policy.checkContext({ toolId: 't', secretName: 'demo', host: 'https://api.example.com' })).toEqual({ quietHours: false, blockRule: null });
    });

    it('assertNotLastPasskey weigert de laatste vrije passkey', () => {
        const policy = setup({ passkeys: ['a'], blocks: [] });
        expect(() => policy.assertNotLastPasskey('a')).toThrow(expect.objectContaining({ code: 'LAST_PASSKEY' }));
    });

    it('assertNotLastPasskey laat blokkeren toe als er een andere passkey overblijft', () => {
        const policy = setup({ passkeys: ['a', 'b'], blocks: [] });
        expect(policy.assertNotLastPasskey('a')).toBeUndefined();
    });

    it('blockedUntilFor kiest null bij oneindig, anders de vroegste eindtijd', () => {
        const policy = setup({
            now: 100,
            blocks: [
                { id: 'b1', kind: 'passkey', passkeyId: 'a', until: 500 },
                { id: 'b2', kind: 'passkey', passkeyId: 'a', until: 300 },
                { id: 'b3', kind: 'passkey', passkeyId: 'b', until: null },
            ],
        });
        expect(policy.blockedUntilFor('a')).toBe(300);
        expect(policy.blockedUntilFor('b')).toBeNull();
        expect(policy.blockedUntilFor('c')).toBeUndefined();
    });

    it('blockFields mapt metadata per soort', () => {
        const policy = setup();
        expect(policy.blockFields({ kind: 'tool', toolId: 't1', until: null })).toMatchObject({ tool: 't1', origin: 'portal' });
        expect(policy.blockFields({ kind: 'grant', toolId: 't1', secretName: 's', host: 'https://a', until: 1 })).toMatchObject({ tool: 't1', secret: 's', host: 'https://a' });
    });
});
