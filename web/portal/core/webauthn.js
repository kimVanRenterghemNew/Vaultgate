// WebAuthn in de browser: registreren (met PRF), inloggen (PRF ontgrendelt de kluis) en een aanraking.
import { api } from './api.js';
import { say } from './dom.js';
import { t } from './i18n.js';

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/** De PRF-uitvoer gaat apart naar de server, nooit in de clientExtensionResults van de response. */
function withoutPrf(credential) {
  const json = credential.toJSON();
  if (json.clientExtensionResults) delete json.clientExtensionResults.prf;
  return json;
}

const prfOf = credential => {
  const out = credential.getClientExtensionResults().prf?.results?.first;
  return out ? b64u(out) : undefined;
};

/**
 * Een ceremonie van de browser (`create` of `get`). Weigert de browser (geannuleerd, verlopen, niet toegestaan), dan een
 * fout die zegt welke stap het was en na hoeveel seconden: de ruwe browsertekst zegt de gebruiker niets.
 */
async function ceremony(step, run) {
  const started = Date.now();
  try {
    return await run();
  } catch (e) {
    if (!['NotAllowedError', 'AbortError', 'TimeoutError'].includes(e?.name)) throw e;
    throw Object.assign(new Error(e.message), { code: 'PASSKEY_' + step + '_FAILED', params: { seconds: Math.round((Date.now() - started) / 1000) } });
  }
}

/** Nog een aanraking om de PRF-uitvoer op te halen (sommige authenticators geven ze niet bij het aanmaken). */
async function prfAssertion(options, prfSalt) {
  const req = PublicKeyCredential.parseRequestOptionsFromJSON(options);
  req.extensions = { prf: { eval: { first: unb64u(prfSalt) } } };
  return ceremony('PRF', () => navigator.credentials.get({ publicKey: req }));
}

/**
 * Een passkey registreren (met PRF, zodat ze de kluis opent). `first`: er is nog geen kluis; deze passkey maakt ze aan
 * (zonder PRF kan dat niet: de server weigert). `attachment`: de soort ('security-key', 'phone' of 'platform'); de server
 * maakt er een hint van, zodat de browser meteen het juiste vraagt.
 * @param {'security-key'|'phone'|'platform'} [attachment]
 * @param {{ first?: boolean }} [opts]
 */
export async function registerPasskey(attachment, { first = false } = {}) {
  const base = first ? '/api/setup/passkey' : '/api/webauthn/register';
  const { options, prfSalt } = await api('POST', base + '/options', attachment ? { attachment } : {});
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options);
  publicKey.extensions = { prf: { eval: { first: unb64u(prfSalt) } } };
  const cred = await ceremony('CREATE', () => navigator.credentials.create({ publicKey }));
  const enabled = cred.getClientExtensionResults().prf?.enabled;
  const result = await api('POST', base + '/verify', { response: withoutPrf(cred), prfOutput: prfOf(cred) });
  if (first && result.needsPrf) {
    const assertion = await prfAssertion(result.options, result.prfSalt);
    await api('POST', '/api/setup/passkey/prf', { response: withoutPrf(assertion), prfOutput: prfOf(assertion) });
    result.prf = true;
  } else if (!first && !result.prf && enabled) {
    const enroll = await api('POST', '/api/webauthn/prf-enroll/options', { credentialId: result.credentialId, prfSalt: result.prfSalt });
    const assertion = await prfAssertion(enroll.options, result.prfSalt);
    const done = await api('POST', '/api/webauthn/prf-enroll/verify', { response: withoutPrf(assertion), prfSalt: result.prfSalt, prfOutput: prfOf(assertion) });
    result.prf = done.prf;
  }
  say(result.prf || first ? t('portal.passkeys.registered') : t('portal.passkeys.registeredNoPrf'), 'success');
}

/**
 * Aanmelden (en met PRF ontgrendelen). `hint`: 'hybrid' vraagt de browser meteen om de telefoon (QR).
 * `extra`: bv. `{ acceptRollback: true }` als de gebruiker bewust een oudere kopie van de kluis terugzet.
 */
export async function login(hint, extra = {}) {
  const { options, prfSalts } = await api('POST', '/api/webauthn/login/options');
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
  if (hint) publicKey.hints = [hint];
  const evalByCredential = {};
  for (const [id, salt] of Object.entries(prfSalts)) evalByCredential[id] = { first: unb64u(salt) };
  if (Object.keys(evalByCredential).length) publicKey.extensions = { prf: { evalByCredential } };
  const assertion = await navigator.credentials.get({ publicKey });
  await api('POST', '/api/webauthn/login/verify', { ...extra, response: withoutPrf(assertion), prfOutput: prfOf(assertion) });
}

/** Een aanraking van de passkey op een wachtende bevestiging. Geannuleerd of mislukt: weigeren, en false. */
export async function touch(id) {
  const base = '/api/touch/' + encodeURIComponent(id);
  try {
    const { options } = await api('POST', base + '/options');
    const assertion = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
    await api('POST', base + '/verify', { response: assertion.toJSON() });
    return true;
  } catch {
    try { await api('POST', base + '/deny'); } catch { /* al beantwoord of verlopen */ }
    return false;
  }
}
