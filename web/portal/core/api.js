// De API van het portaal vanuit de browser: JSON, met het token van de sessie bij elk request. Het token staat in
// sessionStorage (per origin, dus per poort; overleeft herladen, niet een nieuw venster), nooit in een cookie.
// Vraagt het portaal een aanraking (STEP_UP_REQUIRED), dan vraagt de pagina de passkey en stuurt dezelfde request opnieuw
// met de assertion erbij.

const TOKEN = 'vaultgate.session';
let memory = null; // zonder sessionStorage (geblokkeerd): alleen in het geheugen van deze pagina

const readToken = () => { try { return globalThis.sessionStorage.getItem(TOKEN) ?? memory; } catch { return memory; } };
const writeToken = value => {
  memory = value;
  try { if (value) globalThis.sessionStorage.setItem(TOKEN, value); else globalThis.sessionStorage.removeItem(TOKEN); } catch { /* alleen in het geheugen */ }
};

let quiet = 0; // > 0: ophalen na een push; telt niet als handeling (verlengt de sessie niet)

/** Voert `fn` uit als achtergrond-ophaling: de requests dragen `x-portal-refresh: 1`. */
export async function quietly(fn) {
  quiet += 1;
  try { return await fn(); } finally { quiet -= 1; }
}

/** Vergeet het token (na afmelden). */
export const forgetCsrf = () => writeToken(null);

async function send(method, path, body) {
  const headers = {};
  const token = readToken();
  if (token) headers['x-csrf-token'] = token;
  if (quiet) headers['x-portal-refresh'] = '1';
  if (method !== 'GET') headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), credentials: 'same-origin' });
  const lockInMs = Number(res.headers.get('x-lock-in-ms'));
  // elke handeling met een geldige sessie verlengt ze: de kopbalk begint opnieuw af te tellen
  if (lockInMs) document.dispatchEvent(new CustomEvent('session-active', { detail: { lockInMs } }));
  return { res, data: await res.json() };
}

/** Een aanraking op de challenge die het portaal voor precies deze handeling gaf. */
async function touchFor(options) {
  try {
    return (await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })).toJSON();
  } catch (e) {
    throw Object.assign(new Error(e?.message ?? 'touch cancelled'), { code: 'STEP_UP_CANCELLED' });
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<any>} het antwoord; bij een fout een Error met `code` en `status`
 */
export async function api(method, path, body) {
  let { res, data } = await send(method, path, body);
  if (data?.error?.code === 'STEP_UP_REQUIRED') ({ res, data } = await send(method, path, { ...body, stepUp: await touchFor(data.error.stepUp) }));
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? res.statusText), { code: data.error?.code, status: res.status });
  if (data && data.csrf) writeToken(data.csrf);
  return data;
}
