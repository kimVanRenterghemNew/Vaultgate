// Overgangen als pure reducer; effecten zijn data, er gebeurt geen I/O.
import { describe, it, expect } from 'vitest';
import { defineMachine, NO_TRANSITION } from '../../src/decision/index.js';

// Voorbeeld met de vorm van de goedkeuringsstroom.
const approval = defineMachine({
    pending: {
        timeout: state => ({
            state: { ...state, status: 'timed-out' },
            effects: [
                { type: 'audit.append', rule: 'approval-timeout' },
                { type: 'respond', status: 401, rule: 'approval-timeout' },
            ],
        }),
        answer: (state, event) => ({ state: { ...state, status: event.choice } }),
    },
    'timed-out': {
        // een antwoord dat te laat komt, verandert niets meer
        answer: state => ({ state }),
    },
});

describe('step', () => {
    it('Given a pending approval, When step(state, { type: timeout }), Then timed-out with audit.append and respond(401, approval-timeout)', () => {
        const pending = { status: 'pending', requestId: 'r1' };
        const result = approval(pending, { type: 'timeout' });
        expect(result.state).toEqual({ status: 'timed-out', requestId: 'r1' });
        expect(result.effects).toEqual([
            { type: 'audit.append', rule: 'approval-timeout' },
            { type: 'respond', status: 401, rule: 'approval-timeout' },
        ]);
    });

    it('Given a state, When step, Then the input is not mutated and the result is frozen', () => {
        const pending = Object.freeze({ status: 'pending' });
        const result = approval(pending, { type: 'timeout' });
        expect(pending).toEqual({ status: 'pending' });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.state)).toBe(true);
        expect(Object.isFrozen(result.effects)).toBe(true);
    });

    it('Given a transition without effects, When step, Then effects is an empty list', () => {
        expect(approval({ status: 'pending' }, { type: 'answer', choice: 'once' }).effects).toEqual([]);
    });

    it('Given a late answer after a time-out, When step, Then the state stays timed-out', () => {
        expect(approval({ status: 'timed-out' }, { type: 'answer', choice: 'always' }).state.status).toBe('timed-out');
    });

    it('Given an event the table does not know for this state, When step, Then a tagged NO_TRANSITION error, never a silent pass', () => {
        expect(() => approval({ status: 'timed-out' }, { type: 'timeout' })).toThrow(expect.objectContaining({ code: NO_TRANSITION }));
        expect(() => approval({ status: 'unknown' }, { type: 'answer' })).toThrow(expect.objectContaining({ code: NO_TRANSITION }));
    });

    it('Given an event named after an Object.prototype key, When step, Then NO_TRANSITION (no inherited handlers)', () => {
        expect(() => approval({ status: 'pending' }, { type: 'toString' })).toThrow(expect.objectContaining({ code: NO_TRANSITION }));
        expect(() => approval({ status: 'constructor' }, { type: 'answer' })).toThrow(expect.objectContaining({ code: NO_TRANSITION }));
    });
});
