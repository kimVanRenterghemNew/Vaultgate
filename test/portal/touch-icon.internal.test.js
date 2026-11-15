// Het aanraakicoon staat alleen voor de tekst van knoppen die ALTIJD een aanraking vragen. "Altijd" volgt uit de
// beslistabel van de step-up: de handeling van de knop vraagt een aanraking in elke toestand (eerste passkey of niet,
// lege of volle inhoud). Een knop die soms vraagt (afhankelijk van wat er verandert) krijgt geen icoon.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decide } from '../../src/decision/index.js';
import { STEP_UP_RULES } from '../../src/portal/step-up.js';

const VARIANTS = [0, 1].map(credentialCount => ({ credentialCount, body: {}, secret: null, tool: null, settings: null }));
const always = (method, path) => VARIANTS.every(v => decide({ method, path, ...v }, STEP_UP_RULES).stepUp === true);

// [template, data-testid van de knop, de request die de knop doet]
const BUTTONS = [
    ['grants.html', 'g-add', 'POST', '/api/grants'],
    ['grants.html', 'grant-edit-save', 'PUT', '/api/grants/ab'],
    ['grants.html', 'grant-end-temporary-{id}', 'PUT', '/api/grants/ab'],
    ['secrets.html', 'rotate-{name}', 'POST', '/api/secrets/ab/rotate'],
    ['key-create.html', 't-add', 'POST', '/api/tools'],
    ['tools.html', 'tool-rotate-{name}', 'POST', '/api/tools/ab/rotate'],
    ['tools.html', 'tool-reactivate-{name}', 'POST', '/api/tools/ab/reactivate'],
    ['tls.html', 'tls-accept-{host}', 'POST', '/api/tls/accept'],
    ['settings.html', 'set-delete-vault', 'POST', '/api/vault/delete'],
    ['audit.html', 'audit-allow-place', 'PUT', '/api/secrets/ab/inject'],
    // soms of nooit: geen icoon
    ['secrets.html', 'secret-edit-save', 'PUT', '/api/secrets/ab/hosts'],
    ['tools.html', 'tool-edit-save', 'PUT', '/api/tools/ab/clients'],
    ['passkey-add.html', 'pk-add', 'POST', '/api/webauthn/register/options'],
    ['secrets.html', 's-add', 'POST', '/api/secrets'],
    ['tools.html', 'tool-revoke-{name}', 'POST', '/api/tools/ab/revoke'],
    ['audit.html', 'audit-renew', 'GET', '/api/grants'],
    ['audit.html', 'audit-allow-host', 'GET', '/api/grants'],
];

/** Het stuk HTML van `<button` tot `</button>` rond de knop met dit testid. */
function button(file, testid) {
    const html = readFileSync(new URL(`../../web/portal/components/${file}`, import.meta.url), 'utf8');
    const at = html.indexOf(`data-testid="${testid}"`);
    if (at < 0) throw new Error(`${testid} not in ${file}`);
    const start = html.lastIndexOf('<button', at);
    return html.slice(start, html.indexOf('</button>', at));
}
const ICON = /^<button[^>]*>\s*<svg class="size-4[^"]*" aria-hidden="true"><use href="#i-touch"\/><\/svg>/;

describe('aanraakicoon: alleen waar altijd een aanraking nodig is', () => {
    it.each(BUTTONS)('%s %s', (file, testid, method, path) => {
        const html = button(file, testid);
        if (always(method, path)) expect(html).toMatch(ICON);
        else expect(html).not.toContain('#i-touch');
    });

    it('MOET weigeren: knoppen die soms vragen (iets toevoegen, de eerste passkey) gelden niet als altijd', () => {
        expect(always('PUT', '/api/secrets/ab/hosts')).toBe(false);
        expect(always('PUT', '/api/tools/ab/clients')).toBe(false);
        expect(always('POST', '/api/webauthn/register/options')).toBe(false);
        expect(always('PUT', '/api/settings')).toBe(false);
        expect(always('POST', '/api/grants')).toBe(true);
    });

    it('opheffen van een blokkade vraagt altijd, een melding weer aanzetten nooit (zelfde pauzeknop, icoon per soort)', () => {
        expect(always('DELETE', '/api/blocks/ab')).toBe(true);
        expect(always('DELETE', '/api/snooze/grant/ab')).toBe(false);
        expect(always('POST', '/api/snooze/global')).toBe(false);
        expect(button('pause.html', '{id}-resume')).toMatch(/<svg class="size-4[^"]*" aria-hidden="true" data-touch><use href="#i-touch"\/><\/svg>/);
    });
});
