// De pagina's van het portaal: de browsercode staat apart in `web/portal/`: opmaak in `.html`, gedrag in
// webcomponents (gebundeld met esbuild naar `*.generated.js`, `npm run build:ui`), stijl in `portal.generated.css`
// (`npm run build:css`). Hier worden ze alleen samengevoegd, met een nonce per response voor de CSP. Geen CDN, geen
// externe bronnen; geen HTML of browsercode in dit bestand.
import fs from 'node:fs';

const file = name => new URL(`../../web/portal/${name}`, import.meta.url);
const read = name => fs.readFileSync(file(name), 'utf8');

/** De lettertypes (Host Grotesk, Atkinson Hyperlegible Mono; SIL OFL 1.1, latijns) als data-URI: de CSP laat alleen `font-src data:` toe. */
const fontFace = (family, name, weight) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;`
    + `src:url(data:font/woff2;base64,${fs.readFileSync(file(`fonts/${name}`)).toString('base64')}) format('woff2')}`;
const CSS = fontFace('Host Grotesk', 'host-grotesk-latin.woff2', '300 800')
    + fontFace('Atkinson Hyperlegible Mono', 'atkinson-hyperlegible-mono-latin.woff2', '400 600')
    + read('portal.generated.css');

/** Een pagina: de schil met nonce, CSS en het script erin. Het script mag de schil niet vroegtijdig sluiten. */
function page(shell, script) {
    if (script.includes('</script')) throw new Error('bundle contains </script');
    return ({ nonce }) => shell.replaceAll('%NONCE%', nonce).replace('%CSS%', () => CSS).replace('%JS%', () => script);
}

/** Het portaal. @type {(opts: { nonce: string }) => string} */
export const renderPage = page(read('index.html'), read('portal.generated.js'));

/** Het venster voor een aanraking van de passkey. @type {(opts: { nonce: string }) => string} */
export const renderTouchPage = page(read('touch/page.html'), read('touch.generated.js'));
