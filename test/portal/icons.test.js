// Elk icoon dat een sjabloon of component gebruikt (`#i-…`), bestaat in icons.html: een ontbrekend symbool toont niets,
// zonder fout in de console (zo stonden de ketenpictogrammen van Certificates leeg).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'portal');
const sources = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fonts' ? [] : sources(full);
    return /\.(html|js)$/.test(e.name) && !e.name.includes('.generated.') ? [full] : [];
});
const defined = text => new Set([...text.matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map(m => m[1]));
const used = text => [...text.matchAll(/#(i-[a-z0-9-]+)\b/g)].map(m => m[1]);

/** Gebruikte iconen die niet bestaan, als "bestand: icoon". */
const missing = (files, symbols) => files.flatMap(f => used(fs.readFileSync(f, 'utf8')).filter(i => !symbols.has(i)).map(i => `${path.relative(WEB, f)}: ${i}`));

describe('portaal-iconen', () => {
    const symbols = defined(fs.readFileSync(path.join(WEB, 'components', 'icons.html'), 'utf8'));

    it('elk gebruikt icoon staat in icons.html', () => {
        expect([...new Set(missing(sources(WEB), symbols))]).toEqual([]);
    });

    it('MOET weigeren: een sjabloon met een icoon dat niet bestaat', () => {
        const file = path.join(process.env.VAULTGATE_HOME, 'fake.html');
        fs.writeFileSync(file, '<svg><use href="#i-does-not-exist"/></svg><svg><use href="#i-key"/></svg>');
        expect(missing([file], symbols).map(x => x.split(': ')[1])).toEqual(['i-does-not-exist']);
    });
});
