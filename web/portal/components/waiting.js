// "Waiting for you" op Activity: wat een beslissing van jou nodig heeft, elk met een knop naar de plek waar je beslist.
// Een tool die wil koppelen, een certificaat dat veranderde, te weinig passkeys, en goedkeuringen die in de tray wachten.
import { api, $, t, clone, define, setTab, state } from '../core/index.js';
import template from './waiting.html';

/** Naar een tabblad en het hoofdscherm opnieuw laden (zoals het menu). */
const open = tab => async () => { setTab(tab); await $('view-main').load(); };

define('ks-waiting', {
  template,
  /** @returns {Promise<number>} hoeveel dingen wachten */
  async load() {
    const [pairings, changes, approvals] = await Promise.all([api('GET', '/api/device'), api('GET', '/api/tls'), api('GET', '/api/approvals')]);
    const s = state();
    const item = (kind, icon, text, button, go) => {
      const node = clone(this, 'item', { kind, text, button: button && t(button) }, { go });
      node.querySelector('[data-icon]').setAttribute('href', '#' + icon);
      return node;
    };
    const items = [
      ...pairings.map(d => item('pair', 'i-link', t('portal.waiting.pair', { name: d.clientName }), 'portal.waiting.review', open('tools'))),
      ...changes.map(c => item('tls', 'i-cert', t('portal.waiting.tls', { host: new URL(c.origin).host }), 'portal.waiting.decide', open('tls'))),
      ...(s.needsMorePasskeys ? [item('passkeys', 'i-key', t(s.credentialCount === 0 ? 'portal.main.noPasskey' : 'portal.main.onePasskey'), 'portal.waiting.check', open('passkeys'))] : []),
      ...approvals.map(p => item('approval', 'i-bell', t('portal.waiting.approval', { tool: p.tool, secret: p.secret, host: p.host }))),
    ];
    $('waiting-list').replaceChildren(...items);
    $('waiting-list').classList.toggle('hidden', items.length === 0);
    $('waiting-none').classList.toggle('hidden', items.length > 0);
    return items.length;
  },
});
