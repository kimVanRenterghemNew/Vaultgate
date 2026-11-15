// Goedkeuring van een nieuwe combinatie tool × secret × host. "eenmalig" laat alleen deze call door,
// "altijd" maakt een toekenning, "weigeren" geeft 403 approval-denied, geen antwoord binnen de time-out geeft 401
// approval-timeout, geen tray geeft 503 approval-unavailable. Klok en notifier zijn ingespoten.
import { describe, it, expect } from 'vitest';
import { createApproval, APPROVAL_RULES } from '../../src/approval/index.js';
import { fakeTimers, scriptedNotifier, touchOk } from './fixtures.js';

const question = { toolId: 't1', tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1' };

function setup(answer, { timeoutMs = 30_000 } = {}) {
    const clock = fakeTimers();
    const notifier = scriptedNotifier(answer);
    const grants = [];
    const approval = createApproval({ notifier, clock, timeoutMs: () => timeoutMs, createGrant: async g => { grants.push(g); }, touch: touchOk });
    return { clock, notifier, grants, approval };
}

describe('goedkeuring', () => {
    it.each([
        ['once', { allow: true, rule: 'approved-once' }, 0],
        ['always', { allow: true, rule: 'approved-always' }, 1],
        ['deny', { allow: false, status: 403, rule: 'approval-denied' }, 0],
        ['unavailable', { allow: false, status: 503, rule: 'approval-unavailable' }, 0],
        ['iets-anders', { allow: false, status: 503, rule: 'approval-invalid-answer' }, 0],
    ])('antwoord %s geeft %o', async (answer, expected, grantCount) => {
        const { approval, grants, notifier } = setup(answer);
        expect(await approval.request(question)).toMatchObject(expected);
        expect(grants).toHaveLength(grantCount);
        // 4.29: "altijd" in de tray is uitdrukkelijk zonder einde, ook als de key een standaardlooptijd heeft
        if (grantCount) expect(grants[0]).toEqual({ toolId: 't1', secretName: 'github_token', host: 'https://api.github.com', origin: 'tray', expiresAt: null });
        expect(notifier.questions[0]).toMatchObject({ tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1', timeoutMs: 30_000 });
        expect(JSON.stringify(notifier.questions[0])).not.toMatch(/value/i);
    });

    it('MOET weigeren: "altijd" voor een handmatige key (roteert niet) wordt hoogstens 4 uur; de tray krijgt manualKey mee', async () => {
        const { approval, grants, notifier, clock } = setup('always');
        expect(await approval.request({ ...question, manualKey: true })).toMatchObject({ allow: true, rule: 'approved-4h', detail: 'manual-key' });
        expect(grants).toEqual([{ toolId: 't1', secretName: 'github_token', host: 'https://api.github.com', origin: 'tray', expiresAt: clock.now() + 4 * 3_600_000 }]);
        expect(notifier.questions[0]).toMatchObject({ manualKey: true });
    });

    it('Given een notifier die niet antwoordt When een call Then na 30 s (nepklok) 401 approval-timeout, en een laat antwoord verandert niets', async () => {
        const { approval, clock, notifier, grants } = setup('never');
        let decision = null;
        const pending = approval.request(question).then(d => { decision = d; });
        await clock.advance(29_999);
        expect(decision).toBeNull();
        expect(approval.pending()).toMatchObject([{ tool: 'mytool', secret: 'github_token' }]);
        await clock.advance(2_001); // de tray beslist op 30 s; de server sluit af na een korte marge
        await pending;
        expect(decision).toMatchObject({ allow: false, status: 401, rule: 'approval-timeout' });
        notifier.answerOpen('always');
        await new Promise(r => setImmediate(r));
        expect(grants).toEqual([]);
        expect(approval.pending()).toEqual([]);
    });

    it('de time-out is instelbaar', async () => {
        const { approval, notifier } = setup('once', { timeoutMs: 10_000 });
        await approval.request(question);
        expect(notifier.questions[0].timeoutMs).toBe(10_000);
    });

    it('twee gelijktijdige calls met dezelfde combinatie geven één vraag (geen stapel pop-ups)', async () => {
        const { approval, notifier } = setup('never');
        const a = approval.request(question);
        const b = approval.request({ ...question });
        const c = approval.request({ ...question, host: 'https://uploads.github.com' });
        await new Promise(r => setImmediate(r)); // de vraag vertrekt asynchroon
        expect(notifier.questions).toHaveLength(2);
        notifier.answerOpen('once');
        // "eenmalig" geldt voor één request; b vraagt daarna zelf opnieuw (vroeger kreeg b het
        // antwoord van a mee: één klik gaf dan meerdere requests vrij).
        for (let i = 0; i < 20 && notifier.questions.length < 3; i++) await new Promise(r => setImmediate(r));
        expect(notifier.questions).toHaveLength(3);
        notifier.answerOpen('once');
        expect((await Promise.all([a, b, c])).map(d => d.rule)).toEqual(['approved-once', 'approved-once', 'approved-once']);
    });

    it('een notifier die faalt, geeft approval-unavailable (standaard dicht)', async () => {
        const clock = fakeTimers();
        const approval = createApproval({ notifier: { ask: async () => { throw new Error('pipe weg'); } }, clock, timeoutMs: () => 30_000, createGrant: async () => {} });
        expect(await approval.request(question)).toMatchObject({ allow: false, rule: 'approval-unavailable' });
    });

    it('een mislukte toekenning na "altijd" laat de call door als eenmalig en meldt het (geen stille toekenning)', async () => {
        const clock = fakeTimers();
        const approval = createApproval({ notifier: scriptedNotifier('always'), clock, timeoutMs: () => 30_000, createGrant: async () => { throw new Error('schijf vol'); }, touch: touchOk });
        expect(await approval.request(question)).toMatchObject({ allow: true, rule: 'approved-once', detail: 'grant-failed' });
    });

    it('de tabel eindigt met een expliciete standaard die weigert', () => {
        expect(APPROVAL_RULES.at(-1)).toMatchObject({ name: 'approval-invalid-answer', then: { allow: false } });
    });

    it('Given een vraag met shape When always Then createGrant krijgt authShape mee', async () => {
        const { approval, grants } = setup('always');
        await approval.request({ ...question, shape: 'header:authorization:bearer' });
        expect(grants[0]).toMatchObject({ authShape: 'header:authorization:bearer' });
    });
});
