// Secrets als inspector: toevoegen in een dialoog (de waarde gaat erin, nooit eruit; Sensitive staat standaard aan);
// links de secrets (naam, domein, gevoelig, aantal toekenningen), rechts het gekozen secret: domeinen, waar het
// ingevuld wordt, wanneer een aanraking nodig is, sinds wanneer de waarde gezet is, de toekenningen (tool → domein),
// tijdelijk blokkeren (ks-pause), en Edit (naam, domeinen als chips, gevoelig), Rotate (een nieuwe waarde in een
// wachtwoordveld) en Delete (met de toekenningen die meegaan). Waar het secret in de request komt, kiest de gebruiker
// niet: de eerste toegestane call legt het vast.
import { api, $, t, say, on, clone, date, list, domain, define, wireReveal, inspector } from '../core/index.js';
import { ask } from './ask.js';
import { blockControl } from './pause.js';
import { leftText } from './grants.js';
import template from './secrets.html';

const grantsText = n => t(n === 0 ? 'portal.secrets.grantsNone' : n === 1 ? 'portal.secrets.grantsOne' : 'portal.secrets.grants', { count: n });

/** Edit: de naam, de domeinen als chips (het eerste is het hoofddomein), en of het secret gevoelig is. */
function openEdit(self, s) {
  let hosts = [...s.hosts];
  const draw = () => $('se-chips').replaceChildren(...hosts.map((h, i) => {
    const chip = clone(self, 'chip', { host: domain(h) }, { remove: () => { hosts = hosts.filter(x => x !== h); draw(); } });
    chip.classList.add(i === 0 ? 'badge-primary' : 'badge-outline');
    if (hosts.length === 1) chip.querySelector('button').remove(); // minstens één domein
    return chip;
  }));
  // Waar het secret ingevuld wordt: geleerde plekken als chips; alles weg = de volgende call leert opnieuw.
  let places = s.inject ? [...s.inject] : null;
  const drawPlaces = () => {
    $('se-places').replaceChildren(...(places ?? []).map(place => clone(self, 'place', { place }, { remove: () => { places = places.filter(x => x !== place); drawPlaces(); } })));
    $('se-places-empty').classList.toggle('hidden', places?.length !== 0);
  };
  $('se-places-box').classList.toggle('hidden', !places); // een oud secret (elke header): geen plekken om te tonen
  drawPlaces();
  $('se-title').textContent = t('portal.secrets.editTitle', { name: s.name });
  $('se-sensitive').checked = s.sensitive;
  // Een andere naam: tools die de plaatshouder met de oude naam gebruiken, moeten mee veranderen.
  $('se-name').value = s.name;
  $('se-name-warning-text').textContent = t('portal.secrets.renameWarning', { old: s.name });
  $('se-name').oninput = () => $('se-name-warning').classList.toggle('hidden', $('se-name').value.trim() === s.name);
  $('se-name-warning').classList.add('hidden');
  $('se-add').value = '';
  $('se-add').onkeydown = e => {
    if (e.key !== 'Enter' || !$('se-add').value.trim()) return;
    e.preventDefault();
    hosts = [...new Set([...hosts, ...list($('se-add').value)])];
    $('se-add').value = ''; draw();
  };
  $('se-dialog').onsave = async () => {
    hosts = [...new Set([...hosts, ...list($('se-add').value)])]; // een getypt domein zonder Enter telt ook
    const name = $('se-name').value.trim();
    if (name !== s.name) await api('PUT', '/api/secrets/' + s.id + '/name', { name });
    await api('PUT', '/api/secrets/' + s.id + '/hosts', { hosts });
    if (places && places.join() !== s.inject.join()) await api('PUT', '/api/secrets/' + s.id + '/inject', { inject: places });
    if ($('se-sensitive').checked !== s.sensitive) await api('PUT', '/api/secrets/' + s.id + '/sensitive', { sensitive: $('se-sensitive').checked });
    $('se-dialog').close();
    await self.load();
  };
  draw();
  $('se-dialog').showModal();
}

