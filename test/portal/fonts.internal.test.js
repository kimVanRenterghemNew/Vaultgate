// Het lettertype staat in de pagina zelf (data-URI): de CSP laat alleen `font-src data:` toe, nooit een bron van buiten.
// Intern: page.js is geen publieke API van de module portal.
import { describe, it, expect } from 'vitest';
import { renderPage, renderTouchPage } from '../../src/portal/page.js';

describe('portaal-lettertype', () => {
    it('het lettertype zit in de pagina zelf (data-URI), niet als externe bron', () => {
        for (const html of [renderPage({ nonce: 'n' }), renderTouchPage({ nonce: 'n' })]) {
            const faces = html.match(/@font-face\s*{[^}]*}/g) ?? [];
            expect(faces.map(f => /font-family:\s*['"]?([^;'"]+)/.exec(f)[1]).sort()).toEqual(['Atkinson Hyperlegible Mono', 'Host Grotesk']);
            for (const face of faces) {
                expect(face).toMatch(/src:\s*url\(['"]?data:font\/woff2;base64,[A-Za-z0-9+/=]+['"]?\)/);
                expect(face).not.toMatch(/url\(\s*['"]?(https?:)?\/\//); // MOET afwijzen: een lettertype van buiten
            }
        }
    });
});
