// Een gekopieerde tool-key (of configuratie met de key) blijft niet onbeperkt op het klembord: na 60 s wordt het
// gewist, maar alleen als de key er nog op staat. Kopieerde je intussen iets anders, dan blijft dat staan. Mag het
// portaal het klembord niet lezen, dan wordt het toch gewist (veilig boven handig).
// De Clipboard API schrijft alleen als het venster de focus heeft; lukt wissen dan niet, dan zodra de focus terugkomt.
import { describe, it, expect } from 'vitest';
import { copySecret, CLEAR_MS } from '../../web/portal/core/clipboard.js';

const KEY = 'ks_nepKeyVoorHetKlembord';

/**
 * Klembord en klok in het geheugen. `focused: false` laat schrijven en lezen mislukken zoals in een venster zonder
 * focus; `readable: false` laat alleen lezen mislukken (toestemming geweigerd); `noRead` haalt `readText` weg.
 */
function fakes({ noRead = false } = {}) {
    const env = { text: '', focused: true, readable: true, timers: [], focusHandlers: [] };
    const allowed = () => { if (!env.focused) throw new Error('NotAllowedError'); };
    env.clipboard = { writeText: async t => { allowed(); env.text = t; } };
    if (!noRead) env.clipboard.readText = async () => { allowed(); if (!env.readable) throw new Error('NotAllowedError'); return env.text; };
    env.setTimer = (fn, ms) => env.timers.push({ fn, ms });
    env.onFocus = fn => env.focusHandlers.push(fn);
    env.elapse = async () => { for (const { fn } of env.timers.splice(0)) await fn(); };
    env.focus = async () => { env.focused = true; for (const fn of env.focusHandlers.splice(0)) await fn(); };
    return env;
}

describe('kopiëren van een tool-key', () => {
    it('Given een gekopieerde tool-key die nog op het klembord staat When 60 seconden verstrijken Then is het klembord gewist', async () => {
        const env = fakes();
        await copySecret(KEY, env);
        expect(env.text).toBe(KEY);
        expect(CLEAR_MS).toBe(60_000);
        expect(env.timers.map(t => t.ms)).toEqual([60_000]);
        await env.elapse();
        expect(env.text).toBe('');
    });

    it('Given intussen iets anders gekopieerd When 60 seconden verstrijken Then blijft dat op het klembord staan', async () => {
        const env = fakes();
        await copySecret(KEY, env);
        env.text = 'iets anders van de gebruiker';
        await env.elapse();
        expect(env.text).toBe('iets anders van de gebruiker');
    });

    it('Given lezen geweigerd When 60 seconden verstrijken Then wordt het klembord toch gewist', async () => {
        const env = fakes();
        await copySecret(KEY, env);
        env.readable = false;
        env.text = 'iets anders van de gebruiker';
        await env.elapse();
        expect(env.text).toBe('');
    });

    it('Given een browser zonder readText When 60 seconden verstrijken Then wordt het klembord gewist', async () => {
        const env = fakes({ noRead: true });
        await copySecret(KEY, env);
        await env.elapse();
        expect(env.text).toBe('');
    });

    it('Given een configuratie van meerdere regels die Windows met CRLF teruggeeft When 60 seconden verstrijken Then is het klembord gewist', async () => {
        const env = fakes();
        const config = `ANTHROPIC_BASE_URL=http://127.0.0.1:1/anthropic\nANTHROPIC_API_KEY=${KEY}`;
        await copySecret(config, env);
        env.text = config.replace(/\n/g, '\r\n');
        await env.elapse();
        expect(env.text).toBe('');
    });

    it('heeft het venster na 60 s geen focus, dan wordt het klembord gewist zodra de focus terugkomt', async () => {
        const env = fakes();
        await copySecret(KEY, env);
        env.focused = false;
        await env.elapse();
        expect(env.text).toBe(KEY);
        await env.focus();
        expect(env.text).toBe('');
    });

    it('zonder focus en intussen iets anders gekopieerd: ook bij terugkomende focus blijft dat staan', async () => {
        const env = fakes();
        await copySecret(KEY, env);
        env.focused = false;
        await env.elapse();
        env.text = 'iets anders van de gebruiker';
        await env.focus();
        expect(env.text).toBe('iets anders van de gebruiker');
    });

    it('MOET weigeren: een leesbaar klembord met een andere waarde wordt nooit gewist, ook niet als die op de key lijkt', async () => {
        for (const other of ['', ' ' + KEY, KEY + '\n', KEY.slice(0, -1), 'ks_eenAndereKey']) {
            const env = fakes();
            await copySecret(KEY, env);
            env.text = other;
            const writes = [];
            const write = env.clipboard.writeText;
            env.clipboard.writeText = async t => { writes.push(t); await write(t); };
            await env.elapse();
            expect(writes).toEqual([]);
            expect(env.text).toBe(other);
        }
    });

    it('MOET weigeren: mislukt het kopiëren zelf, dan geen wis-timer en een fout voor de knop', async () => {
        const env = fakes();
        env.focused = false;
        await expect(copySecret(KEY, env)).rejects.toThrow();
        expect(env.timers).toEqual([]);
    });
});
