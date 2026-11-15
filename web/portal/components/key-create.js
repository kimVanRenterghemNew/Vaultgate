// Een virtuele key maken: één component, gebruikt door het welkom en door "Create key" bij Virtuele keys (elk zet het in
// zijn eigen vak met `place`). Drie stappen: de naam, de soort (webrequests of MCP), en hoe de tool haar key krijgt.
// Webrequests: koppelen (best: de tool haalt zelf haar key; de aanvraag verschijnt hier) of zelf instellen. MCP: de key
// maken en in de MCP-client zetten. Wat er bij gebruik gebeurt en hoe lang, kies je per toekenning, niet hier.
// Events: `tool-connected` (naam) als een tool gekoppeld is, `key-created` als hier een key gemaakt is. De key zelf staat
// één keer in de stap (ks-key-reveal); "Got it" geeft `key-done`.
import { api, $, t, list, on, place, guarded, define, fillCli } from '../core/index.js';
import { revealKey, forgetKey } from './key-reveal.js';
import template from './key-create.html';

const POLL_MS = 1500;
let poll = null;

/** Stopt het kijken naar nieuwe koppelingen (bij een andere stap of een ander tabblad). */
export const stopKeyCreate = () => { clearInterval(poll); poll = null; };

const toolName = () => $('kn-name').value.trim() || 'claude-code';

/** Een tool is gekoppeld (via een klik hier, of gezien in de lijst): melden. */
function markPaired(root, name) {
  $('kn-paired-text').textContent = t('portal.welcome.paired', { name });
  $('kn-paired').classList.remove('hidden');
  root.dispatchEvent(new CustomEvent('tool-connected', { bubbles: true, detail: { name } }));
}

/** Koppelen: de wachtende aanvragen en de tools ophalen en blijven kijken, zolang deze weg zichtbaar is. */
async function watchPairing(root) {
  // Ook de tools zelf: een tool die er nu nog niet is en later wel, is gekoppeld, ook als het toestaan in de tray
  // gebeurde (dan komt er geen `tool-paired`).
  const devices = place('ks-device-list', $('kn-device-slot'));
  const tools = place('ks-paired-tools', $('kn-tools-slot'));
  const known = new Set();
  const watch = async () => (await Promise.all([tools.load(), devices.load()]))[0];
  for (const k of await watch()) known.add(k.id);
  poll = setInterval(() => {
    if (root.offsetParent === null) { stopKeyCreate(); return; }
    watch().then(current => {
      for (const k of current) if (!known.has(k.id)) { known.add(k.id); markPaired(root, k.name); }
    }).catch(() => {});
  }, POLL_MS);
}

/** Markeert de gekozen kaart in een groep (`attr`: aria-checked voor de soort, aria-selected voor de weg). */
function pick(buttons, key, value, attr) {
  for (const b of buttons) b.setAttribute(attr, String(b.dataset[key] === value));
}

define('ks-key-create', {
  template,
  wire() {
    this.kind = 'web';
    this.way = 'pair';
    for (const b of this.querySelectorAll('[data-kind]')) b.addEventListener('click', () => guarded(async () => { this.kind = b.dataset.kind; await this.load(); }));
    for (const b of this.querySelectorAll('[data-way]')) b.addEventListener('click', () => guarded(async () => { this.way = b.dataset.way; await this.load(); }));
    $('kn-name').addEventListener('input', () => { $('kn-pair-cmd').dataset.cli = `login --name ${toolName()} --proxy {proxy}`; fillCli(this); });
    this.addEventListener('tool-paired', e => markPaired(this, e.detail.name));
    this.addEventListener('key-done', () => $('kn-form').classList.remove('hidden'));
    on('kn-copy-cmd', async () => { await navigator.clipboard.writeText($('kn-pair-cmd').textContent); $('kn-copy-cmd').textContent = t('portal.keys.copied'); });
    on('kn-add', async () => {
      const btn = $('kn-add');
      const icon = btn.querySelector('svg');
      btn.disabled = true;
      btn.classList.add('touch-busy');
      icon?.classList.add('touch-animating');
      try {
        const name = $('kn-name').value.trim();
        const r = await api('POST', '/api/tools', { name, clients: list($('kn-clients').value), kind: this.kind });
        $('kn-name').value = $('kn-clients').value = '';
        $('kn-form').classList.add('hidden');
        revealKey($('kn-reveal-slot'), { key: r.key, kind: this.kind });
        this.dispatchEvent(new CustomEvent('key-created', { bubbles: true, detail: { id: r.id, name, kind: this.kind } }));
      } finally {
        btn.disabled = false;
        btn.classList.remove('touch-busy');
        icon?.classList.remove('touch-animating');
      }
    });
  },
  async load() {
    stopKeyCreate();
    // Opnieuw openen: een key die hier nog stond, gaat weg.
    if ($('kn-reveal-slot').contains(document.querySelector('ks-key-reveal'))) forgetKey();
    $('kn-form').classList.remove('hidden');
    // MCP kent geen koppelen: de key gaat in de configuratie van de MCP-client.
    const way = this.kind === 'mcp' ? 'manual' : this.way;
    pick(this.querySelectorAll('[data-kind]'), 'kind', this.kind, 'aria-checked');
    pick(this.querySelectorAll('[data-way]'), 'way', way, 'aria-selected');
    for (const el of this.querySelectorAll('[data-kind-panel]')) el.classList.toggle('hidden', el.dataset.kindPanel !== this.kind);
    for (const el of this.querySelectorAll('[data-way-panel]')) el.classList.toggle('hidden', el.dataset.wayPanel !== way);
    fillCli(this);
    if (way === 'pair') await watchPairing(this);
  },
});
