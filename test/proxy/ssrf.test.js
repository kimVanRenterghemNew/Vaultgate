import { describe, it, expect, vi } from 'vitest';
import { isProhibitedIp, validateTarget } from '../../src/proxy/index.js';

describe('SSRF bestemmings-validatie', () => {
    describe('isProhibitedIp', () => {
        it('MOET weigeren: AWS/GCP cloud metadata 169.254.169.254 en link-local subnet 169.254.0.0/16', () => {
            expect(isProhibitedIp('169.254.169.254')).toBe(true);
            expect(isProhibitedIp('169.254.1.1')).toBe(true);
            expect(isProhibitedIp('::ffff:169.254.169.254')).toBe(true);
        });

        it('MOET weigeren: IPv6 link-local fe80::/10', () => {
            expect(isProhibitedIp('fe80::1')).toBe(true);
            expect(isProhibitedIp('fe90::1234')).toBe(true);
            expect(isProhibitedIp('fea0::1')).toBe(true);
            expect(isProhibitedIp('feb0::1')).toBe(true);
        });

        it('MOET weigeren: loopback 127.0.0.1 en ::1 wanneer allowLoopback false is', () => {
            expect(isProhibitedIp('127.0.0.1', { allowLoopback: false })).toBe(true);
            expect(isProhibitedIp('127.0.0.2', { allowLoopback: false })).toBe(true);
            expect(isProhibitedIp('::1', { allowLoopback: false })).toBe(true);
            expect(isProhibitedIp('::ffff:127.0.0.1', { allowLoopback: false })).toBe(true);
        });

        it('laat loopback toe wanneer allowLoopback expliciet true is (lokale test-endpoints)', () => {
            expect(isProhibitedIp('127.0.0.1', { allowLoopback: true })).toBe(false);
            expect(isProhibitedIp('::1', { allowLoopback: true })).toBe(false);
        });

        it('laat geldige publieke IP-adressen door', () => {
            expect(isProhibitedIp('140.82.121.4')).toBe(false); // GitHub
            expect(isProhibitedIp('1.1.1.1')).toBe(false);
            expect(isProhibitedIp('2606:4700:4700::1111')).toBe(false);
        });
    });

    describe('validateTarget', () => {
        it('Given een IP als doelhost naar 169.254.169.254 When gevalideerd Then geblokkeerd met ssrf-target-blocked', async () => {
            const result = await validateTarget(new URL('http://169.254.169.254/latest/meta-data'));
            expect(result).toMatchObject({
                blocked: true,
                rule: 'ssrf-target-blocked',
                status: 403,
                ip: '169.254.169.254',
            });
        });

        it('Given een domein dat via DNS resolvet naar cloud-metadata When gevalideerd Then weigert de validatie', async () => {
            const lookup = vi.fn(async () => [{ address: '169.254.169.254', family: 4 }]);
            const result = await validateTarget(new URL('https://evil-metadata.example/'), { lookup });
            expect(lookup).toHaveBeenCalledWith('evil-metadata.example', { all: true });
            expect(result).toMatchObject({
                blocked: true,
                rule: 'ssrf-target-blocked',
                status: 403,
                ip: '169.254.169.254',
            });
        });

        it('Given een domein dat via DNS resolvet naar loopback 127.0.0.1 When niet-localhost domein Then geblokkeerd', async () => {
            const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
            const result = await validateTarget(new URL('https://rebound.example/'), { lookup });
            expect(result).toMatchObject({
                blocked: true,
                rule: 'ssrf-target-blocked',
                status: 403,
                ip: '127.0.0.1',
            });
        });

        it('Given localhost of 127.0.0.1 als expliciete doelhost When gevalideerd Then toegestaan', async () => {
            const result = await validateTarget(new URL('http://127.0.0.1:5002/v1'));
            expect(result).toMatchObject({ blocked: false, ip: '127.0.0.1' });
        });

        it('Given een legitieme externe doelhost met publiek IP When gevalideerd Then toegestaan', async () => {
            const lookup = vi.fn(async () => [{ address: '140.82.121.4', family: 4 }]);
            const result = await validateTarget(new URL('https://api.github.com/repos'), { lookup });
            expect(result).toMatchObject({ blocked: false, ip: '140.82.121.4' });
        });
    });
});
