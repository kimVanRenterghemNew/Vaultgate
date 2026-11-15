// Clients van andere machines alleen expliciet. Loopback mag altijd; een ander adres alleen als het (of zijn
// subnet) in de client-allowlist van de tool staat.
import { describe, it, expect } from 'vitest';
import { clientAllowed, parseClientRules, decideAccess, INVALID_CLIENT_RULE, parseHostRules } from '../../src/policy/index.js';

const ctx = (client, clients) => ({
    vaultUnlocked: true, tool: { revoked: false, clients: parseClientRules(clients) }, client, granted: true,
    secret: { name: 's', hosts: parseHostRules(['api.example.com']) }, target: new URL('https://api.example.com/'),
});

describe('client-allowlist', () => {
    it('Given een proxy met alleen 127.0.0.1 When een call van een ander adres Then client-not-allowed', () => {
        expect(decideAccess(ctx('192.168.56.10', []))).toMatchObject({ allow: false, status: 403, rule: 'client-not-allowed' });
    });

    it('loopback mag altijd (IPv4, IPv6, IPv4-in-IPv6)', () => {
        for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(clientAllowed(a, []), a).toBe(true);
    });

    it('na het toevoegen van het adres van de VM mag die VM; een buur in hetzelfde net niet', () => {
        const rules = parseClientRules(['192.168.56.10']);
        expect(clientAllowed('192.168.56.10', rules)).toBe(true);
        expect(clientAllowed('::ffff:192.168.56.10', rules)).toBe(true);
        expect(clientAllowed('192.168.56.11', rules)).toBe(false);
    });

    it('een subnet in CIDR-vorm', () => {
        const rules = parseClientRules(['10.0.5.0/24', 'fd00::/64']);
        expect(clientAllowed('10.0.5.200', rules)).toBe(true);
        expect(clientAllowed('10.0.6.1', rules)).toBe(false);
        expect(clientAllowed('fd00::1234', rules)).toBe(true);
    });

    it('MOET weigeren: ongeldige regels en "alles"-regels', () => {
        for (const bad of ['', 'vm.local', '300.1.1.1', '10.0.0.0/33', '0.0.0.0/0', '::/0', '10.0.0.1/abc']) {
            expect(() => parseClientRules([bad]), bad).toThrow(expect.objectContaining({ code: INVALID_CLIENT_RULE }));
        }
    });

    it('een onbekend of leeg adres is nooit toegestaan', () => {
        expect(clientAllowed(undefined, parseClientRules(['10.0.0.1']))).toBe(false);
        expect(clientAllowed('', [])).toBe(false);
    });
});

describe('isLoopback en grantHost', () => {
    it('isLoopback herkent alleen loopback', async () => {
        const { isLoopback } = await import('../../src/policy/index.js');
        expect(['127.0.0.1', '::1', '::ffff:127.0.0.5'].every(isLoopback)).toBe(true);
        expect(['192.168.1.1', '::2', 'localhost', undefined].some(isLoopback)).toBe(false);
    });

    it('een toekenning slaat op de oorsprong van het doel, niet op het pad', async () => {
        const { grantHost } = await import('../../src/policy/index.js');
        expect(grantHost(new URL('https://API.github.com:443/repos/x?y=1'))).toBe('https://api.github.com');
        expect(grantHost(new URL('http://127.0.0.1:5002/v1'))).toBe('http://127.0.0.1:5002');
    });
});