define('ks-secrets', {
  template,
  wire() {
    wireReveal(this);
    let currentKind = 'key';
    const setKind = kind => {
      currentKind = kind;
      const isLogin = kind === 'login';
      $('s-pick-key').setAttribute('aria-checked', String(!isLogin));
      $('s-pick-key').classList.toggle('opacity-75', isLogin);
      $('s-pick-login').setAttribute('aria-checked', String(isLogin));
      $('s-pick-login').classList.toggle('opacity-75', !isLogin);
      $('s-panel-key').classList.toggle('hidden', isLogin);
      $('s-panel-login').classList.toggle('hidden', !isLogin);
    };
    on('s-pick-key', () => setKind('key'));
    on('s-pick-login', () => setKind('login'));
    this.openAdd = ({ name = '', host = '' } = {}) => {
      setKind('key');
      $('s-sensitive').checked = true;
      if (name) $('s-name').value = name;
      if (host) $('s-hosts').value = host;
      $('s-dialog').showModal();
      if (name) $('s-value').focus(); else $('s-name').focus();
    };
    on('s-open', () => this.openAdd());
    on('se-save', () => $('se-dialog').onsave());
    on('s-add', async () => {
      const name = $('s-name').value.trim();
      const hosts = list($('s-hosts').value);
      const sensitive = $('s-sensitive').checked;
      if (currentKind === 'login') {
        await api('POST', '/api/secrets', { kind: 'login', name, username: $('s-username').value.trim(), password: $('s-password').value, hosts, inject: [], sensitive });
      } else {
        await api('POST', '/api/secrets', { kind: 'key', name, value: $('s-value').value, hosts, inject: [], sensitive });
      }
      for (const id of ['s-name', 's-value', 's-username', 's-password', 's-hosts']) $(id).value = '';
      $('s-value').type = 'password';
      $('s-password').type = 'password';
      $('s-dialog').close();
      say(t('portal.secrets.saved')); await this.load();
    });
    // Sluiten zonder opslaan: de getypte waarde blijft niet in de pagina staan.
    $('s-dialog').addEventListener('close', () => {
      for (const id of ['s-value', 's-password', 's-username']) $(id).value = '';
      $('s-value').type = 'password';
      $('s-password').type = 'password';
    });
  },
  async load() {
    const [secrets, grants, blocks] = await Promise.all([api('GET', '/api/secrets'), api('GET', '/api/grants'), api('GET', '/api/blocks')]);
    const detail = s => {
      const own = grants.filter(g => g.secretName === s.name);
      const grantRows = document.createDocumentFragment();
      grantRows.append(...(own.length ? own.map(g => clone(this, 'grant', {
        tool: g.toolName, host: domain(g.host),
        left: !g.expiresAt ? t('portal.duration.always') : g.expiresAt > Date.now() ? leftText(g.expiresAt - Date.now()) : t('portal.grants.expired'),
      })) : [clone(this, 'no-grants')]));
      return clone(this, 'detail', {
        name: s.name, sensitive: s.sensitive, pause: blockControl('secret-block-' + s.name, blocks, { kind: 'secret', secretName: s.name }, () => this.load()),
        kindNote: t(s.kind === 'login' ? 'portal.secrets.kindLoginNote' : 'portal.secrets.kindKeyNote'),
        host: domain(s.hosts[0] ?? ''), subdomains: s.hosts.slice(1).map(domain).join(', '), grants: grantRows,
        // Zonder instelling (een oud secret): elke header, nooit de query.
        inject: !s.inject ? t('portal.secrets.legacyInject') : s.inject.length ? s.inject.join(', ') : t('portal.secrets.learning'),
        touch: t(s.sensitive ? 'portal.secrets.touchSensitive' : 'portal.secrets.touchGrant'),
        updated: t('portal.secrets.valueSet', { date: date(s.updatedAt) }),
      }, {
        edit: () => openEdit(this, s),
        rotate: async () => {
          const v = await ask(t('portal.secrets.rotatePrompt', { name: s.name }), { input: 'password', ok: 'portal.secrets.rotate', warning: t('portal.secrets.rotateWarning') });
          if (v) { await api('POST', '/api/secrets/' + s.id + '/rotate', { value: v }); await this.load(); }
        },
        revoke: async () => {
          const warning = own.length ? t('portal.secrets.revokeGrants', { list: own.map(g => g.toolName + ' → ' + s.name + ' → ' + domain(g.host)).join('; ') }) : '';
          if (await ask(t('portal.secrets.revokeConfirm', { name: s.name }), { ok: 'portal.secrets.revoke', warning })) { await api('DELETE', '/api/secrets/' + s.id); await this.load(); }
        },
      });
    };
    const rows = secrets.map(s => ({
      row: clone(this, 'row', {
        name: s.name,
        isKey: s.kind !== 'login',
        isLogin: s.kind === 'login',
        sensitive: s.sensitive,
        host: domain(s.hosts[0] ?? ''),
        grantCount: grantsText(grants.filter(g => g.secretName === s.name).length),
      }),
      item: s,
    }));
    $('secrets-total').textContent = String(secrets.length);
    $('secrets-sensitive').textContent = String(secrets.filter(s => s.sensitive).length);
    $('secrets-count').textContent = t('portal.keys.count', { count: secrets.length });
    inspector($('secrets'), $('secret-detail'), rows, { keyOf: s => s.id, render: detail, empty: () => clone(this, 'pick') });
    if (!rows.length) $('secrets').replaceChildren(clone(this, 'empty'));
  },
});
