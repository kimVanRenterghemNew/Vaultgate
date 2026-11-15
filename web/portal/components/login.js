// Inloggen met een passkey (met PRF opent dat ook de kluis). Een oudere kluis met passphrase: zonder passkey eerst met
// de passphrase (eerste registratie), en herstellen met de herstelcode. Een kluis met alleen passkeys heeft geen van beide.
import { api, $, on, onCeremony, define, show, markUnlocked, refresh, setTab, state, login } from '../core/index.js';
import template from './login.html';
import { rollbackAccepted } from './rollback.js';
import { codeChangeAccepted } from './integrity.js';

const accepts = () => ({ acceptRollback: rollbackAccepted(), acceptCodeChange: codeChangeAccepted() });

define('ks-login', {
  template,
  wire() {
    onCeremony({ 'login-go': async () => { await login(undefined, accepts()); await refresh(); } });
    on('bootstrap-go', async () => {
      try { await api('POST', '/api/unlock', { passphrase: $('bootstrap-pass').value, ...accepts() }); $('bootstrap-pass').value = ''; setTab('passkeys'); } finally { await refresh(); }
    });
    on('recover-go', async () => {
      const { recoveryCode } = await api('POST', '/api/recover', { recoveryCode: $('recover-code').value, newPassphrase: $('recover-pass').value });
      $('recover-code').value = $('recover-pass').value = '';
      markUnlocked(); $('recovery-code').textContent = recoveryCode; show('recovery');
    });
  },
  async load() {
    const s = state();
    const passkeys = s.credentialCount > 0;
    $('login-bootstrap').classList.toggle('hidden', passkeys || !s.hasPassphrase);
    for (const id of ['login-go', 'login-passkey-text']) $(id).classList.toggle('hidden', !passkeys);
    $('login-recover').classList.toggle('hidden', !s.hasRecovery);
    $('login-start-over').classList.toggle('hidden', s.hasRecovery);
  },
});
