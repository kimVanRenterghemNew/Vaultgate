// Welkom in vier stappen: welkom, passkeys (de eerste maakt de kluis; geen passphrase, geen herstelcode), de eerste tool,
// klaar. Stap 3 is het component om een key te maken (ks-key-create, ook gebruikt bij Virtuele keys): naam, soort, en
// koppelen (best: de tool haalt zelf haar key) of zelf instellen (de key één keer). Het welkom
// blijft staan tot de laatste knop.
import { api, $, t, on, place, guarded, define, refresh, setTab, setWelcoming, dismissSetupGuide } from '../core/index.js';
import { stopKeyCreate } from './key-create.js';
import template from './welcome.html';

/** Eén bewuste beweging: vooruit schuift naar links, terug naar rechts. Niet bij prefers-reduced-motion. */
function transition(back, change) {
  document.documentElement.classList.toggle('welcome-back', back);
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !document.startViewTransition) return change();
  return document.startViewTransition(change).updateCallbackDone;
}

define('ks-welcome', {
  template,
  wire() {
    this.page = 1;
    const go = page => transition(page < this.page, async () => { this.page = page; await refresh(); });
    on('wl-start', async () => { setWelcoming(true); await go(2); });
    on('wl-passkeys-next', () => go(3));
    on('wl-key-skip', () => go(4));
    on('wl-key-next', () => go(4));
    on('wl-finish', async () => { stopKeyCreate(); setWelcoming(false); dismissSetupGuide(); setTab('audit'); this.page = 1; await refresh(); });
    for (const b of this.querySelectorAll('[data-back]')) b.addEventListener('click', () => guarded(() => go(Number(b.dataset.back))));
    // De eerste passkey maakt de kluis: eerst de toestand opnieuw ophalen, dan pas de lijst.
    this.addEventListener('passkeys-changed', () => guarded(() => refresh()));
    // Een key gemaakt of een tool gekoppeld: Verder tonen.
    const ready = () => $('wl-key-next').classList.remove('hidden');
    this.addEventListener('key-created', ready);
    this.addEventListener('tool-connected', ready);
  },
  async load() {
    const page = this.page;
    this.querySelectorAll('[data-page]').forEach(s => s.classList.toggle('hidden', Number(s.dataset.page) !== page));
    this.querySelectorAll('[data-testid="welcome-steps"] [data-step]').forEach(li => { li.dataset.reached = String(Number(li.dataset.step) <= page); });
    $('wl-rail-fill').style.setProperty('--fill', `${page * 25}%`);
    this.dataset.current = String(page);
    stopKeyCreate();
    if (page === 2) {
      place('ks-passkey-add', $('wl-passkey-add-slot'));
      const list = place('ks-passkey-list', $('wl-passkeys-slot'));
      await list.load();
      const count = Number(list.dataset.count);
      $('wl-passkeys-next').disabled = count === 0;
      // Minstens twee: een echte waarschuwing. De eerste sleutel maakt de kluis: dat even melden (verdwijnt vanzelf).
      this.querySelector('[data-testid="welcome-two-keys"]').classList.toggle('hidden', count >= 2);
      this.querySelector('[data-testid="welcome-vault-created"]').classList.toggle('hidden', !(this.keyCount === 0 && count > 0));
      this.keyCount = count;
    }
    if (page === 3) await place('ks-key-create', $('wl-ways-slot')).load();
    if (page === 4) await loadSummary();
  },
});

/** Stap 4: de samenvatting uit de echte toestand. */
async function loadSummary() {
  const [passkeys, tools] = await Promise.all([api('GET', '/api/passkeys'), api('GET', '/api/tools')]);
  $('wl-sum-passkeys').textContent = passkeys.length === 1 ? t('portal.welcome.donePasskeysOne') : t('portal.welcome.donePasskeys', { count: passkeys.length });
  $('wl-sum-tools').textContent = tools.length ? t('portal.welcome.doneTools', { names: tools.map(x => x.name).join(', ') }) : t('portal.welcome.doneNoTools');
}
