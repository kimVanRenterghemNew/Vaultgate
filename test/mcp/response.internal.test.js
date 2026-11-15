// Status en headers voor de agent; een Location via de proxy wordt de echte URL.
import { describe, it, expect } from 'vitest';
import { describeResponse } from '../../src/mcp/response.js';

describe('describeResponse', () => {
    it('status en headers, Location zonder de proxy ervoor', () => {
        const headers = new Map([['location', 'http://127.0.0.1:8484/forward/https://api.example.com/x?a=1'], ['x-vault-gate-rule', 'granted']]);
        expect(describeResponse({ status: 307, headers })).toBe('HTTP 307\nlocation: https://api.example.com/x?a=1\nx-vault-gate-rule: granted');
    });
    it('zonder headers: alleen de status', () => {
        expect(describeResponse({ status: 200 })).toBe('HTTP 200');
    });
});
