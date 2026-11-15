// Beslissen met een tabel van benoemde regels. De eerste regel die past wint, en de beslissing draagt haar naam.
import { describe, it, expect } from 'vitest';
import { decide, all, any, not, NO_RULE_MATCHED } from '../../src/decision/index.js';

const isAdmin = ctx => ctx.role === 'admin';
const isOwner = ctx => ctx.owner === true;
const isLocked = ctx => ctx.locked === true;

describe('decide', () => {
    it('Given three rules of which two match, When decide, Then the first wins and rule is its name', () => {
        const rules = [
            { name: 'vault-locked', when: isLocked, then: { allow: false, status: 423 } },
            { name: 'admin', when: isAdmin, then: { allow: true } },
            { name: 'owner', when: isOwner, then: { allow: true, via: 'owner' } },
        ];
        expect(decide({ role: 'admin', owner: true }, rules)).toEqual({ allow: true, rule: 'admin' });
        expect(decide({ role: 'admin', owner: true, locked: true }, rules)).toEqual({ allow: false, status: 423, rule: 'vault-locked' });
    });

    it('Given a table without a matching rule, When decide, Then a tagged NO_RULE_MATCHED error, never a silent allow', () => {
        const rules = [{ name: 'admin', when: isAdmin, then: { allow: true } }];
        expect(() => decide({ role: 'guest' }, rules)).toThrow(expect.objectContaining({ code: NO_RULE_MATCHED }));
    });

    it('Given an empty table, When decide, Then NO_RULE_MATCHED (a table always ends with an explicit default rule)', () => {
        expect(() => decide({}, [])).toThrow(expect.objectContaining({ code: NO_RULE_MATCHED }));
    });

    it('Given a decision, When someone tries to change it, Then it is frozen (a later step cannot turn a denial into an allow)', () => {
        const decision = decide({}, [{ name: 'default-deny', when: () => true, then: { allow: false, status: 403 } }]);
        expect(Object.isFrozen(decision)).toBe(true);
    });

    it('Given a rule whose then carries its own rule key, When decide, Then the rule name wins', () => {
        const decision = decide({}, [{ name: 'real-name', when: () => true, then: { allow: false, rule: 'spoofed' } }]);
        expect(decision.rule).toBe('real-name');
    });

    it('Given rules after the winner, When decide, Then their guards are never evaluated', () => {
        let evaluated = false;
        decide({}, [
            { name: 'first', when: () => true, then: { allow: false } },
            { name: 'second', when: () => { evaluated = true; return true; }, then: { allow: true } },
        ]);
        expect(evaluated).toBe(false);
    });
});

describe('guards', () => {
    it('all, any and not compose guards', () => {
        const ctx = { role: 'admin', owner: false };
        expect(all(isAdmin, not(isOwner))(ctx)).toBe(true);
        expect(all(isAdmin, isOwner)(ctx)).toBe(false);
        expect(any(isOwner, isAdmin)(ctx)).toBe(true);
        expect(any(isOwner, isLocked)(ctx)).toBe(false);
        expect(not(isAdmin)(ctx)).toBe(false);
    });
});
