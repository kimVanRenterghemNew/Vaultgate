// Invariant: compose verandert nooit wat er al was, voegt precies één naam toe, en bevriest het resultaat.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compose, PROTECTED_KEYS } from '../../src/decision/index.js';

const RESERVED = new Set([...PROTECTED_KEYS, 'behaviors', '__proto__']);
const key = fc.string({ minLength: 1, maxLength: 12 }).filter(k => !RESERVED.has(k));
const value = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));

describe('compose (property)', () => {
    it('Given random runtimes and behaviors without protected keys, When compose, Then the result is frozen, keeps every input key unchanged and grows behaviors by exactly one name', () => {
        fc.assert(fc.property(
            fc.dictionary(key, value),
            fc.dictionary(key, value),
            fc.array(fc.string({ minLength: 1 }), { maxLength: 5 }),
            fc.string({ minLength: 1 }),
            (base, rawPatch, history, name) => {
                // patch raakt alleen nieuwe sleutels, zodat "invoer onveranderd" een eis is en geen toeval
                const patch = Object.fromEntries(Object.entries(rawPatch).filter(([k]) => !(k in base)));
                const rt = { ...base, behaviors: history };
                const next = compose(rt, { name, patch });

                expect(Object.isFrozen(next)).toBe(true);
                for (const [k, v] of Object.entries(base)) expect(next[k]).toBe(v);
                for (const [k, v] of Object.entries(patch)) expect(next[k]).toBe(v);
                expect(next.behaviors).toEqual([...history, name]);
                expect(rt.behaviors).toEqual(history);
            },
        ));
    });
});
