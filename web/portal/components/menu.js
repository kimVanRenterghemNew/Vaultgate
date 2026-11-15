// Het menu: één component, één lijst (menu.html), in de kopbalk. Een keuze zet het tabblad en laadt het
// hoofdscherm; het hoofdscherm meldt welk tabblad zichtbaar is (`tab-shown`), zodat ook een sprong vanuit een knop
// elders het juiste item markeert. Een teller betekent "wacht op jou" (een tool die wil koppelen), niet "hoeveel er zijn".
import { $, guarded, define, setTab } from '../core/index.js';
import template from './menu.html';

function mark(menu, tab) {
  for (const item of menu.querySelectorAll('[data-tab]')) {
    if (item.dataset.tab === tab) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

define('ks-menu', {
  template,
  wire() {
    for (const item of this.querySelectorAll('[data-tab]')) {
      item.addEventListener('click', () => guarded(async () => { setTab(item.dataset.tab); await $('view-main').load(); }));
    }
    document.addEventListener('tab-shown', e => mark(this, e.detail.tab));
  },
});

/** Zet de teller "wacht op jou" bij een menu-item (0: geen teller). */
export function setWaiting(tab, count) {
  const badge = document.querySelector(`ks-menu [data-wait="${tab}"]`);
  if (!badge) return;
  badge.textContent = count ? String(count) : ''; // leeg = geen teller (CSS :empty)
}
