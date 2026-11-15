// Kleine DOM-bouwstenen. Opmaak staat altijd in een .html-sjabloon (ook rijen en badges, als <template>); de JS vult
// alleen velden. Gebruikersdata komt via textContent in de pagina, nooit via innerHTML.
import { t, has, translate } from './i18n.js';

/** @param {string} id */
export const $ = id => document.getElementById(id);

/**
 * Kloont `<template data-template="name">` onder `root` en vult het:
 *  - `[data-field=x]` krijgt `fields.x` als tekst (of als element, als het een Node is);
 *  - `[data-if=x]` blijft alleen staan als `fields.x` waar is, `[data-if-not=x]` alleen als het onwaar is;
 *  - `{x}` in data-testid wordt `fields.x`;
 *  - `[data-action=y]` roept bij een klik `actions.y` aan (via guarded).
 * @param {ParentNode} root
 * @param {string} name
 * @param {Record<string, unknown>} [fields]
 * @param {Record<string, () => Promise<void>|void>} [actions]
 * @returns {Element}
 */
export function clone(root, name, fields = {}, actions = {}) {
  const template = root.querySelector(`template[data-template="${name}"]`);
  if (!template) throw new Error('missing template: ' + name);
  const node = template.content.firstElementChild.cloneNode(true);
  const all = selector => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
  for (const el of all('[data-if]')) if (!fields[el.dataset.if]) el.remove();
  for (const el of all('[data-if-not]')) if (fields[el.dataset.ifNot]) el.remove();
  for (const el of all('[data-field]')) {
    const value = fields[el.dataset.field];
    if (value instanceof Node) el.replaceChildren(value); else el.textContent = value ?? '';
  }
  for (const el of all('[data-testid*="{"]')) el.dataset.testid = el.dataset.testid.replace(/\{(\w+)\}/g, (_, k) => String(fields[k] ?? ''));
  for (const el of all('[data-action]')) {
    const fn = actions[el.dataset.action];
    if (fn) el.addEventListener('click', e => guarded(fn, e));
  }
  translate(node);
  return node;
}

/** Een melding bovenaan (soort: info, success, warning, error), uit de sjablonen in index.html. */
export function say(text, kind = 'info') { $('message').replaceChildren(clone(document, 'message-' + kind, { text })); }
export function clearSay() { $('message').replaceChildren(); }

// busy telt lopende handelingen (voor tests en om dubbel klikken zichtbaar te maken): 0 = alles afgehandeld.
let busy = 0;
const setBusy = d => { busy += d; document.body.dataset.busy = String(busy); };

/** De tekst van een fout van de API: vertaald als we de code kennen (met `e.params` ingevuld), anders code en Engelse uitleg. */
export function errorText(e) {
  if (e.code && has('errors.' + e.code)) return t('errors.' + e.code, e.params);
  return (e.code ? e.code + ': ' : '') + e.message;
}

/** Voert een handeling uit; een fout komt als melding bovenaan, nooit als onbehandelde fout. */
export async function guarded(fn, event) {
  setBusy(1);
  const btn = event?.target?.closest?.('button');
  const hasTouch = btn && (btn.querySelector('use[*|href="#i-touch"], use[href="#i-touch"]') || btn.id === 'kn-add');
  if (btn && hasTouch) {
    btn.disabled = true;
    btn.classList.add('touch-busy');
    btn.querySelector('svg')?.classList.add('touch-animating');
  }
  try {
    clearSay();
    await fn();
  } catch (e) {
    say(errorText(e), 'error');
  } finally {
    if (btn && hasTouch) {
      btn.disabled = false;
      btn.classList.remove('touch-busy');
      btn.querySelector('svg')?.classList.remove('touch-animating');
    }
    setBusy(-1);
  }
}

export const on = (id, fn) => $(id).addEventListener('click', e => guarded(fn, e));

/**
 * Knoppen die een passkey-ceremonie starten, als één groep (id → handeling). Zolang er een loopt toont de gekozen knop
 * een laadteken en "wachten op je sleutel" (`aria-busy`), zijn alle knoppen van de groep uit en doet een tweede klik
 * niets: de browser weigert een tweede ceremonie terwijl de eerste loopt. Daarna, ook na een fout, komen ze terug.
 * @param {Record<string, () => Promise<void>|void>} handlers
 */
export function onCeremony(handlers) {
  const ids = Object.keys(handlers);
  let running = false;
  const start = id => {
    if (running) return;
    running = true;
    const buttons = ids.map($);
    const button = $(id);
    const content = [...button.childNodes];
    for (const b of buttons) b.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(clone(document, 'ceremony-busy'));
    return guarded(async () => {
      try { await handlers[id](); } finally {
        button.replaceChildren(...content);
        button.removeAttribute('aria-busy');
        for (const b of buttons) b.disabled = false;
        running = false;
      }
    });
  };
  for (const id of ids) $(id).addEventListener('click', () => start(id));
}

export const list = text => text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

/**
 * Vult een keuzelijst; de gekozen waarde blijft staan als ze nog bestaat. `withAll`: een eerste optie "alle" (of deze tekst).
 * `placeholder`: niets gekozen tot de gebruiker kiest.
 */
export function fillSelect(select, items, withAll, placeholder) {
  const keep = select.value;
  select.replaceChildren();
  if (withAll) select.append(new Option(typeof withAll === 'string' ? withAll : t('portal.common.all'), ''));
  // Een keuze die nog gemaakt moet worden: een lege, niet te kiezen optie met uitleg ("Choose a tool…").
  if (placeholder) { const hint = new Option(placeholder, ''); hint.disabled = true; select.append(hint); }
  for (const [label, value] of items) select.append(new Option(label, value));
  if ([...select.options].some(o => o.value === keep && !o.disabled)) select.value = keep;
  else if (placeholder) select.value = '';
}

/** Een host zoals de gebruiker hem kent: zonder `https://` (http blijft zichtbaar: dat is onversleuteld). */
export const domain = host => String(host ?? '').replace(/^https:\/\//, '');

/**
 * Sommige onderdelen bestaan één keer in de pagina (ze hebben vaste id's) maar worden op twee plekken gebruikt, bv. in het
 * welkom en in een tabblad. `place` zet het (enige) element met deze tag in `slot`, en maakt het aan als het er nog niet is.
 */
export function place(tag, slot) {
  const node = document.querySelector(tag) ?? document.createElement(tag);
  if (node.parentElement !== slot) slot.append(node);
  return node;
}

/**
 * Een oog naast een wachtwoordveld: `[data-reveal]` toont of verbergt het veld ervoor (in dezelfde `.join`). Het veld
 * mag de waarde tonen terwijl je typt; na opslaan staat ze nergens meer.
 * @param {ParentNode} root
 */
export function wireReveal(root) {
  for (const button of root.querySelectorAll('[data-reveal]')) {
    button.addEventListener('click', () => {
      const input = button.closest('.join').querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(input.type === 'text'));
    });
  }
}
