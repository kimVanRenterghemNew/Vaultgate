// Een virtuele key is een bearer token: elk proces op deze pc dat hem heeft, kan hem via Vaultgate gebruiken. De
// schermen beloven dus niet dat een gelekte key "elders nutteloos" is, maar zeggen wat waar is: alleen op deze pc en
// via Vaultgate.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const I18N = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n');
const catalog = lang => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
const OVERCLAIM = /useless elsewhere|elders waardeloos|elders nutteloos/i;

/** Alle teksten van een catalogus die te veel beloven. */
const overclaims = obj => Object.values(obj).flatMap(v => (typeof v === 'string' ? (OVERCLAIM.test(v) ? [v] : []) : overclaims(v)));

describe('eerlijke claims over een virtuele key', () => {
    it.each([['en', /works only on this PC and through Vaultgate/], ['nl', /werkt alleen op deze pc en via Vaultgate/]])('%s: geen "useless elsewhere", wel "alleen op deze pc en via Vaultgate"', (lang, honest) => {
        expect(overclaims(catalog(lang))).toEqual([]);
        expect(catalog(lang).portal.welcome.how2Text).toMatch(honest);
    });

    it('MOET weigeren: een tekst die belooft dat een gelekte key elders nutteloos is', () => {
        expect(overclaims({ a: { b: 'If it leaks, it is useless elsewhere.' } })).toHaveLength(1);
    });
});
