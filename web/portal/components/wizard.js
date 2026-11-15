// Begeleide eerste keer, na het welkom. De voortgang komt uit de echte toestand (geen eigen opslag); de wizard
// verdwijnt zodra er een passkey en een eerste toekenning is. De controle zegt welke regel een call zou krijgen.
import { api, $, t, has, on, clone, define, fillSelect, state, setTab, setupGuideDismissed } from '../core/index.js';
import template from './wizard.html';

const KIND = { 'granted': 'success', 'needs-approval': 'warning' };

define('ks-wizard', {
  template,
  wire() {
    on('wizard-go', async () => { setTab(this.dataset.tab); await $('view-main').load(); });
    on('wz-check', async () => {
      const r = await api('POST', '/api/check', { toolId: $('wz-tool').value, secretName: $('wz-secret').value });
      const key = 'portal.wizard.result.' + r.rule;
      $('wz-result').replaceChildren(clone(this, 'result-' + (KIND[r.rule] ?? 'error'), { rule: r.rule, text: has(key) ? t(key) : '' }));
      $('wz-result').dataset.rule = r.rule;
    });
  },
  async load() {
    const [secrets, tools, grants] = await Promise.all([api('GET', '/api/secrets'), api('GET', '/api/tools'), api('GET', '/api/grants')]);
    const done = { passkey: state().credentialCount >= 1, tool: tools.length > 0, secret: secrets.length > 0, grant: grants.length > 0 };
    this.classList.toggle('hidden', setupGuideDismissed() || (done.passkey && done.grant));
    this.querySelectorAll('[data-step]').forEach(li => { li.dataset.done = String(done[li.dataset.step]); });
    const [next, tab] = !done.passkey ? ['passkey', 'passkeys'] : !done.tool ? ['key', 'tools'] : !done.secret ? ['secret', 'secrets'] : ['grant', 'grants'];
    $('wizard-next').textContent = t('portal.wizard.next.' + next);
    $('wizard-go').textContent = t('portal.wizard.go.' + next);
    this.dataset.tab = tab;
    $('wizard-config').classList.toggle('hidden', !(done.secret && done.tool));
    if (done.secret && done.tool) {
      fillSelect($('wz-tool'), tools.map(x => [x.name, x.id]));
      fillSelect($('wz-secret'), secrets.map(s => [s.name, s.name]));
    }
  },
});
