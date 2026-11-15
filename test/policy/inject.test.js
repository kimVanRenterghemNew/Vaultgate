// Injectiebeleid per secret. De allowlist bewaakt waarheen; dit bewaakt
// waar in de request een secret mag komen. Een plaatshouder op een andere plek (bv. `?note={{secret:x}}` naar een
// schrijf-endpoint van een toegestane host) wordt geweigerd vóór goedkeuring en zonder ontsleutelen.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseInjectRules, parseInjectPlaces, injectAllowed, decideAccess, parseHostRules, DEFAULT_INJECT, LEGACY_INJECT, MAX_INJECT } from '../../src/policy/index.js';

describe('injectieplekken', () => {
    it('geldige plekken worden genormaliseerd (headernaam in kleine letters)', () => {
        expect(parseInjectRules(['header:Authorization', 'header:x-api-key', 'query:key'])).toEqual(['header:authorization', 'header:x-api-key', 'query:key']);
        expect(DEFAULT_INJECT).toEqual(['header:authorization']);
    });

    for (const bad of [[], ['authorization'], ['header:'], ['header:host'], ['header:x-vault-gate-tool-key'], ['header:bad name'], ['query:'], ['body:x'], 'header:authorization']) {
        it(`MOET weigeren: ${JSON.stringify(bad)}`, () => {
            expect(() => parseInjectRules(bad)).toThrow(expect.objectContaining({ code: 'INVALID_INJECT_RULE' }));
        });
    }

    it('alle plekken van een plaatshouder moeten toegestaan zijn', () => {
        expect(injectAllowed(['header:authorization'], ['header:authorization'])).toBe(true);
        expect(injectAllowed(['header:authorization'], ['header:authorization', 'query:note'])).toBe(false);
        expect(injectAllowed(['header:authorization'], ['header:x-custom'])).toBe(false);
        expect(injectAllowed(['query:key'], ['query:key'])).toBe(true);
    });

    it('een secret zonder ingestelde plekken (van vóór 9.4): elke header, nooit de query', () => {
        expect(injectAllowed(LEGACY_INJECT, ['header:x-whatever'])).toBe(true);
        expect(injectAllowed(LEGACY_INJECT, ['query:note'])).toBe(false);
        expect(injectAllowed(LEGACY_INJECT, ['query-name'])).toBe(false);
    });

    it('eigenschap: een query-plek is nooit toegestaan tenzij expliciet die parameter', () => {
        fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), (allowed, used) => {
            expect(injectAllowed([`query:${allowed}`], [`query:${used}`])).toBe(allowed === used);
            expect(injectAllowed(['header:authorization'], [`query:${used}`])).toBe(false);
        }));
    });

    it('beslistabel: placeholder-location-not-allowed na de host-controle en vóór granted (geen vraag, geen ontsleutelen)', () => {
        const base = { vaultUnlocked: true, tool: { revoked: false, clients: [] }, client: '127.0.0.1', target: new URL('https://api.example.com/x'), granted: true };
        const secret = { name: 's', hosts: parseHostRules(['https://api.example.com']), inject: ['header:authorization'] };
        expect(decideAccess({ ...base, secret, locations: ['query:note'] })).toMatchObject({ allow: false, status: 403, rule: 'placeholder-location-not-allowed' });
        expect(decideAccess({ ...base, secret, locations: ['header:authorization'] })).toMatchObject({ allow: true, rule: 'granted' });
    });

    it('nog te leren (lege lijst): een geldige plek mag; MOET weigeren: een gereserveerde header of meer dan MAX_INJECT plekken', () => {
        const base = { vaultUnlocked: true, tool: { revoked: false, clients: [] }, client: '127.0.0.1', target: new URL('https://api.example.com/x'), granted: true };
        const secret = { name: 's', hosts: parseHostRules(['https://api.example.com']), inject: [] };
        expect(decideAccess({ ...base, secret, locations: ['header:x-api-key'] })).toMatchObject({ allow: true, rule: 'granted' });
        expect(decideAccess({ ...base, secret, locations: ['header:cookie'] })).toMatchObject({ allow: false, rule: 'placeholder-location-not-allowed' });
        expect(decideAccess({ ...base, secret, locations: ['header:a', 'header:b', 'header:c', 'header:d'] })).toMatchObject({ allow: false, rule: 'placeholder-location-not-allowed' });
    });

    it('parseInjectPlaces: leeg mag (nog te leren), hooguit MAX_INJECT plekken', () => {
        expect(parseInjectPlaces([])).toEqual([]);
        expect(parseInjectPlaces(['header:X-Api-Key'])).toEqual(['header:x-api-key']);
        expect(() => parseInjectPlaces(Array.from({ length: MAX_INJECT + 1 }, (_, i) => `header:h${i}`))).toThrow(expect.objectContaining({ code: 'INVALID_INJECT_RULE' }));
    });
});
