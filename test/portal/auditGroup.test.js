// Herhaalde beslissingen worden één rij met een aantal; een andere beslissing ertussen breekt de groep.
import { describe, it, expect } from 'vitest';
import { groupEntries } from '../../web/portal/components/audit-group.js';

const e = (t, over = {}) => ({ t, tool: 'mytool', secret: 'demo', host: 'https://api.github.com', rule: 'granted', allow: true, ...over });

describe('groupEntries', () => {
    it('Given 100 gelijke beslissingen en twee andere When gegroepeerd Then drie rijen, de grote met 100 en de oudste tijd', () => {
        const entries = [e(200, { rule: 'target-host-not-allowed', allow: false, host: 'https://evil.example' }), ...Array.from({ length: 100 }, (_, i) => e(199 - i)), e(10, { tool: 'andere' })];
        const groups = groupEntries(entries);
        expect(groups.map(g => g.count)).toEqual([1, 100, 1]);
        expect(groups[1]).toMatchObject({ count: 100, since: 100, entry: { t: 199 } });
    });

    it('MOET apart houden: zelfde regel maar ander secret, of dezelfde beslissing met iets anders ertussen', () => {
        expect(groupEntries([e(3), e(2, { secret: 'ander' }), e(1)]).map(g => g.count)).toEqual([1, 1, 1]);
        expect(groupEntries([e(2), e(1, { allow: false })]).map(g => g.count)).toEqual([1, 1]);
        expect(groupEntries([])).toEqual([]);
    });

    it('MOET apart houden: beheer, ook twee gelijke wijzigingen na elkaar (elk haar eigen oud → nieuw)', () => {
        const change = (t, detail) => e(t, { mode: 'admin', rule: 'grant-changed', detail });
        expect(groupEntries([change(3, 'mode: silent → notify'), change(2, 'mode: confirm → silent')]).map(g => g.count)).toEqual([1, 1]);
    });

    it('een regel die de proxy al samenvatte (count) telt mee met haar aantal', () => {
        expect(groupEntries([e(3, { count: 4 }), e(2)]).map(g => g.count)).toEqual([5]);
    });
});
