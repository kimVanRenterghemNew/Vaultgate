// De terugval van de vertalingen voor CLI en tray (src/locale): een onbekende taal wordt Engels, een ontbrekende sleutel
// toont de sleutel zelf (zichtbaar, zodat een vertaler ze vindt), en een ontbrekende parameter blijft als {naam} staan.
import { describe, it, expect } from 'vitest';
import { t, chooseLanguage, pickPrefix } from '../../src/locale/index.js';

describe('vertalingen: terugval', () => {
    it('Given een onbekende taal When een tekst Then de Engelse', () => {
        expect(t('fr', 'portal.welcome.start')).toBe(t('en', 'portal.welcome.start'));
        expect(pickPrefix('fr', 'portal.welcome.')).toEqual(pickPrefix('en', 'portal.welcome.'));
    });

    it('Given een sleutel die nergens bestaat When een tekst Then de sleutel zelf, niet een lege tekst', () => {
        expect(t('nl', 'portal.does.not.exist')).toBe('portal.does.not.exist');
    });

    it('Given een ontbrekende parameter When een tekst Then blijft {naam} zichtbaar staan', () => {
        expect(t('en', 'portal.welcome.paired')).toContain('{name}');
        expect(t('en', 'portal.welcome.paired', { name: 'claude-code' })).toContain('claude-code');
    });

    it('MOET afwijzen: een lege of onbekende systeemtaal kiest Engels', () => {
        expect(chooseLanguage(['', '   ', 'xx_YY.UTF-8', undefined])).toBe('en');
        expect(chooseLanguage(['nl_BE.UTF-8'])).toBe('nl');
    });
});
