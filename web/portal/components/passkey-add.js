// Een sleutel toevoegen: security key, telefoon of deze pc. Eén keuzelijst in de pagina; het welkom zet ze naast de
// lijst, Authentication in een dialoog (place). Zonder kluis maakt de eerste passkey (met PRF) de kluis aan.
// Na een nieuwe sleutel: event `passkeys-changed`.
import { onCeremony, define, state, registerPasskey } from '../core/index.js';
import template from './passkey-add.html';

define('ks-passkey-add', {
  template,
  wire() {
    const add = attachment => async () => { await registerPasskey(attachment, { first: !state().vaultExists }); this.dispatchEvent(new CustomEvent('passkeys-changed', { bubbles: true })); };
    onCeremony({ 'pk-add-external': add('security-key'), 'pk-add-phone': add('phone'), 'pk-add': add('platform') });
  },
});
