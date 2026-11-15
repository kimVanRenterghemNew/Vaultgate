// De portaal-UI staat in .html-sjablonen en webcomponents onder web/portal/, gebundeld met esbuild. De
// gecommitte bundels horen bij de bron: een component wijzigen zonder `npm run build:ui` laat deze test falen (anders
// draait de pagina oude code). En: geen externe bron, geen `</script` die de schil vroegtijdig sluit.
import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI = path.join(ROOT, 'web', 'portal');
const ENTRIES = [['index.js', 'portal.generated.js'], ['touch/index.js', 'touch.generated.js']];

/** De bronbestanden van het portaal (zonder de gegenereerde bundels). */
const sources = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(js|html)$/.test(e.name) && !e.name.includes('.generated.') ? [full] : [];
});

// Een grijze browser-pop-up past niet in het portaal (en een invoer daarin is nooit een wachtwoordveld): vragen gaan
// via de dialoog van het portaal.
const NATIVE_DIALOG = /(?<![\w$])(?:confirm|prompt|alert)\s*\(/;
const nativeDialogs = text => text.split('\n').filter(line => NATIVE_DIALOG.test(line));

describe('portaal-UI (gebundeld)', () => {
    it.each(ENTRIES)('de gecommitte bundel van %s is gelijk aan een verse build (npm run build:ui)', async (entry, generated) => {
        const result = await build({
            entryPoints: [path.join(UI, entry)], bundle: true, format: 'iife', loader: { '.html': 'text' }, charset: 'utf8',
            minify: true, treeShaking: true,
            write: false, outfile: path.join(UI, generated), logLevel: 'silent',
        });
        const fresh = result.outputFiles[0].text;
        const committed = fs.readFileSync(path.join(UI, generated), 'utf8');
        expect(fresh === committed, 'voer npm run build:ui uit en commit het resultaat').toBe(true);
    }, 30_000);

    it.each(ENTRIES)('%s: geen externe bron en geen </script in de bundel', (entry, generated) => {
        const js = fs.readFileSync(path.join(UI, generated), 'utf8');
        expect(js).not.toContain('</script');
        expect(js).not.toMatch(/\bimport\s*\(|fetch\(\s*['"`]https?:/); // geen code of data van buiten (een placeholder-URL in een veld mag)
    });

    it('MOET weigeren: een browser-pop-up (confirm, prompt, alert) in de code', () => {
        expect(nativeDialogs("if (confirm(t('x'))) go();")).toHaveLength(1);
        expect(nativeDialogs("const v = prompt('naam', '');")).toHaveLength(1);
        expect(nativeDialogs('window.alert ("x")')).toHaveLength(1);
        expect(nativeDialogs("await ask(t('x'), { confirm: 'ok' }); alerts(); confirmed(); askConfirm()")).toEqual([]);
    });

    it('geen browser-pop-up in de portaalcode: vragen staan in de dialoog van het portaal', () => {
        const found = sources(UI).flatMap(file => nativeDialogs(fs.readFileSync(file, 'utf8')).map(line => `${path.relative(UI, file)}: ${line.trim()}`));
        expect(found).toEqual([]);
    });
});
