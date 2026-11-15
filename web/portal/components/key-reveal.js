// De key één keer, en de configuratie voor de tool: alleen de proxy en de eigen key, nooit de echte sleutel.
// Webrequests: de reverse route voor Anthropic en de forward-proxy voor elke andere API; MCP: de agents van deze pc om
// de MCP-server in te zetten, of de JSON (ks-mcp-install): daar staat de key niet in. Eén element in de pagina: het component om een key te maken zet het in zijn stap, Rotate in zijn dialoog
// (`revealKey`). "Got it", een ander scherm of een nieuwe key wist de key uit de pagina (`forgetKey`): hij wordt nooit
// meer getoond. Na "Got it": event `key-done`. Na kopiëren een korte uitleg over het wissen van het klembord.
import { $, clone, copySecret, define, guarded, on, place, state, t } from '../core/index.js';
import { showMcpInstall, forgetMcpKey } from './mcp-install.js';
import template from './key-reveal.html';

/** De regels om te plakken: alles in de configuratie behalve de uitleg (de regels met `#`). */
const configText = () => [...$('kr-config').querySelectorAll('pre:not([data-prefix="#"])')].map(p => p.textContent).join('\n');

/** Kopieert `text` naar het klembord (na 60 s weer weg); de knop zegt dat het gelukt is, de uitleg wat er nu gebeurt. */
const copy = async (id, text) => {
  await copySecret(text);
  $(id).textContent = t('portal.keys.copied');
  $('kr-copied-note').classList.remove('hidden');
};

/** Haalt de key en de configuratie weg uit de pagina en verbergt het element. */
export function forgetKey() {
  const el = document.querySelector('ks-key-reveal');
  if (!el) return;
  $('kr-key').textContent = '';
  $('kr-config').replaceChildren();
  forgetMcpKey();
  for (const id of ['kr-copy-key', 'kr-copy-config']) $(id).textContent = t('portal.keys.copy');
  $('kr-copied-note').classList.add('hidden');
  el.classList.add('hidden');
}

define('ks-key-reveal', {
  template,
  wire() {
    on('kr-copy-key', () => copy('kr-copy-key', $('kr-key').textContent));
    on('kr-copy-config', () => copy('kr-copy-config', configText()));
    on('kr-done', () => { forgetKey(); this.dispatchEvent(new CustomEvent('key-done', { bubbles: true })); });
  },
});

/** Toont `key` en de configuratie voor `kind` (web of mcp) in `slot`. */
export function revealKey(slot, { key, kind, secret = 'github_token' }) {
  const el = place('ks-key-reveal', slot);
  forgetKey();
  const s = state();
  const fields = { proxy: 'http://127.0.0.1:' + s.proxyPort, key, secret, main: s.mainScript ?? 'src/main.js' };
  $('kr-key').textContent = key;
  // MCP: geen key en geen configuratie om over te tikken; installeren of de JSON (met --name) kopiëren.
  for (const id of ['kr-key-part', 'kr-copy-config']) $(id).classList.toggle('hidden', kind === 'mcp');
  if (kind === 'mcp') guarded(() => showMcpInstall($('kr-config'), key));
  else $('kr-config').replaceChildren(clone(el, 'web', fields));
  el.classList.remove('hidden');
  return el;
}
