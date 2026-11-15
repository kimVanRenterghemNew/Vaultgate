// Het pushkanaal in de browser: de server meldt alleen de soort van wat veranderde (src/portal/push.js). Eerst een
// eenmalig kaartje met het sessietoken (EventSource stuurt geen headers), dan de stroom. Verbroken: na 1 s opnieuw, met een
// nieuw kaartje. Weigert het portaal het kaartje (geen sessie meer), dan stopt het kanaal en meldt het `lock`.
import { api, quietly } from './api.js';

let running = false; // tussen startPush en stopPush
let source = null;
let retry = null;
let listener = () => {};

async function connect() {
  retry = null;
  let ticket;
  try {
    ({ ticket } = await quietly(() => api('POST', '/api/push/ticket')));
  } catch (e) {
    if (!running) return;
    if (e.status === 401 || e.status === 403) { running = false; listener('lock'); return; }
    retry = setTimeout(connect, 2000);
    return;
  }
  if (!running) return;
  source = new EventSource('/api/push?ticket=' + encodeURIComponent(ticket));
  source.onmessage = e => listener(e.data);
  source.onerror = () => {
    source?.close();
    source = null;
    if (running) retry = setTimeout(connect, 1000);
  };
}

/**
 * Opent het kanaal (als het nog niet open is); `onKind(soort)` bij elk bericht.
 * @param {(kind: string) => void} onKind
 */
export function startPush(onKind) {
  listener = onKind;
  if (running) return;
  running = true;
  connect();
}

/** Sluit het kanaal (afgemeld of vergrendeld). */
export function stopPush() {
  running = false;
  clearTimeout(retry);
  retry = null;
  source?.close();
  source = null;
}
