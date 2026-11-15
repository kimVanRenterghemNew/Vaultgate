// De clientkant van de device flow (`node src/main.js login`, `key`, git credential helper): een key vragen en wachten
// op goedkeuring. De opslag van de key staat in key-file.js. Draait in het proces van de tool, niet in de proxy; nooit een
// provider-sleutel.

/** Een geldige toolnaam (ook een bestandsnaam onder `clients/`). */
export const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
export const tagged = (code, message) => Object.assign(new Error(message), { code });
const fill = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
// Vertaald als de catalogus de sleutel kent, anders de Engelse tekst.
export const local =(t, key, fallback, params = {}) => { const translated = t(key, params); return typeof translated === 'string' && translated !== key ? translated : fill(fallback, params); };

/**
 * Clientkant van de device flow (`node src/main.js login`): vraagt een code, toont ze, wacht op goedkeuring en geeft de key
 * terug. Fetch, wachten en uitvoer zijn ingespoten (testbaar zonder echte tijd).
 */
export async function runDeviceLogin({ proxy, name, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), out = () => {}, t = key => key }) {
    const post = async (path, body) => {
        const res = await fetchImpl(`${proxy.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
    };
    const start = await post('/device/code', { client_name: name });
    if (start.status !== 200) throw tagged('DEVICE_REQUEST_FAILED', local(t, 'cli.login.requestFailed', 'Vaultgate refused the request: {error}', { error: start.body.error ?? start.status }));
    out(`${local(t, 'cli.login.pairing', 'Pairing "{name}" with Vaultgate.', { name })}\n${local(t, 'cli.login.checkCode', 'Your code: {code}\nOpen the Vaultgate portal, type this code into the pairing request, then allow it and touch your passkey.', { code: start.body.user_code })}${start.body.verification_uri ? `\n(${start.body.verification_uri})` : ''}\n${local(t, 'cli.login.waiting', 'Waiting until you allow it in Vaultgate...')}`);
    let interval = start.body.interval * 1000;
    for (;;) {
        await sleep(interval);
        const { status, body } = await post('/device/token', { device_code: start.body.device_code });
        if (status === 200) {
            // De naam komt uit het serverantwoord en wordt een bestandsnaam; alleen de gevraagde, geldige naam.
            if (body.tool_name !== name || !NAME.test(name) || typeof body.tool_key !== 'string') throw tagged('DEVICE_BAD_RESPONSE', local(t, 'cli.login.badResponse', 'Vaultgate: unexpected answer (tool name or key)'));
            return { toolKey: body.tool_key, toolName: body.tool_name };
        }
        if (body.error === 'slow_down') interval += 5000;
        else if (body.error !== 'authorization_pending') throw tagged(`DEVICE_${String(body.error).toUpperCase()}`, local(t, 'cli.login.pollError', 'Vaultgate: {error}', { error: body.error }));
    }
}

/**
 * Git credential helper (git-credential(1)): op `get` alleen de tool-key als wachtwoord; de proxy vervangt die door het echte
 * token. `store` en `erase` doen niets: git bewaart zo nooit een echt token.
 */
export function gitCredential({ operation, key }) {
    if (operation !== 'get') return '';
    return `username=x-access-token\npassword=${key}\n`;
}
