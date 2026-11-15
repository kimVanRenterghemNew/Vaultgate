// Nepklok met timers (injecteerbaar in approval en proxy): advance(ms) laat de vervallen timers lopen, in volgorde.
export function fakeTimers(start = 1_700_000_000_000) {
    let now = start;
    let seq = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimeout: id => { timers.delete(id); },
        pending: () => timers.size,
        async advance(ms) {
            const until = now + ms;
            for (;;) {
                const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                timers.delete(next[0]);
                now = next[1].at;
                next[1].fn();
                await new Promise(resolve => setImmediate(resolve));
            }
            now = until;
            await new Promise(resolve => setImmediate(resolve));
        },
    };
}

/** Notifier die elke vraag bijhoudt en antwoordt zoals het script zegt ('once', 'always', 'deny', 'unavailable' of 'never'). */
export function scriptedNotifier(answer) {
    const questions = [];
    const open = [];
    const ask = question => {
        questions.push(question);
        const a = typeof answer === 'function' ? answer(question) : answer;
        if (a === 'never') return new Promise(resolve => open.push(resolve));
        return Promise.resolve(a);
    };
    return { ask, questions, answerOpen: a => open.splice(0).forEach(resolve => resolve(a)) };
}

/** Aanraakpoort die altijd "ok" zegt: voor tests over het tray-antwoord zelf, niet over de aanraking. */
export const touchOk = Object.freeze({ confirm: async () => 'ok' });
