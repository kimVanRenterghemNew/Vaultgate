// Instellingen als ledger (een paneel per groep, zoals de mockup): kluis en goedkeuringen (auto-vergrendelen, tijd om te
// antwoorden, aanraken met welke passkey), taal en thema bewaren zichzelf bij elke keuze; taal en thema per browser,
// de rest in de kluis. Andere machines, extra routes en rustige uren in een dialoog; alle meldingen even stilzetten
// met ks-pause.
import { api, $, t, say, guarded, list, clone, define, setLanguage, refresh, refreshHeader, theme, setTheme, forgetCsrf } from '../core/index.js';
import { pauseControl } from './pause.js';
import { ask } from './ask.js';
import template from './settings.html';

const stored = () => { try { return localStorage.getItem('vaultgate.lang') ?? ''; } catch { return ''; } };

/** Een keuzelijst met vaste waarden; een eerder gekozen waarde die er niet in staat, komt erbij. */
function choose(select, value, unit) {
  if (![...select.options].some(o => o.value === String(value))) select.append(new Option(`${value} ${unit}`, String(value)));
  select.value = String(value);
}

async function save(self, patch) {
  await api('PUT', '/api/settings', patch);
  await refreshHeader(); // een andere vergrendeltijd geldt meteen, ook voor de afteller in de kopbalk
  say(t('portal.settings.saved'), 'success');
  await self.load();
}

function routeRow(self, r = { name: '', base: '', secret: '', header: 'authorization' }) {
  const row = clone(self, 'route', {}, { remove: () => row.remove() });
  for (const part of ['name', 'base', 'secret', 'header']) row.querySelector(`[data-part="${part}"]`).value = r[part];
  return row;
}

define('ks-settings', {
  template,
  wire() {
    $('set-language').addEventListener('change', () => guarded(() => { setLanguage($('set-language').value); return refresh(); }));
    $('set-theme').addEventListener('change', () => setTheme($('set-theme').value));
    const auto = (id, patch) => $(id).addEventListener('change', () => guarded(() => save(this, patch())));
    auto('set-autolock', () => ({ autoLockMs: Number($('set-autolock').value) * 60_000 }));
    auto('set-timeout', () => ({ approvalTimeoutMs: Number($('set-timeout').value) * 1000 }));
    auto('set-touch', () => ({ touchAuthenticator: $('set-touch').value }));
    $('set-listeners-open').addEventListener('click', () => $('set-listeners-dialog').showModal());
    $('set-routes-open').addEventListener('click', () => $('set-routes-dialog').showModal());
    $('set-quiet-open').addEventListener('click', () => $('set-quiet-dialog').showModal());
    $('set-route-add').addEventListener('click', () => $('set-routes').append(routeRow(this)));
    $('set-listeners-save').addEventListener('click', () => guarded(async () => {
      const listeners = list($('set-listeners').value).map(l => { const i = l.lastIndexOf(':'); return { host: l.slice(0, i), port: Number(l.slice(i + 1)) }; });
      await save(this, { listeners });
      $('set-listeners-dialog').close();
    }));
    $('set-quiet-save').addEventListener('click', () => guarded(async () => {
      await save(this, { quietHours: list($('set-quiet').value) });
      $('set-quiet-dialog').close();
    }));
    $('set-routes-save').addEventListener('click', () => guarded(async () => {
      const routes = [...$('set-routes').querySelectorAll('[data-route]')].map(row => Object.fromEntries(['name', 'base', 'secret', 'header'].map(p => [p, row.querySelector(`[data-part="${p}"]`).value.trim()])));
      await save(this, { routes });
      $('set-routes-dialog').close();
    }));
    $('set-delete-vault').addEventListener('click', () => guarded(async () => {
      const confirmed = await ask(t('portal.settings.deleteVaultConfirm'), {
        ok: 'portal.settings.deleteVault',
        warning: t('portal.settings.deleteVaultWarning'),
      });
      if (!confirmed) return;
      await api('POST', '/api/vault/delete');
      forgetCsrf();
      say(t('portal.settings.vaultDeleted'), 'success');
      await refresh();
    }));
  },
  async load() {
    $('set-language').value = stored();
    $('set-theme').value = theme();
    const s = await api('GET', '/api/settings');
    choose($('set-autolock'), s.autoLockMs / 60_000, 'min');
    choose($('set-timeout'), s.approvalTimeoutMs / 1000, 's');
    $('set-touch').value = s.touchAuthenticator;
    $('set-listeners').value = s.listeners.map(l => l.host + ':' + l.port).join('\n');
    $('set-listeners-now').textContent = s.listeners.length ? s.listeners.map(l => l.host + ':' + l.port).join(', ') : t('portal.settings.listenersNone');
    $('set-quiet').value = s.quietHours.join('\n');
    $('set-quiet-now').textContent = s.quietHours.length ? s.quietHours.join(', ') : t('portal.settings.quietNone');
    // Globaal betekent een einde van null "niet stil": stilzetten kan alleen voor een tijd.
    $('set-silence').replaceChildren(pauseControl({
      id: 'set-silence', kind: 'silence', until: s.notificationSnooze?.globalUntil ?? undefined,
      pause: async until => { await api('POST', '/api/snooze/global', { until }); await this.load(); },
      resume: async () => { await api('POST', '/api/snooze/global', { until: null }); await this.load(); },
    }));
    $('set-routes').replaceChildren(...s.routes.map(r => routeRow(this, r)));
    $('set-routes-now').textContent = s.routes.length ? s.routes.map(r => '/' + r.name + ' → ' + r.base).join(', ') : t('portal.settings.routesNone');
  },
});
