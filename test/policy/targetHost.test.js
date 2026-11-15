// Doelhost-allowlist per secret. Exacte host, optioneel poort en pad-prefix; geen wildcards. IDN als punycode.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseHostRules, targetAllowed, ambiguousPath, decideAccess, INVALID_HOST_RULE } from '../../src/policy/index.js';

const allowed = (rules, url) => targetAllowed(new URL(url), parseHostRules(rules));

describe('doelhost-allowlist', () => {
    it('Given een secret met allowlist api.github.com When een call naar evil.example Then target-host-not-allowed', () => {
        const decision = decideAccess({
            vaultUnlocked: true, tool: { revoked: false, clients: [] }, client: '127.0.0.1', granted: true,
            secret: { name: 'github_token', hosts: parseHostRules(['api.github.com']) }, target: new URL('https://evil.example/user'),
        });
        expect(decision).toMatchObject({ allow: false, status: 403, rule: 'target-host-not-allowed' });
    });

    it('een kale host betekent https op poort 443, elk pad', () => {
        expect(allowed(['api.github.com'], 'https://api.github.com/repos/x')).toBe(true);
        expect(allowed(['api.github.com'], 'https://API.GitHub.com:443/')).toBe(true);
        expect(allowed(['api.github.com'], 'http://api.github.com/')).toBe(false); // geen downgrade naar http
        expect(allowed(['api.github.com'], 'https://api.github.com:8443/')).toBe(false);
    });

    it('MOET weigeren: lookalikes, subdomeinen, achtervoegsels en userinfo-trucs', () => {
        for (const url of [
            'https://api.github.com.evil.example/',
            'https://evil-api.github.com/',
            'https://xapi.github.com/',
            'https://api.github.co/',
            'https://api.github.com@evil.example/',
            'https://evil.example/?https://api.github.com/',
            'https://аpi.github.com/', // Cyrillische a: wordt punycode, dus een andere host
        ]) expect(allowed(['api.github.com'], url), url).toBe(false);
    });

    it('expliciete oorsprong met poort en http (bv. een eigen LiteLLM) en een pad-prefix', () => {
        expect(allowed(['http://127.0.0.1:5002'], 'http://127.0.0.1:5002/v1/chat/completions')).toBe(true);
        expect(allowed(['http://127.0.0.1:5002'], 'http://127.0.0.1:5003/v1')).toBe(false);
        expect(allowed(['https://api.github.com/repos/user/'], 'https://api.github.com/repos/user/x')).toBe(true);
        expect(allowed(['https://api.github.com/repos/user/'], 'https://api.github.com/repos/userx')).toBe(false);
        expect(allowed(['https://api.github.com/repos/user/'], 'https://api.github.com/repos/user/../other')).toBe(false); // URL normaliseert ..
    });

    describe('pad-encoding onder een pad-prefix', () => {
        const prefixed = ['https://api.github.com/repos/user/'];
        const ctx = url => ({
            vaultUnlocked: true, tool: { revoked: false, clients: [] }, client: '127.0.0.1', granted: true,
            secret: { name: 'github_token', hosts: parseHostRules(prefixed) }, target: new URL(url),
        });

        it('Given een allowlist /repos/user/ When een request naar /repos/user/..%2fother Then weigert de proxy met bad-target', () => {
            expect(decideAccess(ctx('https://api.github.com/repos/user/..%2fother'))).toMatchObject({ allow: false, status: 400, rule: 'bad-target' });
        });

        it('MOET weigeren: gecodeerde slash, backslash, punt en dubbele encoding, in elke hoofdlettervorm', () => {
            for (const path of ['..%2fother', '..%2Fother', 'x%5c..%5cother', '%2e%2e%2fother', 'x%2e%2E', 'x/a%2E','..%252fother', '%25%32%66']) {
                const url = `https://api.github.com/repos/user/${path}`;
                expect(allowed(prefixed, url), url).toBe(false);
                expect(decideAccess(ctx(url)), url).toMatchObject({ allow: false, status: 400, rule: 'bad-target' });
            }
        });

        it('MOET weigeren: matrix-parameters (; en %3b) die door upstream frameworks (Spring/Tomcat) als traversal gezien worden', () => {
            for (const path of ['..;/other', 'x;param=1/..;/other', '..%3bother', '..%3Bother', 'a;foo']) {
                const url = `https://api.github.com/repos/user/${path}`;
                expect(allowed(prefixed, url), url).toBe(false);
                expect(decideAccess(ctx(url)), url).toMatchObject({ allow: false, status: 400, rule: 'bad-target' });
            }
        });

        it('MOET weigeren: opeenvolgende slashes (//), null-bytes (%00) en trailing dots/spaties', () => {
            for (const path of ['other//sub', 'test%00', 'test.', 'test./sub', 'test%20/sub', 'test /sub']) {
                const url = `https://api.github.com/repos/user/${path}`;
                expect(allowed(prefixed, url), url).toBe(false);
                expect(decideAccess(ctx(url)), url).toMatchObject({ allow: false, status: 400, rule: 'bad-target' });
            }
        });

        it('een backslash wordt door de URL-parser een slash: ..\\.. eindigt buiten het prefix en blijft geweigerd', () => {
            expect(allowed(prefixed, 'https://api.github.com/repos/user/a\\..\\..\\other')).toBe(false);
            // een volledig segment `%2e%2e` of `%2E` is voor de URL-parser een punt-segment en wordt al genormaliseerd
            expect(new URL('https://api.github.com/repos/user/%2e%2e/other').pathname).toBe('/repos/other');
            expect(allowed(prefixed, 'https://api.github.com/repos/user/x/%2E')).toBe(true); // = /repos/user/x/
        });

        it('zonder pad-prefix (hele host) of met een gewoon pad blijft het toegestaan; een andere host blijft target-host-not-allowed', () => {
            expect(allowed(['api.github.com'], 'https://api.github.com/repos/user/..%2fother')).toBe(true);
            expect(allowed([...prefixed, 'api.github.com'], 'https://api.github.com/repos/user/..%2fother')).toBe(true);
            expect(allowed(prefixed, 'https://api.github.com/repos/user/a%20b/c-d_e.f')).toBe(true);
            expect(decideAccess(ctx('https://evil.example/repos/user/..%2fother')).rule).toBe('target-host-not-allowed');
        });

        it('MOET weigeren: een regel met een gecodeerd pad-prefix', () => {
            for (const bad of ['https://x.example/a%2fb/', 'https://x.example/a%5c', 'https://x.example/x%2e/', 'https://x.example/a%25/']) {
                expect(() => parseHostRules([bad]), bad).toThrow(expect.objectContaining({ code: INVALID_HOST_RULE }));
            }
        });

        it('invariant: een pad met een gecodeerde /, \\, ., ; of % gaat nooit door een pad-prefix, een gewoon pad onder het prefix wel', () => {
            const plain = fc.stringMatching(/^[a-zA-Z0-9_~-]{1,8}$/);
            const risky = fc.constantFrom('%2f', '%2F', '%5c', '%5C', '%2e', '%2E', '%25', '%252f', '%255c', ';', '%3b', '%3B', '%00', '//');
            fc.assert(fc.property(plain, risky, plain, (a, r, b) => {
                const url = new URL(`https://api.github.com/repos/user/x${a}${r}${b}`);
                expect(targetAllowed(url, parseHostRules(prefixed))).toBe(false);
                expect(ambiguousPath(url, parseHostRules(prefixed))).toBe(true);
            }));
            fc.assert(fc.property(fc.array(plain, { minLength: 1, maxLength: 4 }), parts => {
                expect(allowed(prefixed, `https://api.github.com/repos/user/${parts.join('/')}`)).toBe(true);
            }));
        });
    });

    it('een IDN-host in de allowlist wordt punycode en matcht alleen zichzelf', () => {
        expect(parseHostRules(['bücher.example'])[0].host).toBe('xn--bcher-kva.example');
        expect(allowed(['bücher.example'], 'https://xn--bcher-kva.example/')).toBe(true);
    });

    it('MOET weigeren: wildcards, lege regels, andere schema\'s, query of fragment in een regel', () => {
        for (const bad of ['*.github.com', '', 'ftp://x.example', 'https://x.example/?a=1', 'https://x.example/#f', 'https://user@x.example', 'https:// x']) {
            expect(() => parseHostRules([bad]), bad).toThrow(expect.objectContaining({ code: INVALID_HOST_RULE }));
        }
        expect(() => parseHostRules([])).toThrow(expect.objectContaining({ code: INVALID_HOST_RULE }));
    });

    it('invariant: een host die niet letterlijk in de allowlist staat, wordt nooit toegestaan', () => {
        const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
        fc.assert(fc.property(fc.array(label, { minLength: 2, maxLength: 3 }), fc.array(label, { minLength: 2, maxLength: 3 }), (a, b) => {
            const ruleHost = a.join('.');
            const targetHost = b.join('.');
            expect(allowed([ruleHost], `https://${targetHost}/x`)).toBe(ruleHost === targetHost);
        }));
    });
});
