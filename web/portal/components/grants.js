// Toekenningen tool × secret × domein als inspector: links de lijst (tool gebruikt secret, domein, hoe lang nog),
// filteren op key en secret; rechts de gekozen toekenning: hoe lang nog als lezing, de keten, wat er bij gebruik gebeurt,
// waar ze gegeven werd, een tijdelijke regel erboven, stilzetten en blokkeren (ks-pause), en Delete, de tijdelijke regel
// beëindigen en Edit (bij gebruik, verlengen). Toevoegen in een dialoog zonder voorinvulling: het domein kies je uit de
// domeinen van het gekozen secret, standaard met een melding en één uur. Bovenop een vaste toekenning wordt een
// toekenning met een looptijd een tijdelijke regel: daarna geldt de vaste weer.
import { api, $, t, guarded, on, clone, clock, domain, fillSelect, define, inspector } from '../core/index.js';
import { ask } from './ask.js';
import { blockControl, pauseControl } from './pause.js';
import template from './grants.html';

const MINUTE = 60_000;

/** Hoe lang nog, kort: "28 min left", "3 h left". */
export const leftText = ms => (ms < 90 * MINUTE ? t('portal.grants.leftMin', { n: Math.max(1, Math.round(ms / MINUTE)) }) : t('portal.grants.leftHours', { n: Math.round(ms / (60 * MINUTE)) }));

/** Een oudere key met een eigen standaard ("bij gebruik", "geldig") zet die klaar; anders melding en één uur. */
function defaults(tools = []) {
  const tool = tools.find(x => x.id === $('g-tool').value);
  const own = tool && (tool.onUse !== 'silent' || tool.validMs > 0);
  $('g-mode').value = own ? tool.onUse : 'notify';
  const duration = own ? String(tool.validMs) : '3600000';
  // "Always" alleen voor een key die vanzelf roteert; een handmatige key hoogstens 4 uur (de server dwingt het ook af).
  const always = $('g-duration').querySelector('option[value="0"]');
  always.disabled = Boolean(tool) && !tool.rotating;
  if ([...$('g-duration').options].some(o => o.value === duration && !o.disabled)) $('g-duration').value = duration;
  else if ($('g-duration').selectedOptions[0]?.disabled) $('g-duration').value = '14400000';
}

/** De domeinen van het gekozen secret. */
function hostChoices(secrets = []) {
  const secret = secrets.find(s => s.name === $('g-secret').value);
  const hosts = (secret?.hosts ?? []).map(h => [domain(h), h]);
  // Alle domeinen: één toekenning per domein, geen joker die later stil meegroeit met het secret.
  fillSelect($('g-host'), hosts.length > 1 ? [...hosts, [t('portal.grants.allDomains'), '*']] : hosts, false, t('portal.grants.chooseDomain'));
}

const chainOf = (self, g) => clone(self, 'chain', { tool: g.toolName, secret: g.secretName, host: domain(g.host) });

function leftOf(self, g) {
  const left = g.expiresAt ? g.expiresAt - Date.now() : null;
  return clone(self, 'left', {
    forever: !g.expiresAt, running: left > 0, expired: left !== null && left <= 0, left: left > 0 ? leftText(left) : '',
    origin: t(g.origin === 'tray' ? 'portal.grants.fromTray' : 'portal.grants.fromPortal'),
  });
}

/** Edit: "bij gebruik" wijzigen laat de resterende tijd staan, tenzij je verlengt. */
function openEdit(self, g) {
  $('ge-chain').replaceChildren(chainOf(self, g));
  $('ge-left').replaceChildren(leftOf(self, g));
  $('ge-mode').value = g.mode ?? 'silent';
  $('ge-extend').value = g.expiresAt && g.expiresAt > Date.now() ? 'keep' : '3600000'; // verlopen: verlengen ligt voor de hand
  $('ge-dialog').onsave = async () => {
    const extend = $('ge-extend').value;
    // Verlengen telt vanaf het huidige einde (of nu, als het verlopen is); de API rekent vanaf nu.
    const durationMs = extend === 'keep' ? undefined : extend === '0' ? 0 : Math.max(g.expiresAt ?? 0, Date.now()) + Number(extend) - Date.now();
    await api('PUT', '/api/grants/' + g.id, { mode: $('ge-mode').value, ...(durationMs !== undefined ? { durationMs } : {}) });
    $('ge-dialog').close();
    await self.load();
  };
  $('ge-dialog').showModal();
}

/** Meldingen van deze toekenning stilzetten (alleen bij "met een melding"); een vraag in de tray blijft altijd vragen. */
function silenceOf(self, g, snooze) {
  const entry = (snooze?.grants ?? []).find(x => x.grantId === g.id);
  return pauseControl({
    id: 'grant-silence-' + g.toolName + '-' + g.secretName, kind: 'silence', until: entry ? entry.until : undefined,
    pause: async until => { await api('POST', '/api/snooze/grant', { grantId: g.id, until }); await self.load(); },
    resume: async () => { await api('DELETE', '/api/snooze/grant/' + g.id); await self.load(); },
  });
}

