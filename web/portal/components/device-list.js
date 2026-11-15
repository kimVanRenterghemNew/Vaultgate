// Wachtende koppelingen met hun code; toestaan vraagt een aanraking van de passkey; weigeren is de hoofdknop. Eén lijst
// in de pagina; het component om een key te maken en Virtuele keys zetten ze in hun eigen vak (place). Na een gelukte koppeling: event `tool-paired`.
import { api, $, t, say, clone, date, define, touch } from '../core/index.js';
import { setWaiting } from './menu.js';
import { ask } from './ask.js';
import template from './device-list.html';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

define('ks-device-list', {
  template,
  async load() {
    const rows = [];
    for (const d of await api('GET', '/api/device')) {
      rows.push(clone(this, 'row', { name: d.clientName, existing: d.existing, pairable: d.pairable, client: d.client, since: date(d.since) }, {
        approve: async () => {
          const code = await ask(t('portal.device.enterCode', { name: d.clientName }), { input: 'text', ok: 'portal.device.checkCode' });
          if (typeof code !== 'string' || !code.trim()) return;
          await api('POST', '/api/device/' + d.id + '/verify', { code });
          const r = await api('POST', '/api/device/' + d.id + '/approve');
          if (r.touch && !(await touch(r.touch))) { say(t('portal.device.noTouch'), 'warning'); await this.load(); return; }
          // Na de aanraking maakt de server de tool aan: wachten tot de aanvraag uit de lijst is (max. 5 s).
          for (let i = 0; r.touch && i < 50 && (await api('GET', '/api/device')).some(p => p.id === d.id); i++) await sleep(100);
          say(t('portal.device.paired', { name: d.clientName }), 'success');
          this.dispatchEvent(new CustomEvent('tool-paired', { bubbles: true, detail: { name: d.clientName } }));
          await this.load();
        },
        deny: async () => { await api('POST', '/api/device/' + d.id + '/deny'); await this.load(); },
      }));
    }
    $('device').replaceChildren(...rows);
    setWaiting('tools', rows.length);
    $('device-empty').classList.toggle('hidden', rows.length > 0);
  },
});
