// Vertragen na foute pogingen (vraag van de product owner: "5 foute pogingen in 3 min, dan niet meer antwoorden"). Per sleutel
// (client-adres of tool) een venster van foute pogingen; boven de drempel geblokkeerd, en elke volgende blokkade duurt
// dubbel zo lang (tot een maximum). Een geslaagde call zet de sleutel terug op nul. Klok ingespoten.
import { describe, it, expect } from 'vitest';
import { createThrottle, FAILURE_RULES } from '../../src/throttle/index.js';
import { fakeTimers } from '../approval/fixtures.js';

const setup = () => { const clock = fakeTimers(); return { clock, t: createThrottle({ clock, threshold: 5, windowMs: 180_000, blockMs: 60_000, maxBlockMs: 240_000 }) }; };

describe('vertragen na foute pogingen', () => {
    it('Given 4 foute pogingen in 3 min When de 5de Then geblokkeerd voor 60 s, en dat meldt fail() één keer', () => {
        const { t } = setup();
        for (let i = 0; i < 4; i++) expect(t.fail('client:1.2.3.4')).toEqual({ blockedNow: false });
        expect(t.check('client:1.2.3.4')).toEqual({ blocked: false });
        expect(t.fail('client:1.2.3.4')).toEqual({ blockedNow: true, retryAfterMs: 60_000 });
        expect(t.check('client:1.2.3.4')).toEqual({ blocked: true, retryAfterMs: 60_000 });
        expect(t.fail('client:1.2.3.4')).toEqual({ blockedNow: false }); // tijdens de blokkade: geen nieuwe melding
        expect(t.check('client:5.6.7.8')).toEqual({ blocked: false }); // een andere sleutel
    });

    it('foute pogingen verspreid over meer dan 3 min blokkeren niet', async () => {
        const { t, clock } = setup();
        for (let i = 0; i < 10; i++) { t.fail('k'); await clock.advance(50_000); }
        expect(t.check('k').blocked).toBe(false);
    });

    it('na de blokkade weer open; een tweede blokkade duurt dubbel zo lang, tot het maximum', async () => {
        const { t, clock } = setup();
        const burst = () => { let r; for (let i = 0; i < 5; i++) r = t.fail('k'); return r; };
        expect(burst().retryAfterMs).toBe(60_000);
        await clock.advance(60_000);
        expect(t.check('k').blocked).toBe(false);
        expect(burst().retryAfterMs).toBe(120_000);
        await clock.advance(120_000);
        expect(burst().retryAfterMs).toBe(240_000);
        await clock.advance(240_000);
        expect(burst().retryAfterMs).toBe(240_000);
    });

    it('een geslaagde call zet alles terug op nul', async () => {
        const { t, clock } = setup();
        for (let i = 0; i < 5; i++) t.fail('k');
        await clock.advance(60_000);
        t.succeed('k');
        for (let i = 0; i < 4; i++) t.fail('k');
        expect(t.check('k').blocked).toBe(false);
        expect(t.fail('k').retryAfterMs).toBe(60_000); // weer de eerste stap
    });

    it('MOET begrensd blijven: veel verschillende sleutels houden het geheugen klein', () => {
        const clock = fakeTimers();
        const t = createThrottle({ clock, maxKeys: 100 });
        for (let i = 0; i < 1000; i++) t.fail(`client:${i}`);
        expect(t.size()).toBeLessThanOrEqual(100);
    });

    it('welke regels tellen als fout: raden en aftasten wel, een beslissing van de gebruiker niet', () => {
        expect([...FAILURE_RULES].sort()).toEqual(['bad-target', 'client-not-allowed', 'no-placeholder', 'no-tool-key', 'placeholder-location-not-allowed', 'target-host-not-allowed', 'tool-key-revoked', 'unknown-secret']);
    });
});
