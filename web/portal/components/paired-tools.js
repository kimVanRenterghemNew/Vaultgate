// De gekoppelde tools (naam, soort, sinds), zonder knoppen: intrekken blijft bij Virtuele keys. Eén lijst in de pagina;
// het welkom en het tabblad Koppelen zetten ze in hun eigen vak (place). load() geeft de actieve tools terug, zodat het
// welkom kan zien welke tool nieuw is, waar ze ook toegestaan werd (portaal of tray).
import { api, $, t, clone, date, define } from '../core/index.js';
import template from './paired-tools.html';

const KIND = { web: 'portal.keys.kindWeb', mcp: 'portal.keys.kindMcp' };

define('ks-paired-tools', {
  template,
  async load() {
    const tools = (await api('GET', '/api/tools')).filter(k => !k.revoked);
    $('paired-tools').replaceChildren(...tools.map(k => clone(this, 'row', { name: k.name, kind: t(KIND[k.kind] ?? KIND.web), since: date(k.createdAt) })));
    $('paired-tools-empty').classList.toggle('hidden', tools.length > 0);
    return tools;
  },
});
