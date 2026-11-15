/**
 * Een portaalclient zonder browser, zoals de pagina (web/portal/core/api.js): cookie plus het token van de sessie bij elk
 * request, en bij STEP_UP_REQUIRED een aanraking met een software-passkey op de challenge van precies die handeling.
 * Voor journeys die een kluis met alleen een passphrase via het portaal inrichten: `unlock` geeft de sessie, `addKey` zet
 * de software-passkey als eerste passkey in de kluis (dat mag zonder aanraking), daarna gaat alles met aanraking.
 */
import { createSoftAuthenticator } from './softAuthenticator.js';

export function portalClient(portal, { key = createSoftAuthenticator() } = {}) {
    let cookie = '';
    let token = null;

    /** Eén request; geeft { status, data, res }. Neemt cookie en token over uit het antwoord. */
    async function raw(method, p, body) {
        const headers = { origin: portal, ...(cookie ? { cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) };
        const res = await fetch(`${portal}${p}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
        if (data?.csrf) token = data.csrf;
        return { status: res.status, data, res };
    }

    /** Zoals `raw`, maar vraagt het portaal een aanraking, dan volgt ze met de software-passkey. */
    async function call(method, p, body) {
        const first = await raw(method, p, body);
        if (first.data?.error?.code !== 'STEP_UP_REQUIRED') return first;
        return raw(method, p, { ...body, stepUp: key.assert({ challenge: first.data.error.stepUp.challenge, origin: portal }) });
    }

    /** De software-passkey registreren (in een kluis zonder passkey: de eerste, zonder aanraking). */
    async function addKey() {
        const { data } = await call('POST', '/api/webauthn/register/options', {});
        const done = await raw('POST', '/api/webauthn/register/verify', { response: key.register({ challenge: data.options.challenge, origin: portal }) });
        if (done.status !== 200) throw new Error(`passkey registration failed: ${JSON.stringify(done.data)}`);
    }

    return { raw, call, addKey, key, get session() { return { cookie, csrf: token }; } };
}
