// Gedrag samenstellen; elke stap geeft een nieuw bevroren object en kan identiteit of beslissing niet overschrijven.
import { describe, it, expect } from 'vitest';
import { compose, PROTECTED_KEY, PROTECTED_KEYS } from '../../src/decision/index.js';

const runtime = () => Object.freeze({ requestId: 'r1', toolId: 'mytool', decision: { allow: false, rule: 'no-grant' }, behaviors: Object.freeze(['ingress']) });

describe('compose', () => {
    it('Given a behavior that overwrites decision, When compose, Then a tagged error with the behavior name and the input is unchanged', () => {
        const rt = runtime();
        const before = structuredClone(rt);
        let error;
        try { compose(rt, { name: 'smart-retry', patch: { decision: { allow: true } } }); } catch (e) { error = e; }
        expect(error).toMatchObject({ code: PROTECTED_KEY, behavior: 'smart-retry', keys: ['decision'] });
        expect(error.message).toContain('smart-retry');
        expect(rt).toEqual(before);
    });

    it('Given each protected key, When a behavior patches it, Then compose refuses', () => {
        for (const key of PROTECTED_KEYS) {
            expect(() => compose(runtime(), { name: 'b', patch: { [key]: 'x' } })).toThrow(expect.objectContaining({ code: PROTECTED_KEY }));
        }
    });

    it('protects at least requestId, toolId, secretName, targetHost and decision (docs/architecture.md §6)', () => {
        expect(PROTECTED_KEYS).toEqual(expect.arrayContaining(['requestId', 'toolId', 'secretName', 'targetHost', 'decision']));
    });

    it('Given a behavior that patches behaviors, When compose, Then refused (the history is not rewritable)', () => {
        expect(() => compose(runtime(), { name: 'b', patch: { behaviors: [] } })).toThrow(expect.objectContaining({ code: PROTECTED_KEY }));
    });

    it('Given a valid behavior, When compose, Then a new frozen runtime with the patch and the behavior name appended', () => {
        const rt = runtime();
        const next = compose(rt, { name: 'fill', patch: { upstreamHeaders: { 'x-api-key': '<filled>' } } });
        expect(next).not.toBe(rt);
        expect(Object.isFrozen(next)).toBe(true);
        expect(Object.isFrozen(next.behaviors)).toBe(true);
        expect(next.behaviors).toEqual(['ingress', 'fill']);
        expect(next.upstreamHeaders).toEqual({ 'x-api-key': '<filled>' });
        expect(rt.behaviors).toEqual(['ingress']);
    });

    it('Given a runtime without behaviors yet, When compose, Then behaviors starts with this name', () => {
        expect(compose({ requestId: 'r1' }, { name: 'ingress', patch: {} }).behaviors).toEqual(['ingress']);
    });
});
