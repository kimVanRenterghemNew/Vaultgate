import { describe, it, expect } from 'vitest';
import { scrubStrings, computeTotp, fill, basicPassword, outgoingHeaders, fillUrl, placeholders, authShape } from '../../src/proxy/fill.js';

describe('fill & scrubStrings', () => {
    it('scrubStrings bevat de berekende 6-cijferige TOTP-code zodat deze in antwoorden gescrubd wordt', () => {
        const seed = 'JBSWY3DPEHPK3PXP';
        const code = computeTotp(seed);
        expect(code).toMatch(/^\d{6}$/);

        const values = new Map([
            ['my_totp', { kind: 'login', value: 'secretpass', totp: seed, username: 'admin_user' }],
        ]);
        const strings = scrubStrings(values);

        // De berekende 6-cijferige code MOET gescrubd worden
        expect(strings).toContain(code);
        // De seed zelf moet ook gescrubd worden
        expect(strings).toContain(seed);
        // Het wachtwoord moet gescrubd worden
        expect(strings).toContain('secretpass');

        // Ongeldige TOTP seed gooit geen fout maar slaat berekening over
        const badTotp = scrubStrings(new Map([['bad', { kind: 'login', totp: '1' }]]));
        expect(badTotp).toContain('1');
    });

    it('scrubStrings bevat GEEN gebruikersnaam (voorkomt verminking van normale API-antwoorden)', () => {
        const values = new Map([
            ['login_secret', { kind: 'login', value: 'verysecretpassword123', username: 'admin', basic: 'YWRtaW46dmVyeXNlY3JldHBhc3N3b3JkMTIz' }],
        ]);
        const strings = scrubStrings(values);

        // De gebruikersnaam "admin" mag NIET gescrubd worden
        expect(strings).not.toContain('admin');
        // Het wachtwoord en basic auth token wel
        expect(strings).toContain('verysecretpassword123');
        expect(strings).toContain('YWRtaW46dmVyeXNlY3JldHBhc3N3b3JkMTIz');
    });

    it('fill vult {{secret:...}}, {{basic:...}} en {{totp:...}} in', () => {
        const seed = 'JBSWY3DPEHPK3PXP';
        const values = new Map([
            ['apikey', 'secret-key-999'],
            ['login', { kind: 'login', username: 'alice', password: 'secretpassword', basic: 'YWxpY2U6c2VjcmV0cGFzc3dvcmQ=', totp: seed }],
            ['u', { kind: 'login', username: 'bob' }],
            ['p', { kind: 'login', password: 'pw' }],
            ['onlypass', { kind: 'login', password: 'secret' }],
            ['nullsec', null],
        ]);

        expect(fill('Bearer {{secret:apikey}}', values)).toBe('Bearer secret-key-999');
        expect(fill('Basic {{basic:login}}', values)).toBe('Basic YWxpY2U6c2VjcmV0cGFzc3dvcmQ=');
        expect(fill('Basic {{basic:u:p}}', values)).toBe(`Basic ${Buffer.from('bob:pw').toString('base64')}`);
        expect(fill('Basic {{basic:onlypass}}', values)).toBe(`Basic ${Buffer.from('secret').toString('base64')}`);
        expect(fill('Basic {{basic:nullsec}}', values)).toBe(`Basic ${Buffer.from('').toString('base64')}`);
        expect(fill('Code: {{totp:login}}', values)).toMatch(/^Code: \d{6}$/);
        expect(fill('None: {{secret:unknown}}', values)).toBe('None: {{secret:unknown}}');
        expect(fill('None: {{totp:unknown}}', values)).toBe('None: {{totp:unknown}}');
        expect(fill('None: {{basic:unknown}}', values)).toBe('None: {{basic:unknown}}');
        expect(fill('None: {{basic:u:unknown}}', values)).toBe('None: {{basic:u:unknown}}');
    });

    it('basicPassword haalt het wachtwoord uit een HTTP Basic-header', () => {
        const header = `Basic ${Buffer.from('mytool:ks_password12345').toString('base64')}`;
        expect(basicPassword(header)).toBe('mytool:ks_password12345');
        expect(basicPassword('Bearer token')).toBeNull();
    });

    it('outgoingHeaders stript hop-by-hop headers en tool keys en vult route headers in', () => {
        const values = new Map([
            ['tok', 'secret_token_123'],
            ['login', { password: 'pw' }],
        ]);
        const req = {
            headers: {
                host: 'api.example.com',
                connection: 'keep-alive',
                'x-vault-gate-protocol': 'mcp',
                'x-custom': 'val-{{secret:tok}}',
                'x-multi': ['{{secret:tok}}', 'plain'],
                'x-leak': 'ks_toolkey12345678901234567890',
                authorization: `Basic ${Buffer.from('tool:ks_toolkey12345678901234567890').toString('base64')}`,
            },
        };
        const headers = outgoingHeaders(req, {
            toolKey: 'ks_toolkey12345678901234567890',
            values,
            route: { secret: 'tok', header: 'authorization' },
        });

        expect(headers.connection).toBeUndefined();
        expect(headers['x-vault-gate-protocol']).toBeUndefined();
        expect(headers['x-leak']).toBeUndefined();
        expect(headers['x-custom']).toBe('val-secret_token_123');
        expect(headers['x-multi']).toEqual(['secret_token_123', 'plain']);
        expect(headers.authorization).toBe('Bearer secret_token_123');
        expect(headers['accept-encoding']).toBe('identity');

        // Route met basic auth
        const headersBasic = outgoingHeaders(req, {
            values,
            route: { secret: 'tok', header: 'basic' },
        });
        expect(headersBasic.authorization).toBe(`Basic ${Buffer.from('x-access-token:secret_token_123').toString('base64')}`);

        // Route met custom header
        const headersCustom = outgoingHeaders(req, {
            values,
            route: { secret: 'tok', header: 'x-api-key' },
        });
        expect(headersCustom['x-api-key']).toBe('secret_token_123');

        // Route met object zonder password maar met value
        const headersValObj = outgoingHeaders(req, {
            values: new Map([['valSec', { value: 'api-val' }]]),
            route: { secret: 'valSec', header: 'x-key' },
        });
        expect(headersValObj['x-key']).toBe('api-val');
    });

    it('fillUrl vervangt secret, totp en basic in querystrings', () => {
        const seed = 'JBSWY3DPEHPK3PXP';
        const values = new Map([
            ['key', 'my-api-key'],
            ['t', { totp: seed }],
            ['cred', { basic: 'basic-auth-str', username: 'u', password: 'p' }],
            ['u', { username: 'user1' }],
            ['p', { password: 'pass1' }],
        ]);

        const u1 = fillUrl('https://example.com/api?k={{secret:key}}', values);
        expect(u1.search).toBe('?k=my-api-key');

        const u2 = fillUrl('https://example.com/api?code={{totp:t}}', values);
        expect(u2.search).toMatch(/^\?code=\d{6}$/);

        const u3 = fillUrl('https://example.com/api?b={{basic:cred}}', values);
        expect(u3.search).toBe('?b=basic-auth-str');

        const u4 = fillUrl('https://example.com/api?b={{basic:u:p}}', values);
        expect(u4.search).toBe(`?b=${encodeURIComponent(Buffer.from('user1:pass1').toString('base64'))}`);

        const u5 = fillUrl('https://example.com/api?unknown={{secret:none}}', values);
        expect(u5.search).toBe('?unknown={{secret:none}}');

        // basic fallback zonder basic property
        const u6 = fillUrl('https://example.com/api?b={{basic:p}}', values);
        expect(u6.search).toBe(`?b=${encodeURIComponent(Buffer.from('pass1').toString('base64'))}`);

        // basic met ontbrekende b parameter in values
        const u7 = fillUrl('https://example.com/api?b={{basic:u:missing}}', values);
        expect(u7.search).toBe('?b={{basic:u:missing}}');

        // totp zonder seed
        const u8 = fillUrl('https://example.com/api?t={{totp:p}}', values);
        expect(u8.search).toBe('?t={{totp:p}}');
    });

    it('placeholders herkent alle plaatshouders in headers en target URL', () => {
        const headers = {
            authorization: 'Bearer {{secret:api_key}}',
            'x-multi': ['{{basic:u:p}}', '{{totp:auth}}'],
        };
        const target = new URL('https://example.com/search?q={{secret:term}}&{{secret:keyname}}=val&%7B%7Bsecret:orphan%7D%7D');
        const p = placeholders(headers, target);

        expect(p.get('api_key')).toEqual(['header:authorization']);
        expect(p.get('u')).toEqual(['header:x-multi']);
        expect(p.get('p')).toEqual(['header:x-multi']);
        expect(p.get('auth')).toEqual(['header:x-multi']);
        expect(p.get('term')).toContain('query:q');
        expect(p.get('keyname')).toContain('query-name');
        expect(p.get('orphan')).toContain('query-name');
    });

    it('authShape herkent autorisatievormen (bearer, basic, totp, token, custom header, query)', () => {
        expect(authShape(null, null, 'x')).toBeNull();
        expect(authShape({}, new URL('https://example.com/'), 'x')).toBeNull();

        // Bearer
        expect(authShape({ authorization: 'Bearer {{secret:sec}}' }, null, 'sec')).toBe('header:authorization:bearer');
        // Basic
        expect(authShape({ authorization: 'Basic {{basic:sec}}' }, null, 'sec')).toBe('header:authorization:basic');
        expect(authShape({ authorization: '{{basic:sec}}' }, null, 'sec')).toBe('header:authorization:basic');
        // Totp
        expect(authShape({ authorization: '{{totp:sec}}' }, null, 'sec')).toBe('header:authorization:totp');
        // Raw token in authorization
        expect(authShape({ authorization: '{{secret:sec}}' }, null, 'sec')).toBe('header:authorization:token');
        // Custom header
        expect(authShape({ 'x-api-key': '{{secret:sec}}' }, null, 'sec')).toBe('header:x-api-key');
        // Query param
        expect(authShape({}, new URL('https://example.com/?api_key={{secret:sec}}'), 'sec')).toBe('query:api_key');
    });
});
