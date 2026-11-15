// Een melding in de tray bij elke beheerwijziging (mode 'admin' in de audit): een zin per regelnaam, de herkomst in de
// titel, nooit een waarde. Stil tijdens sluimeren en rustige uren; gelijke wijzigingen binnen korte tijd worden één
// melding; een key-rotatie hoogstens één ballon per tool per 8 uur (instelbaar), de eerste na koppelen of herstart altijd.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createAdminNotices, ADMIN_NOTICE_RULES, NOTICE_COALESCE_MS } from '../../src/audit/index.js';
import { translator } from '../../src/locale/index.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const en = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', import.meta.url), 'utf8'));
const nl = JSON.parse(fs.readFileSync(new URL('../../i18n/nl.json', import.meta.url), 'utf8'));

function setup({ settings = {}, translate = translator('en') } = {}) {
    let now = Date.parse('2026-10-22T12:00:00Z');
    const timers = [];
    const clock = {
        now: () => now,
        setTimeout: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
        clearTimeout: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
        advance: ms => { now += ms; for (const t of timers.filter(x => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); } },
    };
    const shown = [];
    const notices = createAdminNotices({ notify: n => shown.push(n), translate, clock, policyState: () => settings });
    return { notices, shown, clock };
}

const admin = (rule, fields = {}) => ({ mode: 'admin', origin: 'portal', allow: true, rule, ...fields });

describe('meldingen bij elke beheerwijziging', () => {
    it('Given een nieuwe toekenning via het portaal Then een melding met een zin, de namen en de herkomst, zonder waarde of detail', () => {
        const s = setup();
        s.notices.notice(admin('grant-added', { tool: 'agent', secret: 'github_token', host: 'https://api.github.com', detail: 'mode: – → silent' }));
        expect(s.shown).toEqual([{ title: 'Vaultgate: changed in the portal', text: 'New grant: agent may use github_token on https://api.github.com.' }]);
    });

    it('elke regel die de audit als beheer schrijft, heeft een zin in en en nl; een onbekende regel meldt toch', () => {
        const missing = lang => ADMIN_NOTICE_RULES.filter(rule => typeof lang.tray.notify.admin.rules[rule] !== 'string');
        expect(missing(en)).toEqual([]);
        expect(missing(nl)).toEqual([]);
        const s = setup();
        s.notices.notice(admin('iets-nieuws'));
        expect(s.shown[0].text).toContain('iets-nieuws');
    });

    it('de titel zegt waar de wijziging vandaan kwam: portaal, tray, gekoppelde tool, proxy', () => {
        const s = setup();
        for (const origin of ['portal', 'tray', 'device', 'proxy']) s.notices.notice(admin('settings-changed', { origin, tool: origin }));
        expect(s.shown.map(n => n.title)).toEqual(['Vaultgate: changed in the portal', 'Vaultgate: changed from the tray', 'Vaultgate: changed by a paired tool', 'Vaultgate: learned by the proxy']);
    });

    it('samenvoegen: drie gelijke wijzigingen binnen een minuut zijn één melding plus één samenvatting', () => {
        const s = setup();
        for (let i = 0; i < 3; i++) s.notices.notice(admin('grant-changed', { tool: 'agent', secret: 's', host: 'https://h' }));
        expect(s.shown).toHaveLength(1);
        s.clock.advance(NOTICE_COALESCE_MS);
        expect(s.shown).toHaveLength(2);
        expect(s.shown[1].text).toMatch(/^2 more changes like this: Grant changed/);
        s.notices.notice(admin('grant-changed', { tool: 'agent', secret: 's', host: 'https://h' }));
        expect(s.shown).toHaveLength(3); // na het venster: weer meteen
    });

    it('Given meldingen stilgezet of rustige uren When een wijziging Then geen ballon', () => {
        const snoozed = setup({ settings: { notificationSnooze: { globalUntil: Date.parse('2026-10-23T00:00:00Z'), grants: [] } } });
        snoozed.notices.notice(admin('tool-added', { tool: 'x' }));
        snoozed.clock.advance(NOTICE_COALESCE_MS);
        expect(snoozed.shown).toEqual([]);
        const quiet = setup({ settings: { quietHours: ['00:00-23:59'] } });
        quiet.notices.notice(admin('tool-added', { tool: 'x' }));
        expect(quiet.shown).toEqual([]);
    });

    it('Given tien rotaties van dezelfde tool binnen 8 uur Then één ballon; na 8 uur, na opnieuw koppelen (generatie 1) of een andere tool weer één', () => {
        const s = setup();
        const rotated = (tool, generation) => s.notices.notice(admin('key-rotated', { origin: 'device', tool, detail: `generation ${generation}` }));
        for (let g = 5; g < 15; g++) { rotated('agent', g); s.clock.advance(60_000); }
        expect(s.shown).toHaveLength(1);
        expect(s.shown[0]).toEqual({ title: 'Vaultgate: changed by a paired tool', text: 'agent got a new key automatically. You do not need to do anything.' });
        rotated('agent', 1);
        rotated('other', 7);
        expect(s.shown).toHaveLength(3);
        s.clock.advance(8 * 3_600_000);
        rotated('agent', 2);
        expect(s.shown).toHaveLength(4);
    });

    it('de 8 uur is instelbaar (rotationNoticeMs)', () => {
        const s = setup({ settings: { rotationNoticeMs: 60_000 } });
        s.notices.notice(admin('key-rotated', { origin: 'device', tool: 'a', detail: 'generation 3' }));
        s.clock.advance(60_000);
        s.notices.notice(admin('key-rotated', { origin: 'device', tool: 'a', detail: 'generation 4' }));
        expect(s.shown).toHaveLength(2);
    });

    it('Nederlands', () => {
        const s = setup({ translate: translator('nl') });
        s.notices.notice(admin('tool-revoked', { tool: 'agent' }));
        expect(s.shown[0].title).toBe('Vaultgate: gewijzigd in het portaal');
        expect(s.shown[0].text).toContain('agent');
    });

    it('MOET weigeren: alle meldingen doorzocht op nep-secrets en keys; een geplante waarde laat de controle falen', () => {
        const value = fakeSecret('notice');
        const key = 'ks_00112233445566778899aabbccddeeff_nooitzichtbaarnooitzichtbaar';
        const s = setup();
        for (const rule of ADMIN_NOTICE_RULES) s.notices.notice(admin(rule, { tool: 'agent', secret: 'demo', host: 'https://h', detail: `${value} ${key}`, value, key }));
        expect(findLeaks({ notices: JSON.stringify(s.shown) }, [value, key])).toEqual([]);
        expect(findLeaks({ notices: JSON.stringify([...s.shown, { text: value }]) }, [value, key])).not.toEqual([]);
    });
});
