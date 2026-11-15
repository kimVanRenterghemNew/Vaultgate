// Vertalingen: Engels is de standaard, elke taal heeft elke sleutel (met dezelfde plaatshouders), er staan geen
// ongebruikte sleutels in, en geen zin staat ingebakken in een sjabloon of in browsercode. Regelnamen blijven Engels.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardcodedInHtml, hardcodedInJs } from '../helpers/hardcodedText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const I18N = path.join(ROOT, 'i18n');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function files(dir, pattern, out = []) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) files(rel, pattern, out);
        else if (pattern.test(entry.name) && !entry.name.includes('.generated.')) out.push(rel);
    }
    return out;
}

let flatten;
let lookup;
let chooseLanguage;
beforeAll(async () => {
    // De browsermodule leest bij het laden de taal van de browser: een minimale omgeving volstaat.
    globalThis.document = { documentElement: {} };
    Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-US'] }, configurable: true });
    globalThis.localStorage = { getItem: () => null };
    ({ flatten, lookup, chooseLanguage } = await import('../../web/portal/core/i18n.js'));
});

const languages = () => fs.readdirSync(I18N).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const catalog = lang => flatten(JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8')));
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('vertalingen', () => {
    it('Engels en Nederlands bestaan; elke taal heeft precies de sleutels van het Engels, met dezelfde plaatshouders', () => {
        expect(languages()).toEqual(expect.arrayContaining(['en', 'nl']));
        const en = catalog('en');
        for (const lang of languages()) {
            const other = catalog(lang);
            expect(Object.keys(other).filter(k => !(k in en)), `${lang}: sleutels die het Engels niet heeft`).toEqual([]);
            expect(Object.keys(en).filter(k => !(k in other)), `${lang}: ontbrekende sleutels`).toEqual([]);
            expect(Object.keys(en).filter(k => placeholders(en[k]).join() !== placeholders(other[k]).join()), `${lang}: andere plaatshouders`).toEqual([]);
            expect(Object.keys(other).filter(k => other[k].trim() === ''), `${lang}: lege teksten`).toEqual([]);
        }
    });

    it('geen ongebruikte sleutels: elke sleutel staat in de code (letterlijk, of als voorvoegsel dat op een punt eindigt)', () => {
        const code = [...files('web', /\.(js|html)$/), ...files('src', /\.(m?js|cs)$/)].map(read).join('\n');
        const literals = new Set([...code.matchAll(/["']([a-z][A-Za-z0-9.-]*)["']/g)].map(m => m[1]));
        const prefixes = [...literals].filter(l => l.endsWith('.'));
        const unused = Object.keys(catalog('en')).filter(k => !literals.has(k) && !prefixes.some(p => k.startsWith(p)));
        expect(unused).toEqual([]);
    });

    it('Given een taal zonder vertaling voor een sleutel When die tekst getoond wordt Then is ze Engels (nooit leeg)', () => {
        const catalogs = { en: { 'a.b': 'Hello {name}' }, nl: {} };
        expect(lookup(catalogs, 'nl', 'a.b', { name: 'Alex' })).toBe('Hello Alex');
        expect(lookup(catalogs, 'fr', 'a.b', { name: 'x' })).toBe('Hello x');
        expect(lookup(catalogs, 'nl', 'onbekend')).toBe('onbekend');
    });

    it('Given systeemtaal nl-BE Then Nederlands; een taal die we niet hebben Then Engels', () => {
        expect(chooseLanguage(['nl-BE', 'en'])).toBe('nl');
        expect(chooseLanguage([null, 'fr-FR', 'de'])).toBe('en');
        expect(chooseLanguage(['en-GB'])).toBe('en');
    });
});

describe('geen ingebakken zinnen', () => {
    it('in de sjablonen van het portaal (.html)', () => {
        const found = files('web/portal', /\.html$/).flatMap(f => hardcodedInHtml(read(f)).map(text => `${f}: ${text}`));
        expect(found).toEqual([]);
    });

    it('in de browsercode van het portaal (.js)', () => {
        const found = files('web/portal', /\.js$/).flatMap(f => hardcodedInJs(read(f)).map(text => `${f}: ${text}`));
        expect(found).toEqual([]);
    });

    it('MOET weigeren: een zin in een sjabloon, in een attribuut, en in een webcomponent; code met translate="no" en een fout mogen', () => {
        expect(hardcodedInHtml('<div class="card"><p>Hello world</p><code translate="no">npm run x</code></div>')).toEqual(['Hello world']);
        expect(hardcodedInHtml('<input placeholder="type your name"><input placeholder="api.github.com">')).toEqual(['placeholder="type your name"']);
        expect(hardcodedInHtml('<span data-i18n="a.b"></span><svg><use href="#i"/></svg>')).toEqual([]);
        expect(hardcodedInJs("say('Secret saved.'); el.className = 'badge badge-soft'; // een commentaar mag")).toEqual(['Secret saved.', 'badge badge-soft']);
        expect(hardcodedInJs("throw new Error('missing template: x'); t('portal.a.b');")).toEqual([]);
    });
});
