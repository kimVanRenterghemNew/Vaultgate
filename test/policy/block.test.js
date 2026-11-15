import { describe, it, expect } from 'vitest';
import {
    decideAccess,
    parseHostRules,
    parseQuietHours,
    inQuietHours,
    blockRuleFor,
    ensureNotLastPasskey,
} from '../../src/policy/index.js';

const base = {
    vaultUnlocked: true,
    tool: { id: 't1', revoked: false, clients: [] },
    client: '127.0.0.1',
    secret: { name: 'demo', hosts: parseHostRules(['api.example.com']) },
    target: new URL('https://api.example.com/v1'),
};

describe('quiet hours', () => {
    it('Given rustige uren 23:00-07:00 When call om 02:00 Then quiet-hours', () => {
        const windows = parseQuietHours(['23:00-07:00']);
        expect(inQuietHours(2 * 60, windows)).toBe(true);
        expect(decideAccess({ ...base, granted: true, quietHours: true })).toMatchObject({ allow: false, status: 403, rule: 'quiet-hours' });
    });

    it('meerdere vensters werken en over-middernacht telt mee', () => {
        const windows = parseQuietHours(['12:00-13:00', '23:00-07:00']);
        expect(inQuietHours(12 * 60 + 15, windows)).toBe(true);
        expect(inQuietHours(6 * 60 + 59, windows)).toBe(true);
        expect(inQuietHours(7 * 60 + 1, windows)).toBe(false);
        expect(inQuietHours(22 * 60 + 59, windows)).toBe(false);
    });

    it('MOET weigeren: ongeldige vensters en ongeldige lokale minuten', () => {
        expect(() => parseQuietHours('23:00-07:00')).toThrow(expect.objectContaining({ code: 'INVALID_QUIET_HOURS' }));
        expect(() => parseQuietHours(['23:00/07:00'])).toThrow(expect.objectContaining({ code: 'INVALID_QUIET_HOURS' }));
        expect(() => parseQuietHours(['23:00-23:00'])).toThrow(expect.objectContaining({ code: 'INVALID_QUIET_HOURS' }));
        expect(inQuietHours(-1, parseQuietHours(['23:00-07:00']))).toBe(false);
        expect(inQuietHours(1440, parseQuietHours(['23:00-07:00']))).toBe(false);
    });
});

describe('tijdelijke blokkades', () => {
    it('Given een tool geblokkeerd voor 1 uur When call na 30 min Then tool-blocked; na 61 min niet meer', () => {
        const now = 1_700_000_000_000;
        const until = now + 60 * 60_000;
        const active = blockRuleFor({ now, toolId: 't1' }, [{ kind: 'tool', toolId: 't1', until }]);
        const expired = blockRuleFor({ now: now + 61 * 60_000, toolId: 't1' }, [{ kind: 'tool', toolId: 't1', until }]);
        expect(active).toBe('tool-blocked');
        expect(expired).toBe(null);
    });

    it('volgorde: grant > secret > tool', () => {
        const now = 1_700_000_000_000;
        const blocks = [
            { kind: 'tool', toolId: 't1', until: null },
            { kind: 'secret', secretName: 'demo', until: null },
            { kind: 'grant', toolId: 't1', secretName: 'demo', host: 'https://api.example.com', until: null },
        ];
        expect(blockRuleFor({ now, toolId: 't1', secretName: 'demo', host: 'https://api.example.com' }, blocks)).toBe('grant-blocked');
    });

    it('geeft passkey-blocked en null wanneer niets actief matcht', () => {
        const now = 1_700_000_000_000;
        const blocks = [{ kind: 'passkey', passkeyId: 'pk-1', until: null }];
        expect(blockRuleFor({ now, passkeyId: 'pk-1' }, blocks)).toBe('passkey-blocked');
        expect(blockRuleFor({ now, passkeyId: 'pk-2' }, blocks)).toBe(null);
    });

    it('geeft secret-blocked zonder grant, en null bij ongedefinieerde blocks', () => {
        const now = 1_700_000_000_000;
        const blocks = [{ kind: 'secret', secretName: 'demo', until: null }];
        expect(blockRuleFor({ now, secretName: 'demo' }, blocks)).toBe('secret-blocked');
        expect(blockRuleFor({ now, secretName: 'demo' }, undefined)).toBe(null);
    });

    it('Given de laatste passkey When blokkeren Then MOET afwijzen', () => {
        expect(() => ensureNotLastPasskey({ passkeyId: 'p1', passkeys: ['p1'], blockedPasskeys: [] })).toThrow(expect.objectContaining({ code: 'LAST_PASSKEY' }));
    });

    it('niet de laatste passkey blokkeren is toegestaan', () => {
        expect(ensureNotLastPasskey({ passkeyId: 'p1', passkeys: ['p1', 'p2'], blockedPasskeys: [] })).toBe(true);
        expect(ensureNotLastPasskey({ passkeyId: 'p2', passkeys: ['p1', 'p2'], blockedPasskeys: [{ passkeyId: 'p9' }] })).toBe(true);
    });
});