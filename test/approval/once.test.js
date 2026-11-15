// "eenmalig" laat precies één request door. Gelijktijdige requests voor
// dezelfde tool × secret × host delen de pop-up, niet het antwoord "eenmalig": de andere krijgen daarna elk een eigen vraag.
// "Altijd" (een toekenning) geldt voor allemaal; weigeren en time-out ook.
import { describe, it, expect } from 'vitest';
import { createApproval } from '../../src/approval/index.js';
import { fakeTimers, touchOk } from './fixtures.js';

const question = { toolId: 't1', tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1', method: 'POST', path: '/gists' };
const tick = () => new Promise(r => setImmediate(r));
const untilAsked = async (asked, n) => { for (let i = 0; i < 50 && asked.length < n; i++) await tick(); };

function setup() {
    const clock = fakeTimers();
    const asked = [];
    const notifier = { ask: q => new Promise(resolve => asked.push({ q, resolve })) };
    const approval = createApproval({ notifier, clock, timeoutMs: () => 30_000, createGrant: async () => {}, touch: touchOk });
    return { approval, asked, clock };
}

describe('"eenmalig" is eenmalig', () => {
    it('Given drie gelijktijdige requests When de gebruiker "eenmalig" kiest Then gaat er precies één door en vragen de andere opnieuw', async () => {
        const { approval, asked } = setup();
        const results = [approval.request(question), approval.request({ ...question }), approval.request({ ...question })];
        await tick();
        expect(asked).toHaveLength(1); // één pop-up tegelijk
        asked[0].resolve('once');
        await untilAsked(asked, 2);
        expect(asked).toHaveLength(2); // de volgende request vraagt opnieuw
        // De tweede en derde delen weer één vraag; "weigeren" geldt voor iedereen die wachtte.
        asked[1].resolve('deny');
        const rules = (await Promise.all(results)).map(d => d.rule);
        expect(rules).toEqual(['approved-once', 'approval-denied', 'approval-denied']);
        expect(asked).toHaveLength(2);
    });

    it('"altijd" laat alle wachtende requests door (er is nu een toekenning)', async () => {
        const { approval, asked } = setup();
        const results = [approval.request(question), approval.request({ ...question })];
        await tick();
        asked[0].resolve('always');
        expect((await Promise.all(results)).map(d => d.rule)).toEqual(['approved-always', 'approved-always']);
        expect(asked).toHaveLength(1);
    });

    it('weigeren geldt voor alle wachtende requests (veiligste keuze)', async () => {
        const { approval, asked } = setup();
        const results = [approval.request(question), approval.request({ ...question })];
        await tick();
        asked[0].resolve('deny');
        expect((await Promise.all(results)).map(d => d.rule)).toEqual(['approval-denied', 'approval-denied']);
    });

    it('de vraag toont methode en pad (zonder query-waarden)', async () => {
        const { approval, asked } = setup();
        const r = approval.request(question);
        await tick();
        expect(asked[0].q).toMatchObject({ method: 'POST', path: '/gists' });
        asked[0].resolve('once');
        await r;
    });
});
