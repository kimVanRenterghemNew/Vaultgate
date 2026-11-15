// Vaultgate's eigen bestanden zijn veranderd sinds de kluis hier het laatst openging (bv. het tray-script): de kluis opent
// pas als de gebruiker dat bewust aanvinkt. Dezelfde rode balk als een gewijzigde certificaatketen; refresh() laadt ze
// (zichtbaar zolang de kluis dicht is en er bestanden afwijken) met de lijst van bestanden.
import { $, define, state } from '../core/index.js';
import template from './integrity.html';

define('ks-integrity', {
  template,
  async load() {
    const files = state().unlocked ? [] : state().codeChanged ?? [];
    this.classList.toggle('hidden', files.length === 0);
    $('integrity-files').replaceChildren(...files.map(file => Object.assign(document.createElement('li'), { textContent: file })));
  },
});

/** Of de gebruiker bevestigt dat hij Vaultgate zelf bijwerkte of aanpaste (dan stuurt ontgrendelen `acceptCodeChange`). */
export const codeChangeAccepted = () => $('integrity-accept')?.checked === true;
