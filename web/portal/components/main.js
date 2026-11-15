// Het hoofdscherm na ontgrendelen: het tabblad dat het menu (ks-menu, in de kopbalk) koos, met de wizard en de
// certificaatwaarschuwing erboven. Wat op je wacht, staat op Activity (ks-waiting); de teller in het menu hier.
import { api, $, define, tab } from '../core/index.js';
import { setWaiting } from './menu.js';
import template from './main.html';

define('ks-main', {
  template,
  async load() {
    document.dispatchEvent(new CustomEvent('tab-shown', { detail: { tab: tab() } }));
    this.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab()));
    const [devices, tlsChanges] = await Promise.all([api('GET', '/api/device'), api('GET', '/api/tls')]);
    setWaiting('tools', devices.length);
    setWaiting('tls', tlsChanges.length);
    await Promise.all([$('wizard').load(), $('tls-box').load(), $('tab-' + tab()).load()]);
  },
});
