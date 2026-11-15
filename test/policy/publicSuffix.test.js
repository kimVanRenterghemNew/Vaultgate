// Het registreerbare domein volgens de Public Suffix List, en wanneer een host een subdomein is van een toegestaan
// domein. Een vraag "dit subdomein toevoegen?" mag alleen komen voor hetzelfde registreerbare domein.
import { describe, it, expect } from 'vitest';
import { registrableDomain, sameSiteAs, parseHostRules } from '../../src/policy/index.js';

describe('registreerbaar domein', () => {
    it('gewone domeinen, meerdelige suffixen, private suffixen en uitzonderingen', () => {
        expect(registrableDomain('api.github.com')).toBe('github.com');
        expect(registrableDomain('github.com')).toBe('github.com');
        expect(registrableDomain('a.b.example.co.uk')).toBe('example.co.uk');
        expect(registrableDomain('user.github.io')).toBe('user.github.io'); // github.io is een private suffix
        expect(registrableDomain('www.ck')).toBe('www.ck'); // uitzondering !www.ck onder *.ck
        expect(registrableDomain('xn--fiqs8s.example.com')).toBe('example.com');
    });

    it('MOET geen domein geven: een suffix zelf, een IP-adres, localhost', () => {
        expect(registrableDomain('co.uk')).toBeNull();
        expect(registrableDomain('github.io')).toBeNull();
        expect(registrableDomain('127.0.0.1')).toBeNull();
        expect(registrableDomain('[::1]')).toBeNull();
        expect(registrableDomain('localhost')).toBeNull();
    });
});

describe('subdomein van een toegestaan domein', () => {
    const rules = parseHostRules(['https://api.github.com']);

    it('uploads.github.com hoort bij api.github.com (zelfde registreerbare domein en schema)', () => {
        expect(sameSiteAs(new URL('https://uploads.github.com/x'), rules)).toBe('api.github.com');
    });

    it('MOET weigeren: een ander domein, ander TLD (ook met dezelfde basisnaam zoals github.ninja of registry.npmjs.org), een private suffix van iemand anders, ander schema, of een host die al mag', () => {
        expect(sameSiteAs(new URL('https://github.ninja/'), rules)).toBeNull();
        expect(sameSiteAs(new URL('https://registry.npmjs.org/'), parseHostRules(['https://api.npmjs.com']))).toBeNull();
        expect(sameSiteAs(new URL('https://anthropic.xyz/'), parseHostRules(['https://api.anthropic.com']))).toBeNull();
        expect(sameSiteAs(new URL('https://github.com.evil.example/x'), rules)).toBeNull();
        expect(sameSiteAs(new URL('https://evil.github.io/'), parseHostRules(['https://user.github.io']))).toBeNull();
        expect(sameSiteAs(new URL('http://uploads.github.com/'), rules)).toBeNull();
        expect(sameSiteAs(new URL('https://uploads.github.com:8443/'), rules)).toBeNull();
        expect(sameSiteAs(new URL('https://api.github.com/'), rules)).toBeNull();
        expect(sameSiteAs(new URL('https://uploads.github.com/'), null)).toBeNull();
    });
});
