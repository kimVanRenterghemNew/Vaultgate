// Toestand van de pagina: de laatste /api/state, het actieve tabblad, en welk scherm zichtbaar is.
// Ingelogd luistert de pagina naar het pushkanaal: `lock` toont opnieuw het juiste scherm; elke andere soort haalt de
// kopbalk en het open tabblad (als de soort het raakt) opnieuw op (op de achtergrond: verlengt de sessie niet); terwijl een dialoog open
// staat (de gebruiker is iets aan het invullen) pas na het sluiten. Een reeks berichten tijdens een ophaling geeft één extra ophaling.
import { api, quietly } from './api.js';
import { $ } from './dom.js';
import { startPush, stopPush } from './push.js';

let current = null;
let activeTab = 'audit';
let welcoming = false;
const SETUP_GUIDE_DISMISSED = 'vaultgate.setupGuideDismissed';

/** De laatst opgehaalde toestand van het portaal (/api/state). */
export const state = () => current;

/**
 * Een CLI-opdracht om te kopiëren die in elke map werkt: de opdracht start met `vaultgate`
 * en vult het echte proxyadres in voor `{proxy}`.
 */
export function cli(args) {
  return `vaultgate ${args.replaceAll('{proxy}', 'http://127.0.0.1:' + (current?.proxyPort ?? 8484))}`;
}

/** Vult elk element met `data-cli="<argumenten>"` met de volledige opdracht. */
export function fillCli(root = document) {
  for (const el of root.querySelectorAll('[data-cli]')) el.textContent = cli(el.dataset.cli);
}
export const tab = () => activeTab;
export const setTab = name => { activeTab = name; };

export function setupGuideDismissed() {
  try { return localStorage.getItem(SETUP_GUIDE_DISMISSED) === '1'; } catch { return false; }
}

export function dismissSetupGuide() {
  try { localStorage.setItem(SETUP_GUIDE_DISMISSED, '1'); } catch { /* geen opslag: alleen deze sessie */ }
}

/** Het welkom blijft staan tot de gebruiker het afrondt, ook als de kluis intussen bestaat. */
export const setWelcoming = on => { welcoming = on; };

const VIEWS = ['welcome', 'recovery', 'login', 'unlock', 'main'];
export function show(view) {
  for (const v of VIEWS) $('view-' + v).classList.toggle('hidden', v !== view);
  $('menu').classList.toggle('hidden', view !== 'main');
}

const vaultState = detail => document.dispatchEvent(new CustomEvent('vault-state', { detail }));
export const markUnlocked = () => vaultState({ kind: 'open', lockInMs: 0 });

/** Haalt de toestand op en werkt alleen de kopbalk bij (bv. de afteller na een andere vergrendeltijd), zonder scherm te wisselen. */
export async function refreshHeader() {
  current = await api('GET', '/api/state');
  fillCli();
  vaultState({ kind: !current.vaultExists ? 'none' : current.unlocked ? 'open' : 'locked', lockInMs: current.lockInMs ?? 0 });
}

// Welke tabbladen een soort raakt; een ander open tabblad (bv. Tools midden in een nieuwe key) blijft ongemoeid.
// Beheer (`admin`: een secret, tool, toekenning, passkey of blokkade erbij of eraf, ook uit een ander venster) raakt ze allemaal.
const TABS = ['audit', 'tools', 'secrets', 'grants', 'passkeys', 'settings'];
const AFFECTS = Object.freeze({ audit: ['audit'], approvals: ['audit'], device: ['audit', 'tools'], admin: TABS, settings: TABS.slice(1) }); // blokkades staan in de instellingen
let following = null;
const waiting = new Set();
const deferred = new Set(); // geraakt terwijl een dialoog open stond: na het sluiten
const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));
// Een nieuwe key staat nog op het scherm (Virtual keys): herladen zou ze wissen; "Got it" laadt de lijst zelf.
const keyOnScreen = () => activeTab === 'tools' && !$('tools-create-card').classList.contains('hidden');
const affects = kind => AFFECTS[kind]?.includes(activeTab) && !(kind === 'admin' && keyOnScreen());

/** Werkt het getroffen deel bij na een push, zonder herladen en op hetzelfde tabblad. */
function follow(kind) {
  if (kind === 'lock') { quietly(refresh).catch(() => {}); return; }
  waiting.add(kind);
  if (following) return;
  following = quietly(async () => {
    while (waiting.size) {
      const kinds = [...waiting].filter(affects);
      waiting.clear();
      await refreshHeader();
      const main = $('view-main');
      if (kinds.length === 0 || main.classList.contains('hidden')) continue;
      if (dialogOpen()) kinds.forEach(k => deferred.add(k)); else await main.load();
    }
  }).catch(() => {}).finally(() => { following = null; }); // een fout: het volgende bericht of `lock` herstelt
}

// `close` bubbelt niet: luisteren in de capture-fase vangt elke dialoog.
document.addEventListener('close', () => {
  if (deferred.size === 0 || dialogOpen()) return;
  const kinds = [...deferred];
  deferred.clear();
  kinds.forEach(follow);
}, true);

let hashRedeemed = false;
async function redeemSessionHash() {
  if (hashRedeemed) return;
  hashRedeemed = true;
  const hash = typeof window !== 'undefined' ? (window.location?.hash ?? '') : '';
  const match = /^#session=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return;
  try { window.history?.replaceState?.(null, '', window.location.pathname + window.location.search); } catch { /* negeer */ }
  try {
    await api('POST', '/api/session/redeem', { ticket: match[1] });
  } catch {
    /* ongeldig of verlopen kaartje: doorgaan naar gewoon inlogscherm */
  }
}

/** Haalt de toestand op en toont het juiste scherm. */
export async function refresh() {
  await redeemSessionHash();
  await refreshHeader();
  if (current.loggedIn) startPush(follow); else stopPush();
  $('lock').classList.toggle('hidden', !(current.loggedIn && current.unlocked));
  $('logout').classList.toggle('hidden', !current.loggedIn);
  $('rollback').classList.toggle('hidden', !(current.rolledBack && !current.unlocked));
  await $('integrity').load();
  if (!current.vaultExists || welcoming) { show('welcome'); return $('view-welcome').load(); }
  if (!current.loggedIn) { show('login'); return $('view-login').load(); }
  if (!current.unlocked) { show('unlock'); return $('view-unlock').load(); }
  show('main');
  return $('view-main').load();
}
