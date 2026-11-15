// Vertalingen in de browser. De teksten staan in i18n/<taal>.json (Engels is de standaard en de terugval); een sjabloon
// verwijst ernaar met data-i18n (tekst) en data-i18n-<attribuut> (placeholder, title, aria-label). Regelnamen
// (`target-host-not-allowed` ...) worden nooit vertaald: ze zijn de API naar tools en de audit.
import { catalogs } from '../../../i18n/index.js';

const STORAGE_KEY = 'vaultgate.lang';
const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];

/** Geneste berichten -> platte sleutels ("portal.login.title"). */
export function flatten(tree, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') out[prefix + key] = value;
    else flatten(value, prefix + key + '.', out);
  }
  return out;
}

const CATALOGS = Object.fromEntries(Object.entries(catalogs).map(([lang, tree]) => [lang, flatten(tree)]));
export const LANGUAGES = Object.freeze(Object.keys(CATALOGS));

const stored = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };

/** De eerste taal die we hebben: eigen keuze, dan de talen van de browser (nl-BE -> nl), anders Engels. */
export function chooseLanguage(preferred = [stored(), ...(navigator.languages ?? [navigator.language])]) {
  for (const tag of preferred) {
    const base = String(tag ?? '').toLowerCase().split('-')[0];
    if (CATALOGS[base]) return base;
  }
  return 'en';
}

let current = chooseLanguage();
document.documentElement.lang = current;

export const language = () => current;

/**
 * Eigen keuze bewaren ('' = de taal van het systeem) en ter plekke wisselen: alle data-i18n-teksten onder body opnieuw.
 * Wat de code zelf invult, vult de aanroeper opnieuw in (het scherm herladen, niet de pagina: tab en sessie blijven).
 */
export function setLanguage(choice) {
  try { if (choice) localStorage.setItem(STORAGE_KEY, choice); else localStorage.removeItem(STORAGE_KEY); } catch { /* geen opslag: alleen deze keer */ }
  current = chooseLanguage(choice ? [choice] : undefined);
  document.documentElement.lang = current;
  translate(document.body);
}

/**
 * Een tekst in taal `lang` uit `catalogs`; ontbreekt hij, dan Engels (nooit een lege knop), en anders de sleutel zelf.
 * `{naam}` wordt ingevuld uit `params`.
 */
export function lookup(catalogs, lang, key, params = {}) {
  const text = catalogs[lang]?.[key] ?? catalogs.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

/** Een tekst in de huidige taal (zie lookup). */
export const t = (key, params) => lookup(CATALOGS, current, key, params);

/** Bestaat er een tekst voor deze sleutel (in de huidige taal of in het Engels)? */
export const has = key => key in CATALOGS[current] || key in CATALOGS.en;

/** Vult alle data-i18n-teksten en -attributen onder `root`. */
export function translate(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
  }
}

/** Datum en tijd in de huidige taal. */
export const date = time => (time ? new Date(time).toLocaleString(current) : '');

/** Alleen het uur als het vandaag is, anders datum en tijd. */
export const clock = time => (time && new Date(time).toDateString() === new Date().toDateString() ? new Date(time).toLocaleTimeString(current, { hour: '2-digit', minute: '2-digit' }) : date(time));
