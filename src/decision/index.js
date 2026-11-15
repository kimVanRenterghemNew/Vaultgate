// Compositiekern: beslissen met benoemde regels, overgangen als pure reducer,
// gedrag samenstellen zonder mutatie. Puur: geen I/O, geen klok, geen bibliotheek. Policy, approval en de
// client-allowlist bouwen hierop, zodat elke toestemming of weigering de naam draagt van de regel die haar nam.

export const NO_RULE_MATCHED = 'NO_RULE_MATCHED';
export const NO_TRANSITION = 'NO_TRANSITION';
export const PROTECTED_KEY = 'PROTECTED_KEY';

/** Sleutels die geen behavior mag overschrijven: de identiteit van de request en de beslissing (§6). */
export const PROTECTED_KEYS = Object.freeze(['requestId', 'toolId', 'secretName', 'targetHost', 'decision']);

const noRuleMatched = names => Object.assign(
    new Error(`no rule matched (rules: ${names.join(', ') || 'none'}); end the table with an explicit default rule`),
    { code: NO_RULE_MATCHED },
);
const noTransition = (status, type) => Object.assign(
    new Error(`no transition for event "${type}" in state "${status}"`),
    { code: NO_TRANSITION, status, event: type },
);
const protectedKeyError = (behavior, keys) => Object.assign(
    new Error(`behavior "${behavior}" may not overwrite ${keys.join(', ')}`),
    { code: PROTECTED_KEY, behavior, keys },
);

export const all = (...guards) => ctx => guards.every(guard => guard(ctx));
export const any = (...guards) => ctx => guards.some(guard => guard(ctx));
export const not = guard => ctx => !guard(ctx);

/**
 * De eerste regel waarvan `when(ctx)` waar is, wint. Geeft `{ ...then, rule: naam }` terug, bevroren.
 * Past er geen regel, dan een getagde fout: een stille toestemming bestaat niet (standaard dicht).
 * @param {object} ctx
 * @param {{ name: string, when: (ctx: object) => boolean, then: object }[]} rules
 */
export function decide(ctx, rules) {
    const winner = rules.find(rule => rule.when(ctx));
    if (!winner) throw noRuleMatched(rules.map(rule => rule.name));
    return Object.freeze({ ...winner.then, rule: winner.name });
}

/**
 * Maakt een pure reducer `step(state, event) -> { state, effects }` uit een tabel
 * `{ [state.status]: { [event.type]: (state, event) => ({ state, effects? }) } }`.
 * Effecten zijn data; een dunne uitvoerder doet de I/O. Een onbekende overgang is een fout, nooit een stille no-op.
 */
export function defineMachine(transitions) {
    return function step(state, event) {
        const handlers = Object.hasOwn(transitions, state.status) ? transitions[state.status] : undefined;
        if (!handlers || !Object.hasOwn(handlers, event.type)) throw noTransition(state.status, event.type);
        const result = handlers[event.type](state, event);
        return Object.freeze({
            state: Object.freeze({ ...result.state }),
            effects: Object.freeze([...(result.effects ?? [])]),
        });
    };
}

/**
 * Voegt een behavior toe aan de runtime: nieuw bevroren object, invoer ongewijzigd, `behaviors` groeit met één naam.
 * Een patch op een beschermde sleutel of op `behaviors` zelf wordt geweigerd met de naam van het behavior.
 * @param {object} runtime
 * @param {{ name: string, patch: object }} behavior
 */
export function compose(runtime, behavior) {
    const blocked = [...PROTECTED_KEYS, 'behaviors'].filter(key => Object.hasOwn(behavior.patch, key));
    if (blocked.length) throw protectedKeyError(behavior.name, blocked);
    return Object.freeze({
        ...runtime,
        ...behavior.patch,
        behaviors: Object.freeze([...(runtime.behaviors ?? []), behavior.name]),
    });
}
