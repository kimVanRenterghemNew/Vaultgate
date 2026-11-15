// De gecommitte portaal-CSS (web/portal/portal.generated.css) hoort bij de bron en bij de klassen in de pagina: een
// klasse toevoegen in page.js zonder `npm run build:css` laat deze test falen (anders ziet de gebruiker een kale pagina).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

describe('portaal-CSS', () => {
    it('de gecommitte CSS is gelijk aan een verse build (npm run build:css)', () => {
        const out = path.join(process.env.VAULTGATE_HOME, 'portal.check.css');
        execFileSync(process.execPath, [CLI, '-i', 'web/portal/portal.css', '-o', out, '--minify'], { cwd: ROOT, stdio: 'ignore' });
        const committed = fs.readFileSync(path.join(ROOT, 'web', 'portal', 'portal.generated.css'), 'utf8');
        expect(fs.readFileSync(out, 'utf8') === committed, 'voer npm run build:css uit en commit het resultaat').toBe(true);
    }, 30_000);

    it('thema console-light (licht) en dracula (donker, prefers-color-scheme), geen externe bronnen', () => {
        const css = fs.readFileSync(path.join(ROOT, 'web', 'portal', 'portal.generated.css'), 'utf8');
        expect(css).toContain('dracula');
        expect(css).toContain('console-light');
        expect(css).not.toContain('harborlight'); // MOET weigeren: het oude lichte thema
        expect(css).toMatch(/prefers-color-scheme:\s*dark/);
        expect(css).not.toMatch(/@import|url\(\s*['"]?(https?:)?\/\//); // geen externe bron (een URL in de licentiecommentaar mag)
    });

    it('de licentie van het lettertype gaat mee (SIL OFL 1.1)', () => {
        for (const name of ['OFL-host-grotesk.txt', 'OFL-atkinson-hyperlegible-mono.txt']) {
            expect(fs.readFileSync(path.join(ROOT, 'web', 'portal', 'fonts', name), 'utf8')).toContain('SIL Open Font License, Version 1.1');
        }
    });

    it('Windows donker zonder keuze: onze dracula (teal hoofdkleur, mockups v23), niet de roze van daisyUI; licht: console-light', () => {
        const css = fs.readFileSync(path.join(ROOT, 'web', 'portal', 'portal.generated.css'), 'utf8');
        const dark = /prefers-color-scheme:\s*dark\)\s*{\s*:root:not\(\[data-theme\]\)\s*{([^}]*)}/.exec(css)?.[1] ?? '';
        expect(dark).toMatch(/--color-primary:\s*oklch\(76% \.12 182\)/);
        expect(dark).not.toMatch(/346\.812/); // MOET weigeren: de roze primary van de ingebouwde dracula
        const light = /:where\(:root\)[^{]*{([^}]*)}/.exec(css)?.[1] ?? ''; // het standaardthema (licht)
        expect(light).toMatch(/--color-primary:\s*oklch\(54% \.14 70\)/); // console-light: amber
    });
});
