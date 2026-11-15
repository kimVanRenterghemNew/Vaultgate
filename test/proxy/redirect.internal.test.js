// De beslissing of de proxy een redirect volgt, en met of zonder secrets.
import { describe, it, expect } from 'vitest';
import { redirectStep, MAX_REDIRECTS } from '../../src/proxy/redirect.js';

const original = new URL('https://api.github.com/repos/o/r/actions/jobs/1/logs');
const step = over => redirectStep({ follow: true, status: 302, location: 'https://blob.example/x?sig=s', method: 'GET', current: original, original, hops: 0, withSecrets: true, ...over });

describe('redirectStep', () => {
    it('een andere origin: volgen zonder secrets', () => {
        expect(step()).toMatchObject({ follow: true, secrets: false, rule: 'redirect-without-secrets' });
    });
    it('dezelfde origin: volgen met secrets, relatieve Location tegen de huidige URL', () => {
        const s = step({ location: '/repos/o/r2' });
        expect(s).toMatchObject({ follow: true, secrets: true, rule: 'redirect-with-secrets' });
        expect(s.next.href).toBe('https://api.github.com/repos/o/r2');
    });
    it('terug naar de oorspronkelijke origin na een andere host: zonder secrets', () => {
        expect(step({ location: '/back', current: new URL('https://blob.example/x'), withSecrets: false })).toMatchObject({ follow: true, secrets: false });
    });
    it.each([
        ['geen redirect-status', { status: 200 }],
        ['geen Location', { location: undefined }],
        ['een POST', { method: 'POST' }],
        ['niet gevraagd (geen MCP)', { follow: false }],
    ])('niet volgen: %s', (_n, over) => {
        expect(step(over)).toMatchObject({ follow: false, rule: 'redirect-relay' });
    });
    it('MOET weigeren: meer dan het maximum', () => {
        expect(step({ hops: MAX_REDIRECTS })).toMatchObject({ follow: false, deny: true, rule: 'too-many-redirects' });
    });
    it('MOET weigeren: van https naar http', () => {
        expect(step({ location: 'http://api.github.com/x' })).toMatchObject({ deny: true, rule: 'redirect-downgrade' });
    });
    it('MOET weigeren: een ander schema', () => {
        expect(step({ location: 'file:///etc/passwd' })).toMatchObject({ deny: true, rule: 'redirect-downgrade' });
    });
    it('MOET weigeren: naar loopback vanaf een gewone host', () => {
        expect(step({ location: 'https://127.0.0.1:8485/api' })).toMatchObject({ deny: true, rule: 'ssrf-target-blocked' });
        expect(step({ location: 'https://localhost/api' })).toMatchObject({ deny: true, rule: 'ssrf-target-blocked' });
    });
    it('loopback naar loopback mag (lokale diensten, de nep-servers in de tests)', () => {
        const local = new URL('http://127.0.0.1:9000/a');
        expect(step({ location: 'http://127.0.0.1:9001/b', current: local, original: local })).toMatchObject({ follow: true, secrets: false });
    });
});
