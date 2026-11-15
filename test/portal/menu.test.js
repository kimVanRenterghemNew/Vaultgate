// 4.44 (product owner, 2026-10-16): "zorg dat bv. voor het menu maar één component gebruikt wordt". Het menu bestaat op één
// plek (components/menu.html, één lijst), de kopbalk zet het neer, en geen ander sjabloon maakt zijn eigen menu-items.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'portal', 'components');
const templates = fs.readdirSync(COMPONENTS).filter(f => f.endsWith('.html')).map(f => [f, fs.readFileSync(path.join(COMPONENTS, f), 'utf8')]);
const menuItems = html => [...html.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);

describe('het menu is één component', () => {
    it('alleen menu.html heeft menu-items; de volgorde volgt de mockups v23', () => {
        const withItems = templates.filter(([, html]) => menuItems(html).length).map(([f]) => f);
        expect(withItems).toEqual(['menu.html']);
        expect(menuItems(templates.find(([f]) => f === 'menu.html')[1])).toEqual(['audit', 'tools', 'secrets', 'grants', 'tls', 'passkeys', 'settings']);
    });

    it('de kopbalk zet het menu neer, het hoofdscherm niet', () => {
        expect(templates.find(([f]) => f === 'header.html')[1]).toContain('<ks-menu');
        expect(templates.find(([f]) => f === 'main.html')[1]).not.toContain('role="tab"');
    });

    it('MOET weigeren: een tweede sjabloon met een eigen menu-item valt op', () => {
        const extra = [...templates, ['other.html', '<button data-tab="secrets"></button>']];
        expect(extra.filter(([, html]) => menuItems(html).length).map(([f]) => f)).not.toEqual(['menu.html']);
    });
});
