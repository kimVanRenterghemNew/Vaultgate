// Pauzeren met een einde, één component overal: een tool, secret, toekenning of passkey blokkeren (Virtual keys,
// Secrets, Grants, Authentication) of meldingen stilzetten (Grants, Settings). Een knop met de keuze 15 minuten, 1 uur,
// tot morgen (middernacht, lokale tijd) of tot ik het ophef; terwijl de pauze loopt een badge tot wanneer en een knop om
// ze op te heffen. Een blokkade opheffen laat meer toe: het portaal vraagt dan zelf een aanraking (core/api.js), de knop
// toont het aanraakicoon.
import { api, t, clone, clock, define } from '../core/index.js';
import template from './pause.html';

const MINUTE = 60_000;
const tomorrow = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
const UNTIL = Object.freeze({ '15m': () => Date.now() + 15 * MINUTE, '1h': () => Date.now() + 60 * MINUTE, tomorrow: () => tomorrow(), forever: () => null });
const TEXT = Object.freeze({
  block: { label: 'portal.pause.block', until: 'portal.pause.blockedUntil', forever: 'portal.pause.blockedForever', resume: 'portal.pause.unblock', icon: '#i-lock' },
  silence: { label: 'portal.pause.silence', until: 'portal.pause.silencedUntil', resume: 'portal.pause.unsilence', icon: '#i-bell' },
});

/** Loopt de pauze nog? `until` null: tot ze opgeheven wordt; undefined of voorbij: geen pauze. */
const running = until => until === null || (until !== undefined && until > Date.now());

define('ks-pause', {
  template,
  wire() {
    const { id, kind, until, pause, resume } = this.options;
    const text = TEXT[kind];
    const node = running(until)
      ? clone(this, 'paused', { id, text: until === null ? t(text.forever) : t(text.until, { time: clock(until) }), resume: t(text.resume) }, { resume })
      : clone(this, 'choose', { id, label: t(text.label), forever: kind === 'block' }, Object.fromEntries(Object.entries(UNTIL).map(([k, at]) => [k, () => pause(at())])));
    node.querySelector('[data-icon]').setAttribute('href', text.icon);
    node.querySelector('[data-touch]')?.classList.toggle('hidden', kind !== 'block'); // opheffen vraagt altijd een aanraking, meldingen aanzetten nooit
    this.append(node);
  },
});

/**
 * Een pauzeknop (nog niet in de pagina). `pause(until)` en `resume()` doen de API-call en laden de lijst opnieuw.
 * @param {{ id: string, kind: 'block'|'silence', until?: number|null, pause: (until: number|null) => Promise<void>, resume: () => Promise<void> }} options
 */
export function pauseControl(options) {
  const el = document.createElement('ks-pause');
  el.options = options;
  return el;
}

/**
 * Blokkeren van één ding (`target`: kind plus toolId, secretName, host of passkeyId) tussen de actieve `blocks`.
 * @param {string} id  data-testid van de knop
 * @param {object[]} blocks  GET /api/blocks
 * @param {object} target
 * @param {() => Promise<void>} reload
 */
export function blockControl(id, blocks, target, reload) {
  const block = blocks.find(b => Object.entries(target).every(([k, v]) => b[k] === v));
  return pauseControl({
    id, kind: 'block', until: block ? block.until ?? null : undefined,
    pause: async until => { await api('POST', '/api/blocks', { ...target, until }); await reload(); },
    resume: async () => { await api('DELETE', '/api/blocks/' + block.id); await reload(); },
  });
}
