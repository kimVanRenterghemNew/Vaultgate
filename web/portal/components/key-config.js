// De dialoog met een nieuwe key na Rotate: de laatste stap van een key maken (ks-key-reveal), in een dialoog. Sluiten
// (Got it, ✕, Escape, ernaast klikken) wist de key uit de pagina: hij wordt nooit meer getoond.
import { $, define, t } from '../core/index.js';
import { revealKey, forgetKey } from './key-reveal.js';
import template from './key-config.html';

define('ks-key-config', {
  template,
  wire() {
    const dialog = $('kc-dialog');
    // Meteen bij de klik op sluiten (submit van een form method=dialog), niet pas bij het latere close-event.
    dialog.addEventListener('submit', forgetKey);
    dialog.addEventListener('close', forgetKey);
    dialog.addEventListener('key-done', () => dialog.close());
  },
});

/** Opent de dialoog met de nieuwe key en de configuratie voor `kind` (web of mcp). */
export function showKeyConfig(host, { key, kind }) {
  $('kc-title').textContent = t(kind === 'mcp' ? 'portal.keys.dialogTitleMcp' : 'portal.keys.dialogTitleWeb');
  revealKey($('kc-slot'), { key, kind });
  $('kc-dialog').showModal();
}
