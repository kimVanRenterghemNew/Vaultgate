// Ingelogd, maar de kluis is dicht: opnieuw met de passkey (PRF), met de telefoon (QR), of met de passphrase als de
// kluis er een heeft. Geen regelnamen op dit scherm.
import { api, $, on, onCeremony, define, refresh, state, login } from '../core/index.js';
import template from './unlock.html';
import { rollbackAccepted } from './rollback.js';
import { codeChangeAccepted } from './integrity.js';

define('ks-unlock', {
  template,
  wire() {
    const extra = () => ({ acceptRollback: rollbackAccepted(), acceptCodeChange: codeChangeAccepted() });
    onCeremony({ 'unlock-passkey-go': async () => { await login(undefined, extra()); await refresh(); }, 'unlock-phone-go': async () => { await login('hybrid', extra()); await refresh(); } });
    on('unlock-go', async () => {
      try { await api('POST', '/api/unlock', { passphrase: $('unlock-pass').value, ...extra() }); $('unlock-pass').value = ''; } finally { await refresh(); }
    });
  },
  async load() {
    $('unlock-passphrase').classList.toggle('hidden', !state().hasPassphrase);
    $('unlock-passkey').classList.toggle('hidden', state().passkeyCount === 0);
  },
});
