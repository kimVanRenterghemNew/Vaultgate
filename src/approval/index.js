// Goedkeuring van een nieuwe combinatie tool × secret × host. De vraag gaat naar de
// notifier-poort (tray of none); het antwoord wordt met een beslistabel een regel, de overgangen zijn een pure reducer
// (`defineMachine`) met effecten als data. Geen antwoord binnen de time-out = 401 approval-timeout, nooit "weigeren".
//
// "altijd", en elke goedkeuring van een gevoelig secret, vraagt daarna een aanraking van de passkey (de
// touch-poort, `src/touch`). Een programma kan de knop in de pop-up indrukken, de passkey niet. Zonder passkey is "altijd"
// hoogstens eenmalig en wordt een gevoelig secret geweigerd.
//
// @typedef {{ ask(question: { id, tool, secret, host, client, timeoutMs }): Promise<'once'|'always'|'deny'|'timeout'|'unavailable'> }} Notifier
import { decide, defineMachine } from '../decision/index.js';

/** Marge na de time-out van de tray: de tray antwoordt zelf `timeout`; zwijgt ze, dan sluit de server af. */
export const SERVER_GRACE_MS = 2_000;

const is = answer => ctx => ctx.answer === answer;

/** Het langste dat een handmatige key (die niet vanzelf roteert) toegekend krijgt: "altijd" alleen voor roterende keys. */
export const MANUAL_KEY_MAX_MS = 4 * 60 * 60_000;

export const APPROVAL_RULES = Object.freeze([
    { name: 'approved-once', when: is('once'), then: { allow: true, status: 200 } },
    // Een handmatige key kan gekopieerd zijn zonder dat het opvalt: "altijd" wordt daar hoogstens 4 uur (ook van een oude tray).
    { name: 'approved-4h', when: ctx => ctx.answer === 'always' && ctx.manualKey === true, then: { allow: true, status: 200, grant: true, durationMs: MANUAL_KEY_MAX_MS, detail: 'manual-key' } },
    { name: 'approved-always', when: is('always'), then: { allow: true, status: 200, grant: true } },
    // 3.4: een toekenning met een einde. Zoals "altijd" pas na een aanraking: anders kan een programma "30 min" klikken.
    { name: 'approved-30m', when: is('30m'), then: { allow: true, status: 200, grant: true, durationMs: 30 * 60_000 } },
    { name: 'approved-1h', when: is('1h'), then: { allow: true, status: 200, grant: true, durationMs: 60 * 60_000 } },
    { name: 'approved-4h', when: is('4h'), then: { allow: true, status: 200, grant: true, durationMs: 4 * 60 * 60_000 } },
    { name: 'approval-denied', when: is('deny'), then: { allow: false, status: 403 } },
    { name: 'approval-timeout', when: is('timeout'), then: { allow: false, status: 401 } },
    { name: 'approval-unavailable', when: is('unavailable'), then: { allow: false, status: 503 } },
    { name: 'approval-invalid-answer', when: () => true, then: { allow: false, status: 503 } },
]);

/** Na de tray, als er een aanraking nodig was: de uitkomst van de aanraking beslist. Eerste regel wint. */
export const TOUCH_RULES = Object.freeze([
    { name: 'touch-ok', when: ctx => ctx.touch === 'ok', then: { keep: true } },
    { name: 'touch-denied', when: ctx => ctx.touch === 'denied', then: { allow: false, status: 403 } },
    { name: 'touch-timeout', when: ctx => ctx.touch === 'timeout', then: { allow: false, status: 401 } },
    { name: 'touch-unavailable', when: ctx => ctx.sensitive, then: { allow: false, status: 503 } },
    // Geen passkey (of geen venster) bij "altijd" voor een gewoon secret: alleen deze ene call, geen toekenning.
    { name: 'approved-once', when: ctx => ['always', '30m', '1h', '4h'].includes(ctx.answer), then: { allow: true, status: 200, detail: 'touch-unavailable' } },
    { name: 'touch-unavailable', when: () => true, then: { allow: false, status: 503 } },
]);

/** Welke reden een aanraking vraagt, of null: alleen bij een toegestaan antwoord. */
export const touchReason = (decision, sensitive) => {
    if (!decision.allow) return null;
    if (decision.grant) return 'always'; // elke toekenning, ook met een einde
    return sensitive ? 'sensitive' : null;
};

const decided = decision => ({
    state: { status: 'decided', decision },
    effects: [...(decision.grant ? [{ type: 'grant.create' }] : []), { type: 'respond', decision }],
});

/** Wachtend → beslist. Een laat antwoord of een tweede time-out na de beslissing is geen geldige overgang. */
export const approvalStep = defineMachine({
    idle: { ask: (state, event) => ({ state: { status: 'pending', question: event.question }, effects: [{ type: 'tray.ask', question: event.question }] }) },
    pending: {
        answer: (state, event) => {
            const decision = decide({ answer: event.answer, manualKey: state.question.manualKey === true }, APPROVAL_RULES);
            const reason = touchReason(decision, state.question.sensitive === true);
            if (!reason) return decided(decision);
            return { state: { status: 'touching', question: state.question, decision, answer: event.answer }, effects: [{ type: 'touch.confirm', reason }] };
        },
        timeout: () => decided(decide({ answer: 'timeout' }, APPROVAL_RULES)),
    },
    touching: {
        touched: (state, event) => {
            const outcome = decide({ touch: event.result, sensitive: state.question.sensitive === true, answer: state.answer }, TOUCH_RULES);
            return decided(outcome.keep ? state.decision : outcome);
        },
        timeout: state => ({ state }), // de aanraking heeft haar eigen time-out
    },
});

