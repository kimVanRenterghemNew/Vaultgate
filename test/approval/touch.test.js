// "altijd", en elke goedkeuring van een gevoelig secret, vraagt na de tray ook een aanraking van
// de passkey. Een programma kan de knop in de pop-up indrukken, niet de passkey aanraken.
import { describe, it, expect } from 'vitest';
import { createApproval } from '../../src/approval/index.js';
import { fakeTimers, scriptedNotifier } from './fixtures.js';

const question = { toolId: 't1', tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1', method: 'GET', path: '/user' };

function setup(answer, touchResult) {
    const clock = fakeTimers();
    const notifier = scriptedNotifier(answer);
    const grants = [];
    const touched = [];
    const touch = { confirm: async q => { touched.push(q); return touchResult; } };
    const approval = createApproval({ notifier, clock, timeoutMs: () => 30_000, createGrant: async g => { grants.push(g); }, touch });
    return { approval, grants, touched };
}

describe('aanraking bij goedkeuren', () => {
    it.each([
        // antwoord tray, gevoelig, aanraking -> regel, toegestaan, toekenning
        ['always', false, 'ok', 'approved-always', true, 1],
        ['always', false, 'denied', 'touch-denied', false, 0],
        ['always', false, 'timeout', 'touch-timeout', false, 0],
        ['always', false, 'unavailable', 'approved-once', true, 0], // zonder passkey: hoogstens eenmalig
        ['once', true, 'ok', 'approved-once', true, 0],
        ['once', true, 'denied', 'touch-denied', false, 0],
        ['once', true, 'unavailable', 'touch-unavailable', false, 0], // gevoelig zonder passkey: nooit
        ['always', true, 'unavailable', 'touch-unavailable', false, 0],
        ['30m', false, 'unavailable', 'approved-once', true, 0], // 3.4: zonder passkey ook hoogstens eenmalig
    ])('tray %s, gevoelig %s, aanraking %s -> %s', async (answer, sensitive, touchResult, rule, allow, grantCount) => {
        const { approval, grants, touched } = setup(answer, touchResult);
        expect(await approval.request({ ...question, sensitive })).toMatchObject({ rule, allow });
        expect(grants).toHaveLength(grantCount);
        expect(touched[0]).toMatchObject({ tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', method: 'GET', path: '/user', reason: ['always', '30m', '1h'].includes(answer) ? 'always' : 'sensitive' });
    });

    it('eenmalig voor een gewoon secret, en weigeren, vragen geen aanraking', async () => {
        for (const answer of ['once', 'deny']) {
            const { approval, touched } = setup(answer, 'ok');
            await approval.request({ ...question, sensitive: false });
            expect(touched).toEqual([]);
        }
    });

    it('MOET weigeren: zonder aanraakmodule is "altijd" hoogstens eenmalig en een gevoelig secret geweigerd', async () => {
        const make = answer => createApproval({ notifier: scriptedNotifier(answer), clock: fakeTimers(), timeoutMs: () => 30_000, createGrant: async () => { throw new Error('geen toekenning verwacht'); } });
        expect(await make('always').request(question)).toMatchObject({ rule: 'approved-once', allow: true });
        expect(await make('once').request({ ...question, sensitive: true })).toMatchObject({ rule: 'touch-unavailable', allow: false });
    });
});

describe('goedkeuren met een looptijd', () => {
    it.each([['30m', 30 * 60_000, 'approved-30m'], ['1h', 60 * 60_000, 'approved-1h'], ['4h', 4 * 60 * 60_000, 'approved-4h']])('tray %s: een toekenning met einde, pas na een aanraking', async (answer, ms, rule) => {
        const clock = fakeTimers();
        const grants = [];
        const touched = [];
        const approval = createApproval({ notifier: scriptedNotifier(answer), clock, timeoutMs: () => 30_000, createGrant: async g => { grants.push(g); }, touch: { confirm: async q => { touched.push(q); return 'ok'; } } });
        expect(await approval.request(question)).toMatchObject({ allow: true, rule });
        expect(grants).toEqual([expect.objectContaining({ expiresAt: clock.now() + ms, origin: 'tray' })]);
        expect(touched[0]).toMatchObject({ reason: 'always' });
    });

    it('MOET weigeren: een looptijd zonder aanraking (zoals een programma dat "30 min" klikt) geeft geen toekenning', async () => {
        const grants = [];
        const approval = createApproval({ notifier: scriptedNotifier('30m'), clock: fakeTimers(), timeoutMs: () => 30_000, createGrant: async g => { grants.push(g); }, touch: { confirm: async () => 'denied' } });
        expect(await approval.request(question)).toMatchObject({ allow: false, rule: 'touch-denied' });
        expect(grants).toEqual([]);
    });
});
