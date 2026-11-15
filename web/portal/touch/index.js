// Het venster voor een aanraking (ingang voor esbuild -> touch.generated.js). Het proces opent het
// portaalvenster op `/touch#<id>`; de pagina toont wat er gevraagd wordt (nooit een waarde) en vraagt een WebAuthn-assertie
// met user verification. Alleen een geldige assertie op de challenge van dit id bevestigt; weigeren kan altijd en heeft
// de focus. Toestanden zoals de mockups: vragen (keten of koppeling), bevestigd, geweigerd, mislukt, verlopen.
import { api, $, t, clone, translate, errorText, touch } from '../core/index.js';

const id = location.hash.slice(1);

function say(text, kind) { $('touch-message').replaceChildren(clone(document, 'message-' + kind, { text })); }

/** Het icoon en de kleur bovenaan: wachten (aanraken), gelukt, geweigerd of mislukt, verlopen. */
function orb(icon, tone) {
  $('touch-icon').setAttribute('href', '#' + icon);
  $('touch-orb').dataset.tone = tone; // een antwoord: de orb ademt niet meer
}

// Na het antwoord een knop om te sluiten. Een gewone tab laat window.close() niet toe: dan blijft de tekst staan.
function done(key, title, icon, tone) {
  orb(icon, tone);
  $('touch-title').textContent = t(title);
  for (const e of ['touch-actions', 'touch-why', 'touch-code-hint']) $(e).classList.add('hidden');
  $('touch-done').textContent = t(key);
  for (const e of ['touch-done', 'touch-close', 'touch-close-hint']) $(e).classList.remove('hidden');
  $('touch-close').focus();
}

async function load() {
  translate(document.body);
  let q;
  try { q = await api('GET', '/api/touch/' + encodeURIComponent(id)); } catch {
    orb('i-warn', 'warning');
    $('touch-title').textContent = t('touch.goneTitle');
    $('touch-why').classList.add('hidden');
    say(t('touch.gone'), 'warning');
    return;
  }
  const pairing = q.reason === 'device';
  if (pairing) $('touch-title').textContent = t('touch.pairTitle', { tool: q.tool });
  else {
    $('touch-chain').replaceChildren(clone(document, 'chain', { tool: q.tool, secret: q.secret ?? '', host: q.host ?? '' }));
    $('touch-chain').classList.remove('hidden');
  }
  $('touch-question').textContent = t('touch.question.' + q.reason, { tool: q.tool, secret: q.secret ?? '', host: q.host ?? '' });
  // Bij koppelen draagt host de code die de tool toont.
  const rows = pairing ? [['touch.code', q.host]] : [['touch.request', ((q.method || '') + ' ' + (q.path || '')).trim()]];
  $('touch-details').replaceChildren(...rows.filter(([, v]) => v).map(([label, value]) => clone(document, 'detail', { label: t(label), value })));
  for (const e of ['touch-question', 'touch-details', 'touch-actions']) $(e).classList.remove('hidden');
  // De portal heeft de terminalcode al gevalideerd voordat deze touch-vraag wordt geopend.
  if (pairing) {
    $('touch-code-hint').textContent = t('touch.codeHint', { code: q.host });
    $('touch-code-hint').classList.remove('hidden');
  }
  $('touch-deny').focus();
}

$('touch-deny').addEventListener('click', async () => {
  try { await api('POST', '/api/touch/' + encodeURIComponent(id) + '/deny'); done('touch.denied', 'touch.deniedTitle', 'i-x', 'error'); } catch (e) { say(errorText(e), 'error'); }
});
$('touch-confirm').addEventListener('click', async () => {
  const btn = $('touch-confirm');
  const denyBtn = $('touch-deny');
  const icon = btn.querySelector('svg');
  const orbEl = $('touch-orb');
  btn.disabled = true;
  btn.classList.add('touch-busy');
  denyBtn.disabled = true;
  icon?.classList.add('touch-animating');
  orbEl?.classList.add('touch-busy');
  try {
    if (await touch(id)) done('touch.confirmed', 'touch.confirmedTitle', 'i-check', 'success');
    else { orb('i-x', 'error'); say(t('touch.failed'), 'error'); }
  } finally {
    btn.disabled = false;
    btn.classList.remove('touch-busy');
    denyBtn.disabled = false;
    icon?.classList.remove('touch-animating');
    orbEl?.classList.remove('touch-busy');
  }
});
$('touch-close').addEventListener('click', () => window.close());
// Een nieuwe vraag in hetzelfde venster komt als een ander #id: dan opnieuw laden.
addEventListener('hashchange', () => location.reload());
load();
