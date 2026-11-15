// De TLS-hulpfuncties van de proxy: opties per doelhost (pin, uitzondering, geldige roots), de controle van een
// expliciet vertrouwde vingerafdruk, en welke regel een TLS-fout krijgt.
import { describe, it, expect, vi } from 'vitest';
import https from 'node:https';
import http from 'node:http';
import { Duplex } from 'node:stream';
import { tlsOptionsFor, fingerprintError, tlsRule, overSocket } from '../../src/proxy/tls-override.js';

/** De bytes die een request over een al geopende socket schrijft (zoals forward() met de gecontroleerde TLS-socket). */
function bytesOverSocket(lib, url) {
    let written = '';
    const socket = new Duplex({ read() {}, write(chunk, _enc, done) { written += chunk; done(); } });
    const req = lib.request(url, { ...overSocket(url, socket), method: 'GET', headers: { 'user-agent': 'p' } });
    req.on('error', () => {});
    req.end();
    return new Promise(resolve => setImmediate(() => resolve(written)));
}

// Gevonden 2026-11-04 (MCP naar GitHub gaf 400 "Whoa there!"): over de eigen socket zette Node `Host: api.github.com:80`
// (zonder agent is de standaardpoort 80), en GitHub weigert dat. Elke https-doelhost op poort 443 kreeg dat.
describe('request over de gecontroleerde socket: de Host-header', () => {
    it('https op de standaardpoort: Host zonder poort', async () => {
        expect(await bytesOverSocket(https, new URL('https://api.github.com/zen'))).toContain('Host: api.github.com\r\n');
    });
    it('http op de standaardpoort en een eigen poort: zoals de URL', async () => {
        expect(await bytesOverSocket(http, new URL('http://example.com/x'))).toContain('Host: example.com\r\n');
        expect(await bytesOverSocket(https, new URL('https://localhost:8443/x'))).toContain('Host: localhost:8443\r\n');
    });
    it('zonder socket: geen opties (de standaardagent)', () => {
        expect(overSocket(new URL('https://api.github.com/'), null)).toEqual({});
    });
});

describe('proxy tls override helpers', () => {
    it('tlsOptionsFor: zonder trust of zonder https geeft lege opties', async () => {
        expect(await tlsOptionsFor(null, new URL('https://api.example.com'))).toEqual({});
        expect(await tlsOptionsFor({ pinFor: async () => null, trustedCaFor: async () => null, roots: async () => ({}), requestOptions: () => ({ x: 1 }) }, new URL('http://api.example.com'))).toEqual({});
    });

    it('tlsOptionsFor: vraagt pin, override en geldige roots op en geeft ze aan requestOptions door', async () => {
        const roots = { ca: ['pem'], fingerprints: new Set(['R']) };
        const trust = {
            pinFor: vi.fn(async () => ({ issuer: 'CN=ca', root: 'R' })),
            trustedCaFor: vi.fn(async () => ({ caPem: 'pem', fingerprint: 'AA' })),
            roots: vi.fn(async () => roots),
            requestOptions: vi.fn(() => ({ ca: ['pem'] })),
        };
        const target = new URL('https://api.example.com');
        const options = await tlsOptionsFor(trust, target);
        expect(options).toEqual({ ca: ['pem'] });
        expect(trust.pinFor).toHaveBeenCalledWith(target.origin);
        expect(trust.trustedCaFor).toHaveBeenCalledWith(target.origin);
        expect(trust.requestOptions).toHaveBeenCalledWith(target, { issuer: 'CN=ca', root: 'R' }, { caPem: 'pem', fingerprint: 'AA' }, roots);
    });

    it('fingerprintError: zonder vertrouwde vingerafdruk geen controle', () => {
        expect(fingerprintError(new URL('https://localhost:8443'), { fingerprint256: 'BB' }, null)).toBeUndefined();
    });

    it('MOET weigeren: een andere vingerafdruk dan de vertrouwde is een gewijzigde keten', () => {
        const error = fingerprintError(new URL('https://localhost:8443'), { fingerprint256: 'BB', subjectaltname: 'DNS:localhost' }, 'AA');
        expect(error).toMatchObject({ code: 'TLS_CHAIN_CHANGED' });
    });

    it('MOET weigeren: de juiste vingerafdruk voor een andere hostnaam (hostcontrole blijft actief)', () => {
        const error = fingerprintError(new URL('https://localhost:8443'), { fingerprint256: 'AA', subjectaltname: 'DNS:other.example' }, 'AA');
        expect(error).toBeInstanceOf(Error);
        expect(error.code).not.toBe('TLS_CHAIN_CHANGED');
    });

    it('fingerprintError: de vertrouwde vingerafdruk voor de juiste host gaat door', () => {
        expect(fingerprintError(new URL('https://localhost:8443'), { fingerprint256: 'AA', subjectaltname: 'DNS:localhost' }, 'AA')).toBeUndefined();
    });

    it.each([
        ['TLS_CHAIN_CHANGED', 'tls-chain-changed'],
        ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls-untrusted'],
        ['SELF_SIGNED_CERT_IN_CHAIN', 'tls-untrusted'],
        ['CERT_HAS_EXPIRED', 'tls-untrusted'],
        ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls-untrusted'],
        ['ECONNREFUSED', 'upstream-error'],
        [undefined, 'upstream-error'],
    ])('tlsRule: %s geeft %s', (code, rule) => {
        expect(tlsRule(Object.assign(new Error('x'), { code }))).toBe(rule);
    });
});
