// Virtuele keys (tools) als inspector: bovenaan de tools die willen koppelen (ks-device-list), links de lijst (naam,
// soort, actief of ingetrokken), rechts de gekozen key: of ze vanzelf roteert (gekoppeld) of handmatig is en wat
// Vaultgate daarvoor doet, vanaf waar ze mag komen, haar toekenningen (secret → domein, hoe lang nog), tijdelijk
// blokkeren (ks-pause), en Edit, Rotate (eerst een waarschuwing, dan de nieuwe key één keer), intrekken of heractiveren.
// De key zelf staat nergens: alleen bij aanmaken en na Rotate, één keer (de kluis bewaart alleen een hash).
// "Create key" is hetzelfde component als stap 3 van het welkom (ks-key-create).
import { api, $, t, clone, date, domain, list, on, place, guarded, define, inspector } from '../core/index.js';
import { showKeyConfig } from './key-config.js';
import { ask } from './ask.js';
import { blockControl } from './pause.js';
import { leftText } from './grants.js';
import { stopKeyCreate } from './key-create.js';
import { forgetKey } from './key-reveal.js';
import template from './tools.html';

const createOpen = () => $('tools-create-card').open;

/** Opent "Create key" (het component om een key te maken) in zijn dialoog. */
const openCreate = async () => {
  if (!createOpen()) $('tools-create-card').showModal();
  await place('ks-key-create', $('tools-ways-slot')).load();
};

/** Wachtende koppelingen bovenaan; niet als "Create key" open staat (dan toont dat component ze bij koppelen). */
async function loadWaiting() {
  if (createOpen()) { $('tools-waiting').classList.add('hidden'); return; }
  await place('ks-device-list', $('tools-device-slot')).load();
  $('tools-waiting').classList.toggle('hidden', $('device').children.length === 0);
}

/** "Opnieuw om mijn passkey vragen": uit of elke zoveel uur. */
const REASK_HOURS = [0, 1, 4, 8, 24];
const reaskOptions = current => REASK_HOURS.map(h => {
  const option = new Option(h ? t('portal.keys.reaskHours', { hours: h }) : t('portal.keys.reaskOff'), String(h * 3_600_000));
  option.selected = h * 3_600_000 === current;
  return option;
});

/** Edit: de naam, of de key ook van andere adressen mag komen, en "opnieuw om mijn passkey vragen". */
function openEdit(tool, reload) {
  const other = tool.clients.length > 0;
  $('te-reask').replaceChildren(...reaskOptions(tool.reaskMs));
  $('te-title').textContent = t('portal.keys.editTitle', { name: tool.name });
  $('te-name').value = tool.name;
  $('te-other').checked = other;
  $('te-clients').value = tool.clients.join(', ');
  $('te-clients').classList.toggle('hidden', !other);
  $('tools-edit').onsave = async () => {
    const name = $('te-name').value.trim();
    if (name !== tool.name) await api('PUT', '/api/tools/' + tool.id + '/name', { name });
    await api('PUT', '/api/tools/' + tool.id + '/clients', { clients: $('te-other').checked ? list($('te-clients').value) : [] });
    const reaskMs = Number($('te-reask').value);
    if (reaskMs !== tool.reaskMs) await api('PUT', '/api/tools/' + tool.id + '/reask', { reaskMs });
    $('tools-edit').close();
    await reload();
  };
  $('tools-edit').showModal();
}

define('ks-tools', {
  template,
  wire() {
    on('tools-create', async () => { await openCreate(); await loadWaiting(); });
    on('te-save', () => $('tools-edit').onsave());
    $('te-other').addEventListener('change', () => $('te-clients').classList.toggle('hidden', !$('te-other').checked));
    // Een key gemaakt of een tool gekoppeld: in de lijst. "Got it": de kaart dicht (de key is dan al uit de pagina).
    this.addEventListener('key-created', () => this.loadList());
    this.addEventListener('tool-connected', () => this.loadList());
    this.addEventListener('key-done', () => $('tools-create-card').close());
    // Dicht (Got it, Escape, ×, ernaast klikken): een getoonde key gaat uit de pagina, het koppelen stopt.
    $('tools-create-card').addEventListener('close', () => guarded(() => { forgetKey(); stopKeyCreate(); return this.load(); }));
    this.addEventListener('tool-paired', () => this.load());
    this.loadList = () => loadList(this);
  },
  async load() {
    if (createOpen()) await openCreate();
    await Promise.all([loadWaiting(), loadList(this)]);
  },
});

/** Een toekenning van de key: secret → domein en hoe lang nog. */
const grantRow = (tpl, g) => clone(tpl, 'grant', {
  secret: g.secretName, host: domain(g.host),
  left: !g.expiresAt ? t('portal.duration.always') : g.expiresAt > Date.now() ? leftText(g.expiresAt - Date.now()) : t('portal.grants.expired'),
});

async function loadList(self) {
  const [tools, grants, blocks] = await Promise.all([api('GET', '/api/tools'), api('GET', '/api/grants'), api('GET', '/api/blocks')]);
  const tpl = $('tools-templates');
  const reload = () => self.load();
  const detail = k => {
    const own = grants.filter(g => g.toolId === k.id || g.toolName === k.name);
    const hosts = [...new Set(own.map(g => domain(g.host)))].sort();
    const grantRows = document.createDocumentFragment();
    grantRows.append(...(own.length ? own.map(g => grantRow(tpl, g)) : [clone(tpl, 'no-grants')]));
    return clone(tpl, 'detail', {
      name: k.name, mcp: k.kind === 'mcp', revoked: k.revoked, rotating: k.rotating, grants: grantRows,
      domains: hosts.length ? hosts.join(', ') : t('portal.keys.noDomains'),
      clients: k.clients.length ? t('portal.keys.thisPcAnd', { list: k.clients.join(', ') }) : t('portal.keys.thisPcOnly'),
      pause: k.revoked ? '' : blockControl('tool-block-' + k.name, blocks, { kind: 'tool', toolId: k.id }, reload),
      since: t('portal.keys.created', { date: date(k.createdAt) }),
    }, {
      edit: () => openEdit(k, reload),
      rotate: async () => {
        if (!(await ask(t('portal.keys.rotateConfirm', { name: k.name }), { ok: 'portal.keys.rotate', warning: t('portal.keys.rotateWarning') }))) return;
        const r = await api('POST', '/api/tools/' + k.id + '/rotate');
        showKeyConfig($('key-config'), { key: r.key, kind: k.kind });
        await loadList(self);
      },
      reactivate: async () => { if (await ask(t('portal.keys.reactivateConfirm', { name: k.name }), { ok: 'portal.keys.reactivate' })) { await api('POST', '/api/tools/' + k.id + '/reactivate'); await reload(); } },
      revoke: async () => {
        if (await ask(t('portal.keys.revokeConfirm', { name: k.name }), { ok: 'portal.keys.revoke' })) {
          await api('POST', '/api/tools/' + k.id + '/revoke');
          await reload();
        }
      },
    });
  };
  const rows = tools.map(k => ({ row: clone(tpl, 'row', { name: k.name, mcp: k.kind === 'mcp', revoked: k.revoked }), item: k }));
  $('tools-active').textContent = String(tools.filter(k => !k.revoked).length);
  $('tools-revoked').textContent = String(tools.filter(k => k.revoked).length);
  $('tools-count').textContent = t('portal.keys.count', { count: tools.length });
  inspector($('tools'), $('tools-detail'), rows, { keyOf: k => k.id, render: detail, empty: () => clone(tpl, 'pick') });
  if (!rows.length) $('tools').replaceChildren(clone(tpl, 'empty'));
}
