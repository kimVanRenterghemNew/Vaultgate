// Activiteit als inspector: links het logboek (tijd, wie, waar, het stempel met de regelnaam: het bewijs), rechts de
// gekozen beslissing groot, met de zin in gewone taal, de keten tool → secret → host, de feiten en wat je kunt doen.
// Herhaalde beslissingen zijn één rij met een aantal (×100). Bovenaan: vandaag in cijfers en wat op je wacht (ks-waiting).
// Tegengehouden krijgt een rustige kleur; rood voor alarm: een secret dat naar een host buiten de allowlist moest (wat
// Vaultgate precies tegenhoudt), een andere certificaatketen, geen audit.
// Beheer (een wijziging aan secrets, tools, toekenningen, passkeys of instellingen) heeft een eigen stempel en toont
// waar het gebeurde en wat er veranderde (oud → nieuw, nooit een waarde).
import { api, $, t, has, on, guarded, clone, clock, define, setTab, inspector } from '../core/index.js';
import { ask } from './ask.js';
import { groupEntries } from './audit-group.js';
import './waiting.js';
import template from './audit.html';

const ALARM = new Set(['tls-chain-changed', 'tls-untrusted', 'audit-unavailable', 'key-reuse-detected', 'internal-error']);
const WARN = new Set(['target-host-not-allowed', 'throttled', 'quiet-hours']);
// Tegengehouden of onderschept: rustig (schild). Een onderschepte waarde is goed nieuws, geen alarm.

// Een gevraagde toegang die niet doorging: "Renew grant" opent een toekenning met tool, secret en domein ingevuld.
// Een host buiten de domeinen van het secret (oranje): "Allow as new grant" doet hetzelfde, en het domein komt bij het secret.
const RENEW = new Set(['grant-expired', 'approval-denied', 'approval-timeout', 'approval-unavailable']);

/** De kleur van de lezing (de regelnaam groot rechts) per soort stempel; beheer blijft inktkleur. */
const READING = { pass: 'reading-ok', shield: 'reading-cool', warn: 'reading-warn', alarm: 'reading-bad' };

/** Herkent dezelfde beslissing na het opnieuw laden van het logboek. */
const keyOf = e => [e.t, e.rule, e.tool, e.host, e.mode].join('|');

/** Datum en tijd volgens de klok van de gebruiker. */
const dateTime = ms => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });

const stampKind = e => (e.mode === 'admin' ? 'admin' : ALARM.has(e.rule) ? 'alarm' : WARN.has(e.rule) ? 'warn' : e.allow ? 'pass' : 'shield');

/** Bij beheer: waar het gebeurde ("in the portal") en wat er veranderde. */
const via = e => (has('portal.audit.via.' + e.origin) ? t('portal.audit.via.' + e.origin) : e.origin);
const change = e => [via(e), e.detail].filter(Boolean).join(' · ');

/** De zin bij een regel; een onbekende regel krijgt de algemene zin voor toegestaan of tegengehouden. */
function sentence(e) {
  const params = { tool: e.tool || '?', secret: e.secret || '?', host: e.host || '?' };
  const key = 'rules.' + e.rule;
  const fallback = e.mode === 'admin' ? 'rules.fallback.admin' : e.allow ? 'rules.fallback.allow' : 'rules.fallback.deny';
  return t(has(key) ? key : fallback, params);
}

/** Een tegengehouden plek toch toestaan voor dit secret (de server houdt het bij hooguit enkele plekken). */
async function allowPlace(self, e) {
  const secret = (await api('GET', '/api/secrets')).find(s => s.name === e.secret);
  if (!secret || !(await ask(t('portal.audit.allowPlaceConfirm', { secret: e.secret, place: e.detail }), { ok: 'portal.audit.allowPlace' }))) return;
  await api('PUT', '/api/secrets/' + secret.id + '/inject', { inject: [...new Set([...(secret.inject ?? []), ...e.detail.split(',')])] });
  await self.load();
}

/** Grants openen met tool, secret en domein ingevuld; `newHost`: een domein dat het secret nog niet heeft (komt erbij). */
async function openGrant(e, { newHost = false } = {}) {
  setTab('grants');
  await $('view-main').load();
  $('tab-grants').openAdd({ toolName: e.tool, secretName: e.secret, host: e.host, newHost });
}