/**
 * @param {{ notifier: Notifier, clock: { now(), setTimeout(fn, ms), clearTimeout(id) }, timeoutMs: () => number,
 *           createGrant: (grant) => Promise<void>, newId?: () => string }} deps
 */
export function createApproval({ notifier, clock, timeoutMs, createGrant, touch = null, newId = defaultId() }) {
    const inFlight = new Map(); // combinatie -> { promise, question, since }

    async function run(question) {
        let state = { status: 'idle' };
        let timer = null;
        let settle;
        const done = new Promise(resolve => { settle = resolve; });

        // De dunne uitvoerder: alleen hier gebeurt I/O.
        async function apply(event) {
            if (state.status === 'decided') return; // laat antwoord of time-out: genegeerd
            const result = approvalStep(state, event);
            state = result.state;
            for (const effect of result.effects) {
                if (effect.type === 'tray.ask') {
                    Promise.resolve()
                        .then(() => notifier.ask(effect.question))
                        .then(answer => apply({ type: 'answer', answer }), () => apply({ type: 'answer', answer: 'unavailable' }));
                } else if (effect.type === 'touch.confirm') {
                    clock.clearTimeout(timer);
                    const ask = { tool: question.tool, secret: question.secret, host: question.host, method: question.method, path: question.path, reason: effect.reason };
                    Promise.resolve()
                        .then(() => (touch ? touch.confirm(ask) : 'unavailable'))
                        .then(result => apply({ type: 'touched', result }), () => apply({ type: 'touched', result: 'unavailable' }));
                } else if (effect.type === 'grant.create') {
                    clock.clearTimeout(timer);
                    try {
                        const decision = state.decision ?? {};
                        await createGrant({ toolId: question.toolId, secretName: question.secret, host: question.host, origin: 'tray', expiresAt: decision.durationMs ? clock.now() + decision.durationMs : null, ...(question.variant === 'subdomain' ? { alias: true } : {}), ...(question.shape ? { authShape: question.shape } : {}) }); // "altijd" = uitdrukkelijk geen einde, ook als de key een standaardlooptijd heeft
                    } catch {
                        settle(Object.freeze({ allow: true, status: 200, rule: 'approved-once', detail: 'grant-failed' }));
                        return;
                    }
                } else if (effect.type === 'respond') {
                    clock.clearTimeout(timer);
                    // Een nieuw subdomein dat niet bij het secret mocht: een eigen regelnaam, wat het antwoord ook was.
                    const subdomainNo = question.variant === 'subdomain' && !effect.decision.allow;
                    settle(Object.freeze({ ...effect.decision, ...(subdomainNo ? { rule: 'subdomain-denied' } : {}), ...(question.certRoot ? { certRoot: question.certRoot } : {}) }));
                }
            }
        }

        const ms = timeoutMs();
        // Methode en pad (zonder query-waarden) zodat de gebruiker ziet wat hij toestaat.
        const asked = { id: newId(), tool: question.tool, secret: question.secret, host: question.host, client: question.client, method: question.method, path: question.path, timeoutMs: ms, ...(question.sensitive ? { sensitive: true } : {}), ...(question.manualKey ? { manualKey: true } : {}), ...(question.variant ? { variant: question.variant } : {}), ...(question.certRoot ? { certRoot: question.certRoot } : {}) };
        timer = clock.setTimeout(() => apply({ type: 'timeout' }), ms + SERVER_GRACE_MS);
        await apply({ type: 'ask', question: asked });
        return done;
    }

    /**
     * Gelijktijdige requests voor dezelfde combinatie delen één pop-up, niet het antwoord "eenmalig": wie op
     * een lopende vraag wachtte en "eenmalig" ziet, vraagt daarna zelf opnieuw. "Altijd", weigeren en time-out gelden voor
     * iedereen die wachtte.
     */
    async function request(question) {
        const key = JSON.stringify([question.toolId, question.secret, question.host]);
        const existing = inFlight.get(key);
        if (existing) {
            const decision = await existing.promise;
            return decision.rule === 'approved-once' ? request(question) : decision;
        }
        const entry = { question, since: clock.now() };
        entry.promise = run(question).finally(() => inFlight.delete(key));
        inFlight.set(key, entry);
        return entry.promise;
    }

    const pending = () => [...inFlight.values()].map(({ question, since }) => ({ tool: question.tool, secret: question.secret, host: question.host, client: question.client, since }));

    return Object.freeze({ request, pending });
}

function defaultId() {
    let n = 0;
    return () => `q${Date.now().toString(36)}${(n++).toString(36)}`;
}
