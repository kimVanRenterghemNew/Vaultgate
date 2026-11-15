// Authentication als inspector: de sleutels van de kluis (ks-passkey-list met detail rechts), hoeveel er de kluis
// openen, en toevoegen in een dialoog
// (ks-passkey-add). Na een wijziging: dialoog dicht en de toestand opnieuw (wizard, wat op je wacht).
import { $, t, on, place, guarded, define, refresh } from '../core/index.js';
import template from './passkeys.html';

define('ks-passkeys', {
  template,
  wire() {
    on('pk-open', () => { place('ks-passkey-add', $('pk-add-slot')); $('pk-dialog').showModal(); });
    this.addEventListener('passkeys-changed', () => { $('pk-dialog').close(); guarded(refresh); });
  },
  async load() {
    const list = place('ks-passkey-list', $('passkeys-slot'));
    await list.load();
    const count = Number(list.dataset.count);
    const opens = Number(list.dataset.opens);
    $('pk-opens').textContent = String(opens);
    $('pk-signs').textContent = String(count - opens);
    $('pk-count').textContent = t('portal.keys.count', { count });
    $('pk-summary').classList.toggle('hidden', count === 0);
    $('pk-summary-text').textContent = t(opens === 1 ? 'portal.passkeys.opensOne' : 'portal.passkeys.opens', { count: opens }) + (count > opens ? ' ' + t('portal.passkeys.signInOnly', { count: count - opens }) : '');
  },
});
