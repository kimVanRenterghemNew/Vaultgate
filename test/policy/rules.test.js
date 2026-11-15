// Beslistabel van policy (docs/architecture.md §3, §5, §7): elke regel krijgt een scenario waarin hij wint, plus de volgorde
// (eerste regel wint). Statussen: 401 identiteit, 403 niet toegestaan, 423 vergrendeld.
import { describe, it, expect } from 'vitest';
import { decideAccess, ACCESS_RULES, parseHostRules } from '../../src/policy/index.js';

const ok = {
    vaultUnlocked: true,
    tool: { id: 't1', name: 'mytool', revoked: false, clients: [] },
    client: '127.0.0.1',
    secret: { name: 'github_token', hosts: parseHostRules(['api.github.com']) },
    target: new URL('https://api.github.com/user'),
    granted: true,
};

const cases = [
    ['vault-locked', 423, { ...ok, vaultUnlocked: false, tool: null }],
    ['no-tool-key', 401, { ...ok, tool: null }],
    ['tool-key-revoked', 401, { ...ok, tool: { ...ok.tool, revoked: true } }],
    // een tool die roteert, opent alleen met een token; haar lange sleutel is alleen voor de uitwisseling
    ['token-required', 401, { ...ok, tool: { ...ok.tool, rotating: true, via: 'key' } }],
    ['mcp-tool-required', 403, { ...ok, tool: { ...ok.tool, kind: 'mcp' } }],
    ['web-tool-required', 403, { ...ok, tool: { ...ok.tool, kind: 'web' }, protocol: 'mcp' }],
    ['client-not-allowed', 403, { ...ok, client: '192.168.56.10' }],
    ['no-placeholder', 400, { ...ok, secret: null }],
    ['unknown-secret', 403, { ...ok, secret: { name: 'nope', hosts: null } }],
    // een gecodeerde / onder een pad-prefix: de doelhost kan het anders lezen dan de prefix-vergelijking
    ['bad-target', 400, { ...ok, secret: { ...ok.secret, hosts: parseHostRules(['https://api.github.com/repos/user/']) }, target: new URL('https://api.github.com/repos/user/..%2fother') }],
    ['target-host-not-allowed', 403, { ...ok, target: new URL('https://evil.example/user') }],
    ['placeholder-location-not-allowed', 403, { ...ok, locations: ['query:note'] }],
    ['quiet-hours', 403, { ...ok, quietHours: true }],
    ['grant-blocked', 403, { ...ok, blockRule: 'grant-blocked' }],
    ['secret-blocked', 403, { ...ok, blockRule: 'secret-blocked' }],
    ['tool-blocked', 403, { ...ok, blockRule: 'tool-blocked' }],
    // een nieuw subdomein: altijd vragen, ook met een toekenning (de proxy bepaalt subdomainOf)
    ['subdomain-ask', undefined, { ...ok, target: new URL('https://uploads.github.com/x'), subdomainOf: 'api.github.com' }],
    // gewijzigde autorisatievorm (bv. van Bearer naar Basic): opnieuw vragen
    ['auth-shape-changed', undefined, { ...ok, granted: false, authShapeMismatch: true }],
    ['granted', 200, ok],
    ['grant-expired', undefined, { ...ok, granted: false, grantExpired: true }], // 3.4: opnieuw vragen
    ['needs-approval', undefined, { ...ok, granted: false }],
];

describe('policy: beslistabel', () => {
    it.each(cases)('regel %s wint in haar scenario (status %s)', (rule, status, ctx) => {
        const decision = decideAccess(ctx);
        expect(decision.rule).toBe(rule);
        if (status) expect(decision.status).toBe(status);
        expect(decision.allow).toBe(rule === 'granted');
    });

    it('needs-approval vraagt goedkeuring en laat niets door', () => {
        expect(decideAccess({ ...ok, granted: false })).toMatchObject({ allow: false, ask: true });
    });

    it('eerste regel wint: vergrendeld gaat voor een ontbrekende key, een ingetrokken key voor een vreemde client, een vreemde host voor goedkeuring', () => {
        expect(decideAccess({ ...ok, vaultUnlocked: false, tool: null }).rule).toBe('vault-locked');
        expect(decideAccess({ ...ok, tool: { ...ok.tool, revoked: true }, client: '10.0.0.1' }).rule).toBe('tool-key-revoked');
        expect(decideAccess({ ...ok, granted: false, target: new URL('https://evil.example/') }).rule).toBe('target-host-not-allowed');
    });

    it('elke regel in de tabel heeft een scenario in deze test, en de tabel eindigt met een expliciete standaard', () => {
        expect(ACCESS_RULES.map(r => r.name).sort()).toEqual(cases.map(c => c[0]).sort());
        expect(ACCESS_RULES.at(-1).name).toBe('needs-approval');
    });
});

describe('policy: beller (identiteit en herkomst)', () => {
    it('dezelfde eerste vier regels, daarna caller-ok', async () => {
        const { decideCaller } = await import('../../src/policy/index.js');
        expect(decideCaller({ ...ok, vaultUnlocked: false }).rule).toBe('vault-locked');
        expect(decideCaller({ ...ok, tool: null }).rule).toBe('no-tool-key');
        expect(decideCaller({ ...ok, client: '10.1.1.1' }).rule).toBe('client-not-allowed');
        expect(decideCaller({ ...ok, secret: null }).rule).toBe('caller-ok');
    });
});
