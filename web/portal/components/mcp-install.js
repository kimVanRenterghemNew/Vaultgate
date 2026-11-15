// De MCP in de agents van deze pc zetten, of de JSON kopiëren. Staat in de stap met de nieuwe MCP-key
// (ks-key-reveal). De key gaat alleen naar het portaal (het bewijs); het portaal bewaart hem beschermd en de agent krijgt
// `--name`. De key staat nooit in de DOM van dit element; `forgetMcpKey` (bij Got it, sluiten, een nieuwe key) wist hem.
// Na elke actie die bestanden van een agent aanpaste, zegt een dialoog welke.
import { $, api, clone, copySecret, define, on, place, t } from '../core/index.js';
import { ask } from './ask.js';
import template from './mcp-install.html';

let currentKey = null;
let currentToolName = null;
let host = null;

/**
 * Toont welke bestanden vaultgate aanpaste, met de kopie van het oude bestand. Niets aangepast: geen dialoog.
 * @param {{ file: string, backup?: string|null }[]} files
 */
export function showChangedFiles(files = []) {
  if (!files.length) return;
  // Niet wachten op OK: de handeling is klaar, de melding blijft staan tot de gebruiker ze sluit.
  ask(t('portal.mcpInstall.changedTitle'), {
    items: files.map(f => ({ text: f.file, ...(f.backup ? { note: t('portal.mcpInstall.backupNote', { path: f.backup }) } : {}) })),
    cancel: false,
  });
}

const scope = () => {
  const project = $('mi-scope-project')?.checked;
  const folder = project ? $('mi-folder-input')?.value?.trim() : null;
  return { scope: project ? 'project' : 'user', ...(folder ? { folder } : {}) };
};

const statusText = result => t('portal.mcpInstall.status.' + result.status) + (result.reason ? ` (${result.reason})` : '');

/** Zet onder elke agent waar deze tool al staat (gebruiker of map), met Verwijderen per plek. */
async function showPlaces() {
  if (!currentToolName || !host) return;
  const res = await api('GET', `/api/mcp/installations?tool=${encodeURIComponent(currentToolName)}`).catch(() => ({ installations: [] }));
  const byAgent = Object.groupBy(res?.installations || [], item => item.agent);
  for (const row of $('mi-agents').children) {
    const places = byAgent[row.dataset.agent] || [];
    row.querySelector('[data-role="places"]').replaceChildren(...places.map(item => clone(host, 'installation-row', {
      scopeLabel: item.scope === 'project' ? t('portal.mcpInstall.scopeProject') : t('portal.mcpInstall.scopeUser'),
      displayPath: item.scope === 'project' ? item.folder : item.file,
      missing: item.status === 'missing' ? `(${t('portal.mcpInstall.missing')})` : '',
      project: item.scope === 'project', // voor alle mappen: Verwijderen staat al op de rij zelf
    }, {
      'remove-install': async () => {
        const { changed } = await api('POST', '/api/mcp/uninstall', { key: currentKey, agents: [item.agent], scope: item.scope, folder: item.folder });
        await showPlaces();
        showChangedFiles(changed);
      },
    })));
  }
}

function agentRow(agent) {
  const row = clone(host, 'agent', agent, {
    install: () => act('install'),
    uninstall: () => act('uninstall'),
  });
  row.dataset.agent = agent.id;
  const installed = isInstalled => {
    row.querySelector('[data-action="install"]').classList.toggle('hidden', isInstalled);
    row.querySelector('[data-action="uninstall"]').classList.toggle('hidden', !isInstalled);
  };
  async function act(action) {
    const { results: [result], changed } = await api('POST', `/api/mcp/${action}`, { key: currentKey, agents: [agent.id], ...scope() });
    row.querySelector('[data-role="status"]').textContent = statusText(result);
    if (['installed', 'updated', 'unchanged'].includes(result.status)) installed(true);
    if (['removed', 'absent'].includes(result.status)) installed(false);
    await showPlaces();
    showChangedFiles(changed);
  }
  if (agent.installed) {
    row.querySelector('[data-role="status"]').textContent = t('portal.mcpInstall.status.installed');
    installed(true);
  }
  return row;
}

async function skill(action) {
  const { results, changed } = await api('POST', `/api/mcp/skill/${action}`, { key: currentKey });
  const done = action === 'install' ? ['installed', 'updated'] : ['removed'];
  const status = results.some(r => done.includes(r.status)) ? (action === 'install' ? 'installed' : 'removed') : (action === 'install' ? 'unchanged' : 'absent');
  $('mi-skill-status').textContent = t('portal.mcpInstall.status.' + status);
  showChangedFiles(changed);
}

/** Werkt alle bestaande installaties bij en zegt welke bestanden veranderden. */
export async function refreshMcp({ auto = false } = {}) {
  const res = await api('POST', '/api/mcp/refresh', auto ? { auto: true } : {});
  if ($('mi-refresh-status') && !auto) $('mi-refresh-status').textContent = res.files.length ? '' : t('portal.mcpInstall.refreshNothing');
  showChangedFiles(res.files);
}

define('ks-mcp-install', {
  template,
  wire() {
    on('mi-copy', async () => {
      await copySecret(JSON.stringify(await api('POST', '/api/mcp/entry', { key: currentKey }), null, 2));
      $('mi-copy').textContent = t('portal.keys.copied');
    });
    on('mi-copy-vscode', async () => {
      await copySecret(JSON.stringify(await api('POST', '/api/mcp/entry', { key: currentKey, format: 'vscode' }), null, 2));
      $('mi-copy-vscode').textContent = t('portal.keys.copied');
    });
    on('mi-skill-install', () => skill('install'));
    on('mi-skill-uninstall', () => skill('uninstall'));
    on('mi-refresh', () => refreshMcp());
    on('mi-scope-user', () => $('mi-folder-box')?.classList.add('hidden'));
    on('mi-scope-project', () => {
      $('mi-folder-box')?.classList.remove('hidden');
      $('mi-folder-input')?.focus();
    });
  },
});

/** Wist de key uit dit element (bij "Got it", sluiten of een nieuwe key). */
export function forgetMcpKey() {
  currentKey = null;
  currentToolName = null;
}

/** Toont de agents op deze pc met een knop "Installeren", voor de MCP-tool van `key`, in `slot`. */
export async function showMcpInstall(slot, key) {
  host = place('ks-mcp-install', slot);
  currentKey = key;
  $('mi-copy').textContent = t('portal.mcpInstall.copyJson');
  $('mi-copy-vscode').textContent = t('portal.mcpInstall.copyJsonVscode');
  $('mi-folder-input').placeholder = t('portal.mcpInstall.folderPlaceholder');

  const tools = await api('GET', '/api/tools').catch(() => []);
  currentToolName = tools.find(tool => tool.kind === 'mcp')?.name || null;

  const agents = (await api('GET', '/api/mcp/agents')).filter(a => a.present);
  $('mi-agents').replaceChildren(...agents.map(agentRow));
  $('mi-none').classList.toggle('hidden', agents.length > 0);
  const state = await api('GET', '/api/state').catch(() => null);
  if (state?.proxyPort) $('mi-status-link').href = `http://127.0.0.1:${state.proxyPort}/mcp`;

  await showPlaces();
  return host;
}
