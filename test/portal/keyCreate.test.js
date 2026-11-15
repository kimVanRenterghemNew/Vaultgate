// 4.47 (product owner, 2026-10-16): "zorg dat bv. voor het toevoegen van de virtual keys maar één component gebruikt wordt".
// Een virtuele key maken is één component (key-create.html): het welkom en Virtual keys zetten het neer, en geen ander
// sjabloon heeft een eigen naamveld of soortkeuze voor een key.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'portal', 'components');
const read = f => fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
const templates = fs.readdirSync(COMPONENTS).filter(f => f.endsWith('.html')).map(f => [f, read(f)]);
/** Sjablonen met eigen velden om een key te maken: een naamveld voor een tool of een keuze webrequests/MCP. */
const keyFields = list => list.filter(([, html]) => /data-testid="t-name"|data-kind="(web|mcp)"/.test(html)).map(([f]) => f);

describe('een virtuele key maken is één component', () => {
    it('alleen key-create.html heeft de velden; het heeft de drie stappen van de mockups', () => {
        expect(keyFields(templates)).toEqual(['key-create.html']);
        const html = read('key-create.html');
        expect([...html.matchAll(/class="step-num"[^>]*>(\d)</g)].map(m => m[1])).toEqual(['1', '2', '3']);
    });

    it('het welkom en Virtual keys gebruiken hetzelfde element', () => {
        for (const f of ['welcome.js', 'tools.js']) expect(read(f)).toContain("place('ks-key-create'");
        expect(fs.existsSync(path.join(COMPONENTS, 'key-ways.html'))).toBe(false);
        expect(fs.existsSync(path.join(COMPONENTS, 'key-form.html'))).toBe(false);
    });

    it('een key tonen is ook één component (key-reveal.html): bij aanmaken in de stap, bij Rotate in de dialoog', () => {
        expect(templates.filter(([, html]) => html.includes('data-testid="t-key"')).map(([f]) => f)).toEqual(['key-reveal.html']);
        expect(read('key-create.js')).toContain('revealKey(');
        expect(read('key-config.js')).toContain('revealKey(');
    });

    it('MOET weigeren: een tweede sjabloon met een eigen naamveld valt op', () => {
        expect(keyFields([...templates, ['other.html', '<input data-testid="t-name">']])).not.toEqual(['key-create.html']);
    });
});