define('ks-grants', {
  template,
  wire() {
    /**
     * De dialoog openen, leeg of (vanuit Activity: "Renew grant") met tool, secret en domein ingevuld. `newHost`
     * ("Allow as new grant"): het domein staat nog niet bij het secret; het is een eigen keuze en komt er bij Grant bij.
     */
    this.openAdd = ({ toolName = '', secretName = '', host = '', newHost = false } = {}) => {
      $('g-tool').value = this.tools?.find(x => x.name === toolName)?.id ?? '';
      $('g-secret').value = this.secrets?.some(x => x.name === secretName) ? secretName : '';
      hostChoices(this.secrets); defaults(this.tools);
      if (newHost && $('g-secret').value && ![...$('g-host').options].some(o => o.value === host)) {
        const option = new Option(t('portal.grants.newDomain', { host: domain(host) }), host);
        option.dataset.new = '1';
        $('g-host').append(option);
      }
      if ([...$('g-host').options].some(o => o.value === host)) $('g-host').value = host;
      $('g-dialog').showModal();
    };
    on('g-open', () => this.openAdd());
    on('g-add', async () => {
      const secret = this.secrets.find(x => x.name === $('g-secret').value);
      const hosts = $('g-host').value === '*' ? secret.hosts : [$('g-host').value];
      const addHost = $('g-host').selectedOptions[0]?.dataset.new === '1' ? { addHost: true } : {};
      for (const host of hosts) await api('POST', '/api/grants', { toolId: $('g-tool').value, secretName: $('g-secret').value, host, durationMs: Number($('g-duration').value), mode: $('g-mode').value, ...addHost });
      $('g-dialog').close();
      await this.load();
    });
    on('ge-save', () => $('ge-dialog').onsave());
    for (const id of ['g-filter-tool', 'g-filter-secret']) $(id).addEventListener('change', () => guarded(() => this.load()));
    $('g-tool').addEventListener('change', () => defaults(this.tools));
    $('g-secret').addEventListener('change', () => hostChoices(this.secrets));
  },
  async load() {
    const [tools, secrets, blocks, snooze] = await Promise.all([api('GET', '/api/tools'), api('GET', '/api/secrets'), api('GET', '/api/blocks'), api('GET', '/api/snooze')]);
    this.tools = tools; this.secrets = secrets;
    const toolItems = tools.map(x => [x.name, x.id]);
    const secretItems = secrets.map(s => [s.name, s.name]);
    fillSelect($('g-tool'), toolItems, false, t('portal.grants.chooseTool'));
    fillSelect($('g-secret'), secretItems, false, t('portal.grants.chooseSecret'));
    hostChoices(secrets);
    fillSelect($('g-filter-tool'), toolItems, t('portal.grants.allTools')); fillSelect($('g-filter-secret'), secretItems, t('portal.grants.allSecrets'));
    const q = new URLSearchParams({ tool: $('g-filter-tool').value, secret: $('g-filter-secret').value });
    const grants = await api('GET', '/api/grants?' + q);
    const state = g => {
      const left = g.expiresAt ? g.expiresAt - Date.now() : null;
      return { forever: !g.expiresAt, running: left > 0, expired: left !== null && left <= 0, left: left > 0 ? leftText(left) : '' };
    };
    const idOf = g => g.toolName + '-' + g.secretName;
    const detail = g => {
      const st = state(g);
      const temporary = Boolean(g.overrideUntil) && g.overrideUntil > Date.now();
      const node = clone(this, 'detail', {
        ...st, id: idOf(g), chain: chainOf(this, g),
        note: st.running ? t('portal.grants.noteRunning', { time: clock(g.expiresAt) }) : t(st.expired ? 'portal.grants.noteExpired' : 'portal.grants.noteAlways'),
        pause: blockControl('grant-block-' + idOf(g), blocks, { kind: 'grant', toolId: g.toolId, secretName: g.secretName, host: g.host }, () => this.load()),
        silence: g.mode === 'notify' ? silenceOf(this, g, snooze) : '',
        mode: t('portal.mode.' + (g.mode ?? 'silent') + 'Long'),
        origin: t(g.origin === 'tray' ? 'portal.grants.fromTray' : 'portal.grants.fromPortal'),
        editLabel: t(st.expired ? 'portal.grants.renew' : 'portal.keys.edit'),
        // Een tijdelijke regel boven deze (bv. "laat me het komende uur met rust" in de tray): ze geldt nu, daarna weer de vaste.
        temporary, temporaryLeft: temporary ? leftText(g.overrideUntil - Date.now()) : '',
        temporaryText: temporary ? t('portal.grants.temporary', { mode: t('portal.mode.' + g.overrideMode + 'Long') }) : '',
      }, {
        endTemporary: async () => { await api('PUT', '/api/grants/' + g.id, { endOverride: true }); await this.load(); },
        edit: () => openEdit(this, g),
        revoke: async () => {
          if (await ask(t('portal.grants.revokeConfirm', { chain: g.toolName + ' → ' + g.secretName + ' → ' + domain(g.host) }), { ok: 'portal.grants.revoke' })) {
            await api('DELETE', '/api/grants/' + g.id); await this.load();
          }
        },
      });
      if (st.expired) node.querySelector('[data-icon]').setAttribute('href', '#i-rotate');
      return node;
    };
    const rows = grants.map(g => ({ row: clone(this, 'row', { ...state(g), id: idOf(g), tool: g.toolName, secret: g.secretName, host: domain(g.host) }), item: g }));
    $('grants-active').textContent = String(grants.filter(g => !state(g).expired).length);
    $('grants-expired').textContent = String(grants.filter(g => state(g).expired).length);
    inspector($('grants'), $('grant-detail'), rows, { keyOf: g => g.id, render: detail, empty: () => clone(this, 'pick') });
    if (!rows.length) $('grants').replaceChildren(clone(this, 'empty'));
  },
});
