// De beslistabel van de step-up: wat meer toelaat, vraagt een aanraking; wat minder toelaat niet. Per regel een geval dat
// haar MOET raken en een geval dat haar niet mag raken (anders bewijst de tabel niets).
import { describe, it, expect } from 'vitest';
import { decide } from '../../src/decision/index.js';
import { STEP_UP_RULES } from '../../src/portal/step-up.js';

const SETTINGS = { listeners: [{ host: '127.0.0.2', port: 9000 }], routes: [{ name: 'a', header: 'x-api-key', secret: 's', base: 'https://a.example' }], blocks: [{ id: 'b1' }], quietHours: ['22:00-07:00'], autoLockMs: 900_000, touchAuthenticator: 'external' };
const rule = (method, path, body = {}, extra = {}) => decide({ method, path, body, credentialCount: 1, secret: null, tool: null, settings: null, ...extra }, STEP_UP_RULES);
const settings = body => rule('PUT', '/api/settings', body, { settings: SETTINGS });

describe('step-up: welke handeling een aanraking vraagt', () => {
    it.each([
        [{ listeners: [...SETTINGS.listeners, { host: '127.0.0.3', port: 9000 }] }, 'step-up-listeners'],
        [{ listeners: [] }, 'no-step-up'],
        [{ routes: [...SETTINGS.routes, { name: 'b', header: 'basic', secret: 's', base: 'https://b.example' }] }, 'step-up-routes'],
        [{ routes: [] }, 'no-step-up'],
        [{ blocks: [] }, 'step-up-unblock'],
        [{ blocks: [...SETTINGS.blocks, { id: 'b2' }] }, 'no-step-up'],
        [{ quietHours: [] }, 'step-up-quiet-hours'],
        [{ quietHours: [...SETTINGS.quietHours, '12:00-13:00'] }, 'no-step-up'],
        [{ autoLockMs: 3_600_000 }, 'step-up-auto-lock'],
        [{ autoLockMs: 60_000 }, 'no-step-up'],
        [{ touchAuthenticator: 'any' }, 'step-up-touch-any'],
        [{ touchAuthenticator: 'external' }, 'no-step-up'],
        [{ approvalTimeoutMs: 5000 }, 'no-step-up'],
    ])('instellingen %j: %s', (body, expected) => {
        expect(settings(body).rule).toBe(expected);
    });

    it('terug naar "any" mag met elke niet-geblokkeerde passkey, de rest volgt touchAuthenticator', () => {
        expect(settings({ touchAuthenticator: 'any' }).credentials).toBe('unblocked');
        expect(settings({ autoLockMs: 3_600_000 }).credentials).toBe('touch');
        expect(rule('POST', '/api/webauthn/register/options').credentials).toBe('unlockers');
    });

    it('hosts en clients: alleen erbij vraagt een aanraking, minder niet', () => {
        const secret = { hosts: ['https://a.example'] };
        expect(rule('PUT', '/api/secrets/ab12/hosts', { hosts: ['https://a.example', 'https://b.example'] }, { secret }).rule).toBe('step-up-hosts');
        expect(rule('PUT', '/api/secrets/ab12/hosts', { hosts: [] }, { secret }).rule).toBe('no-step-up');
        const tool = { clients: ['10.0.0.1'] };
        expect(rule('PUT', '/api/tools/ab12/clients', { clients: ['10.0.0.1', '10.0.0.2'] }, { tool }).rule).toBe('step-up-tool-clients');
        expect(rule('PUT', '/api/tools/ab12/clients', { clients: [] }, { tool }).rule).toBe('no-step-up');
    });

    it('gevoelig uitzetten vraagt een aanraking, aanzetten niet', () => {
        expect(rule('PUT', '/api/secrets/ab12/sensitive', { sensitive: false }).rule).toBe('step-up-sensitive-off');
        expect(rule('PUT', '/api/secrets/ab12/sensitive', { sensitive: true }).rule).toBe('no-step-up');
    });

    it.each([
        ['POST', '/api/grants', 'step-up-grant'], ['PUT', '/api/grants/ab12', 'step-up-grant'], ['PUT', '/api/secrets/ab12/inject', 'step-up-inject'],
        ['POST', '/api/secrets/ab12/rotate', 'step-up-secret-rotate'], ['PUT', '/api/secrets/ab12/name', 'step-up-secret-rename'],
        ['POST', '/api/tools', 'step-up-tool-create'], ['POST', '/api/tools/ab12/rotate', 'step-up-tool-rotate'], ['PUT', '/api/tools/ab12/reask', 'step-up-tool-reask'],
        ['POST', '/api/tools/ab12/reactivate', 'step-up-tool-reactivate'], ['POST', '/api/tls/accept', 'step-up-tls-accept'],
        ['POST', '/api/vault/delete', 'step-up-vault-delete'], ['DELETE', '/api/vault', 'step-up-vault-delete'],
        ['DELETE', '/api/blocks/b1', 'step-up-unblock'],
    ])('%s %s: %s', (method, path, expected) => {
        expect(rule(method, path)).toMatchObject({ stepUp: true, rule: expected });
    });

    it.each([
        ['DELETE', '/api/grants/ab12'], ['POST', '/api/tools/ab12/revoke'], ['DELETE', '/api/tools/ab12'], ['DELETE', '/api/secrets/ab12'],
        ['POST', '/api/lock'], ['POST', '/api/blocks'], ['DELETE', '/api/passkeys/abc'], ['POST', '/api/secrets'],
    ])('MOET doorlaten zonder aanraking (minder toelaten): %s %s', (method, path) => {
        expect(rule(method, path)).toMatchObject({ stepUp: false, rule: 'no-step-up' });
    });

    it('zonder enige passkey: alleen de eerste passkey registreren mag zonder aanraking; elke andere gevoelige wijziging vraagt er een (en wordt dus geweigerd)', () => {
        expect(rule('POST', '/api/webauthn/register/options', {}, { credentialCount: 0 })).toMatchObject({ stepUp: false, rule: 'step-up-first-passkey' });
        expect(rule('POST', '/api/grants', {}, { credentialCount: 0 })).toMatchObject({ stepUp: true, rule: 'step-up-grant' });
        expect(rule('POST', '/api/tools', {}, { credentialCount: 0 })).toMatchObject({ stepUp: true, rule: 'step-up-tool-create' });
    });
});
