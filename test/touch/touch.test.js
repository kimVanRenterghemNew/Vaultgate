// Een aanraking die een programma niet kan geven. De module houdt een wachtende bevestiging bij (id, vraag,
// time-out) en opent het portaalvenster; het portaal meldt na een geldige WebAuthn-assertie `complete(id, 'ok')`.
import { describe, it, expect } from 'vitest';
import { createTouch, touchCredentials } from '../../src/touch/index.js';
import { fakeTimers } from '../approval/fixtures.js';

const question = { tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', method: 'GET', path: '/user', reason: 'always' };

function setup({ available = true, open } = {}) {
    const clock = fakeTimers();
    const opened = [];
    let n = 0;
    const touch = createTouch({ clock, timeoutMs: 120_000, newId: () => `t${n++}`, available: () => available, open: open ?? (id => opened.push(id)) });
    return { clock, opened, touch };
}

describe('aanraking', () => {
    it('Given een vraag When het portaal een geldige aanraking meldt Then ok, en het venster ging open voor dat id', async () => {
        const { touch, opened } = setup();
        const result = touch.confirm(question);
        expect(opened).toEqual(['t0']);
        expect(touch.view('t0')).toMatchObject({ tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', reason: 'always' });
        expect(touch.complete('t0', 'ok')).toBe(true);
        expect(await result).toBe('ok');
        expect(touch.view('t0')).toBeNull(); // eenmalig
    });

    it('weigeren in het venster geeft denied', async () => {
        const { touch } = setup();
        const result = touch.confirm(question);
        touch.complete('t0', 'denied');
        expect(await result).toBe('denied');
    });

    it('geen antwoord binnen de time-out (nepklok) geeft timeout; een late aanraking verandert niets', async () => {
        const { touch, clock } = setup();
        const result = touch.confirm(question);
        await clock.advance(120_000);
        expect(await result).toBe('timeout');
        expect(touch.complete('t0', 'ok')).toBe(false);
    });

    it('MOET weigeren: geen passkey geregistreerd, of het venster kan niet open: unavailable, zonder wachtende vraag', async () => {
        expect(await setup({ available: false }).touch.confirm(question)).toBe('unavailable');
        const broken = setup({ open: () => { throw new Error('geen browser'); } });
        expect(await broken.touch.confirm(question)).toBe('unavailable');
        expect(broken.touch.view('t0')).toBeNull();
    });

    it('MOET weigeren: een onbekend id of een ongeldige uitkomst', () => {
        const { touch } = setup();
        touch.confirm(question);
        expect(touch.complete('bestaat-niet', 'ok')).toBe(false);
        expect(touch.complete('t0', 'ja hoor')).toBe(false);
        expect(touch.view('t0')).not.toBeNull();
    });
});

describe('aanraking met een eigen opener', () => {
    it('Given confirm met een eigen open When die het id krijgt Then opent het standaardvenster niet', async () => {
        const { touch, opened } = setup();
        const ids = [];
        const result = touch.confirm(question, { open: id => ids.push(id) });
        expect([ids, opened]).toEqual([['t0'], []]);
        touch.complete('t0', 'ok');
        expect(await result).toBe('ok');
    });
});

describe('welke passkeys mogen aanraken', () => {
    const creds = [
        { id: 'hello', transports: ['internal'] },
        { id: 'yubi', transports: ['usb', 'nfc'] },
        { id: 'phone', transports: ['hybrid', 'internal'] },
        { id: 'oud', transports: [] },
    ];
    it('any: alle passkeys; external: alleen usb, nfc, ble of hybrid', () => {
        expect(touchCredentials(creds, 'any').map(c => c.id)).toEqual(['hello', 'yubi', 'phone', 'oud']);
        expect(touchCredentials(creds, 'external').map(c => c.id)).toEqual(['yubi', 'phone']);
    });
    it('MOET weigeren: een onbekende instelling laat niets door', () => {
        expect(touchCredentials(creds, 'iets')).toEqual([]);
    });
});
