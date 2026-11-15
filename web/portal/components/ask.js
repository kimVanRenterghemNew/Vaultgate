// Een vraag in een dialoog van het portaal, in plaats van een grijze pop-up van de browser: bevestigen of annuleren, of
// een waarde invullen (een nieuwe secretwaarde in een wachtwoordveld). Eén dialoog in de pagina (in index.html).
// Na het sluiten is het invoerveld leeg: een ingevulde waarde blijft niet in de pagina staan.
import { $, clone, define, t, wireReveal } from '../core/index.js';
import template from './ask.html';

// De belofte van de vraag die nu open staat (hooguit één).
let answer = null;

/** Sluit de vraag af met `value` (null = geannuleerd) en wist het invoerveld. */
const settle = value => {
  const resolve = answer;
  answer = null;
  $('ask-input').value = '';
  resolve?.(value);
};

define('ks-ask', {
  template,
  wire() {
    const dialog = $('ask-dialog');
    $('ask-cancel').addEventListener('click', () => dialog.close(''));
    wireReveal(this);
    // Bevestigen, Enter, annuleren, Escape of naast de dialoog klikken: alles komt hier samen.
    dialog.addEventListener('close', () => {
      const input = $('ask-input');
      if (dialog.returnValue !== 'ok') settle(null);
      else settle(input.classList.contains('hidden') ? true : input.value);
    });
  },
});

/**
 * Stelt een vraag in de dialoog van het portaal. Zonder `input`: bevestigen geeft `true`. Met `input` ('text' of
 * 'password'): bevestigen geeft de ingevulde tekst (`value` staat klaar; nooit bij een wachtwoordveld). Annuleren geeft
 * `null`. `ok`: de i18n-sleutel van de bevestigknop. `warning`: een al vertaalde waarschuwing onder de vraag.
 * `items`: regels onder de vraag (bv. bestandspaden), elk `{ text, note? }`. `cancel: false`: alleen de bevestigknop (een melding).
 * @param {string} question al vertaald
 * @param {{ input?: 'text'|'password', value?: string, ok?: string, warning?: string, items?: { text: string, note?: string }[], cancel?: boolean }} [options]
 * @returns {Promise<string|true|null>}
 */
export function ask(question, { input, value = '', ok = 'portal.ask.ok', warning = '', items = [], cancel = true } = {}) {
  settle(null);
  $('ask-items').replaceChildren(...items.map(item => clone(document.querySelector('ks-ask'), 'item', item)));
  $('ask-items').classList.toggle('hidden', !items.length);
  $('ask-cancel').classList.toggle('hidden', !cancel);
  const dialog = $('ask-dialog');
  const field = $('ask-input');
  $('ask-question').textContent = question;
  $('ask-ok').textContent = t(ok);
  $('ask-warning-text').textContent = warning;
  $('ask-warning').classList.toggle('hidden', !warning);
  field.classList.toggle('hidden', !input);
  $('ask-field').classList.toggle('hidden', !input);
  $('ask-dialog').querySelector('[data-reveal]').classList.toggle('hidden', input !== 'password');
  field.type = input === 'password' ? 'password' : 'text';
  field.autocomplete = input === 'password' ? 'new-password' : 'off';
  field.value = input === 'password' ? '' : value;
  dialog.returnValue = '';
  return new Promise(resolve => {
    answer = resolve;
    dialog.showModal();
    if (input) field.focus();
  });
}
