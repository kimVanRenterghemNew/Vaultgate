// Kopbalk: het merkteken met links ernaast het menu (ks-menu, één component); rechts, na een lijn, de sessie: de
// toestand van de kluis als tekst (open: een klok en hoe lang nog tot auto-vergrendelen, met uitleg als tooltip),
// vergrendelen (omlijnd) en afmelden (icoon).
// De toestand komt als event `vault-state` uit core/state.js ({ kind: 'none'|'locked'|'open', lockInMs }).
import { api, $, t, clone, forgetCsrf, on, guarded, define, refresh } from '../core/index.js';
import template from './header.html';

let lockAt = 0;
let ticker = null;
let render = () => {};

const minutesLeft = () => Math.max(1, Math.ceil((lockAt - Date.now()) / 60_000));

function showState(root, { kind, lockInMs = 0 }) {
  const holder = $('vault-state');
  holder.dataset.state = kind;
  clearInterval(ticker);
  ticker = null;
  if (kind !== 'open') { holder.replaceChildren(clone(root, 'state-' + kind)); return; }
  lockAt = Date.now() + lockInMs;
  const text = () => (lockInMs ? t('portal.header.openFor', { minutes: minutesLeft() }) : t('portal.header.open'));
  render = () => holder.replaceChildren(clone(root, 'state-open', { text: text() }));
  render();
  if (lockInMs) ticker = setInterval(() => (Date.now() >= lockAt ? guarded(refresh) : render()), 15_000);
}

define('ks-header', { template, wire() {
  $('vault-state').dataset.tip = t('portal.header.timerTip');
  document.addEventListener('vault-state', e => showState(this, e.detail));
  document.addEventListener('session-active', e => { if (ticker) { lockAt = Date.now() + e.detail.lockInMs; render(); } });
  on('lock', async () => { await api('POST', '/api/lock'); forgetCsrf(); await refresh(); });
  on('logout', async () => { await api('POST', '/api/logout'); forgetCsrf(); await refresh(); });
} });
