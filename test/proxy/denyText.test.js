import { describe, it, expect } from 'vitest';
import { ACCESS_RULES } from '../../src/policy/index.js';
import { denyMessage, DENY_SENTENCES } from '../../src/proxy/index.js';

describe('weigering zegt de tool waarom in gewone taal', () => {
    const PROXY_DENY_RULES = [
        'unknown-route',
        'tunnel-not-supported',
        'audit-unavailable',
        'upstream-error',
        'tls-untrusted',
        'tls-chain-changed',
        'unsupported-encoding',
        'throttled',
        'ssrf-target-blocked',
        'internal-error',
        'subdomain-denied',
        'approval-denied',
        'approval-timeout',
        'approval-unavailable',
        'touch-denied',
        'touch-timeout',
        'touch-unavailable',
        'approval-invalid-answer',
        'needs-approval',
        'grant-expired',
    ];

    it('Given alle weigerregels uit ACCESS_RULES en proxy When de test de tabel leest Then heeft elke regel een zin', () => {
        const accessDenyRules = ACCESS_RULES
            .filter(r => r.then?.allow === false && !r.then?.ask)
            .map(r => r.name);

        const allRules = [...new Set([...accessDenyRules, ...PROXY_DENY_RULES])];

        for (const rule of allRules) {
            expect(DENY_SENTENCES[rule], `regel "${rule}" mist in DENY_SENTENCES`).toBeDefined();
            const message = denyMessage(rule, { tool: 'mytool', secret: 'github_token', host: 'api.github.com', detail: 'test' });
            expect(typeof message).toBe('string');
            expect(message.length).toBeGreaterThan(0);
            const fallback = denyMessage(rule, {});
            expect(typeof fallback).toBe('string');
            expect(fallback.length).toBeGreaterThan(0);
        }
    });

    it('MOET afwijzen: een nieuwe weigerregel zonder zin faalt', () => {
        expect(DENY_SENTENCES['brand-new-unregistered-rule']).toBeUndefined();
        expect(denyMessage('brand-new-unregistered-rule')).toBe('brand-new-unregistered-rule');
    });

    it('Given vault-locked When denyMessage aangeroepen Then blijft het approval-timeout zonder extra uitleg', () => {
        expect(denyMessage('vault-locked')).toBe('approval-timeout');
    });

    it('Given target-host-not-allowed When denyMessage met secret en host Then bevat de zin secret en host en geen waarde', () => {
        const msg = denyMessage('target-host-not-allowed', { secret: 'github_token', host: 'evil.example' });
        expect(msg).toContain('github_token');
        expect(msg).toContain('evil.example');
        expect(msg).not.toContain('supersecretvalue');
    });
});