/** Secrets openen om een onbekend secret meteen aan te maken met naam en host vooringevuld. */
async function openSecret(e) {
  setTab('secrets');
  await $('view-main').load();
  $('tab-secrets').openAdd?.({ name: e.secret, host: e.host });
}

/** Eén beslissing groot rechts: de regelnaam als lezing, de zin, de keten, de feiten en wat je kunt doen. */
function detailOf(self, { entry: e, count, since }) {
  const kind = stampKind(e);
  const detail = clone(self, 'detail', {
    rule: e.rule, sentence: sentence(e), tool: e.tool || t('portal.audit.noTool'), secret: e.secret ?? '', host: e.host ?? '',
    hasChain: e.mode !== 'admin' && Boolean(e.tool || e.secret || e.host),
    when: dateTime(e.t), grouped: count > 1, repeat: t('portal.audit.repeat', { count, since: clock(since) }),
    request: e.method && e.method !== 'CONNECT' ? e.method : '', hasRequest: Boolean(e.method && e.method !== 'CONNECT'), client: e.client ?? '',
    inspected: Boolean(e.inspected),
    inspectedText: !e.inspected || e.inspected === true || e.inspected === 'inspected' ? 'inspected' : `inspected: ${e.inspected}`,
    admin: e.mode === 'admin', change: change(e),
    renew: RENEW.has(e.rule) && e.tool && e.secret && e.host,
    createSecret: e.rule === 'unknown-secret' && Boolean(e.secret),
    place: e.rule === 'placeholder-location-not-allowed' && /^(header|query):/.test(e.detail ?? ''),
    allowHost: e.rule === 'target-host-not-allowed' && e.tool && e.secret && e.host,
  }, {
    createSecret: () => openSecret(e),
    place: () => allowPlace(self, e),
    renew: () => openGrant(e),
    allowHost: () => openGrant(e, { newHost: true }),
  });
  if (!detail.querySelector('[data-action]')) detail.querySelector('.detail-actions')?.remove();
  if (READING[kind]) detail.querySelector('.reading').classList.add(READING[kind]);
  if (e.rule === 'target-host-not-allowed') detail.querySelector('[data-chain="host"]')?.classList.add('is-bad');
  return detail;
}

define('ks-audit', {
  template,
  wire() {
    on('a-go', () => { $('a-more').open = false; return this.load(); });
    $('a-decision').addEventListener('change', () => guarded(() => this.load()));
  },
  async load() {
    // Vandaag volgens de klok van de gebruiker: vanaf middernacht hier.
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const q = new URLSearchParams({ tool: $('a-tool').value, secret: $('a-secret').value, host: $('a-host').value, decision: $('a-decision').value });
    const [stats, entries, waiting] = await Promise.all([api('GET', '/api/stats?since=' + midnight.getTime()), api('GET', '/api/audit?' + q), $('waiting').load()]);
    $('stat-allowed').textContent = String(stats.allowed);
    $('stat-stopped').textContent = String(stats.stopped);
    $('stat-scrubbed').textContent = String(stats.scrubbed);
    $('audit-intro').textContent = t(waiting === 0 ? 'portal.audit.introNone' : waiting === 1 ? 'portal.audit.introOne' : 'portal.audit.intro', { count: waiting });
    const rows = groupEntries(entries).map(group => {
      const { entry: e, count } = group;
      const row = clone(this, 'entry', {
        time: clock(e.t), stamp: clone(this, 'stamp-' + stampKind(e), { rule: e.rule }),
        who: e.mode === 'admin' ? via(e) : e.tool || t('portal.audit.noTool'), where: e.host || e.secret || e.client || '',
        grouped: count > 1, count: '×' + count,
      });
      const button = row.firstElementChild;
      button.dataset.kind = stampKind(e);
      button.dataset.decision = e.mode === 'admin' ? 'admin' : e.allow ? 'allow' : 'deny';
      return { row, item: group };
    });
    $('audit-empty').classList.toggle('hidden', rows.length > 0);
    inspector($('audit'), $('audit-detail'), rows, { keyOf: g => keyOf(g.entry), render: g => detailOf(this, g), empty: () => clone(this, 'pick') });
  },
});
