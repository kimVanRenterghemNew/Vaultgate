// Een tool-key (of een configuratie met de key) naar het klembord, en na 60 s weer weg: anders blijft hij onbeperkt
// staan. Zoals Bitwarden: na 60 s lezen we het klembord en wissen we alleen als de key er nog op staat, zodat wat je
// intussen zelf kopieerde blijft staan. Mag lezen niet (toestemming geweigerd, geen readText), dan toch wissen.
// De Clipboard API werkt alleen als het venster de focus heeft; lukt wissen dan niet, dan opnieuw zodra de focus
// terugkomt. Wat Windows zelf bewaart (klembordgeschiedenis, Win+V) kan een webpagina niet wissen.

export const CLEAR_MS = 60_000;

/** Gelijk op regeleinden na: Windows geeft een tekst van meerdere regels terug met CRLF. */
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

/** Wat er nu op het klembord staat, of `null` als lezen niet mag of niet bestaat. */
async function readOrNull(clipboard) {
  try { return await clipboard.readText(); } catch { return null; }
}

/**
 * Kopieert `text` en wist het klembord na CLEAR_MS, tenzij er dan aantoonbaar iets anders op staat.
 * Klembord, timer en focus zijn ingespoten om te testen.
 */
export async function copySecret(text, {
  clipboard = navigator.clipboard,
  setTimer = setTimeout,
  onFocus = fn => window.addEventListener('focus', fn, { once: true }),
} = {}) {
  await clipboard.writeText(text);
  const clear = async () => {
    const current = await readOrNull(clipboard);
    if (current !== null && !sameText(current, text)) return;
    await clipboard.writeText('').catch(() => onFocus(clear));
  };
  setTimer(clear, CLEAR_MS);
}
