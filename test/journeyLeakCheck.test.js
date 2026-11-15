// Elke journey die een nep-secret of een tool-key gebruikt, eindigt met findLeaks over de uitvoer van het echte proces:
// de regel "een secret-waarde verlaat de kluis alleen naar de uitgaande request" hangt dan niet af van wie de test schreef.
// Een journey zonder secret of key (taal, kopbalk) hoeft het niet.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST = path.dirname(fileURLToPath(import.meta.url));
const journeys = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? journeys(full) : e.name.endsWith('.journey.test.js') ? [full] : [];
});

/** Gebruikt de journey een secret of een tool-key? */
const handlesSecrets = text => /\bfakeSecret\(|x-vault-gate-tool-key|['"`]\/api\/tools['"`]/.test(text);

/** Journeys met een secret of key maar zonder findLeaks, relatief aan test/. */
const missing = files => files.filter(f => {
    const text = fs.readFileSync(f, 'utf8');
    return handlesSecrets(text) && !/\bfindLeaks\(/.test(text);
}).map(f => path.relative(TEST, f).replaceAll('\\', '/'));

describe('lekcontrole in elke journey', () => {
    it('elke journey met een nep-secret of tool-key gebruikt findLeaks', () => {
        expect(missing(journeys(TEST))).toEqual([]);
    });

    it('MOET weigeren: een journey met fakeSecret zonder findLeaks; een journey zonder secret mag', () => {
        const dir = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'leak-'));
        const bad = path.join(dir, 'bad.journey.test.js');
        const fine = path.join(dir, 'taal.journey.test.js');
        fs.writeFileSync(bad, "const value = fakeSecret('x'); it('call', () => {});");
        fs.writeFileSync(fine, "it('de taal wisselt', () => {});");
        expect(missing([bad, fine]).map(f => path.basename(f))).toEqual(['bad.journey.test.js']);
    });
});
