// Scrubben van antwoorden, ook over chunk-grenzen. Elke waarde die in deze request ingevuld werd (en haar gangbare
// coderingen) wordt `***`; de rest van het antwoord blijft byte-gelijk; streaming wordt niet onnodig vastgehouden.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createScrubber, encodedForms, REDACTED } from '../../src/scrub/index.js';

// Waarden en opvulling uit verschillende alfabetten: zo kan een waarde niet toevallig uit opvulling ontstaan, en is de
// verwachte uitvoer eenvoudig met split/join te berekenen (onafhankelijk van de implementatie).
const secretValue = fc.stringMatching(/^[A-Za-z0-9_\-+/=]{6,40}$/).map(s => `Sk${s}`);
const filler = fc.stringMatching(/^[ .,:;!?\n{}"[\]#@~]{0,30}$/);

function chunked(buffer, cuts) {
    const points = [...new Set(cuts.map(c => c % (buffer.length + 1)))].sort((a, b) => a - b);
    const out = [];
    let last = 0;
    for (const p of points) { out.push(buffer.subarray(last, p)); last = p; }
    out.push(buffer.subarray(last));
    return out;
}

function runStream(scrubber, chunks) {
    const out = [];
    for (const c of chunks) out.push(scrubber.push(c));
    out.push(scrubber.end());
    return Buffer.concat(out);
}

describe('scrubben', () => {
    it('Given willekeurige waarden en willekeurige splitsingen in chunks When gescrubd Then komt geen waarde (of codering) meer voor en blijft de rest byte-gelijk', () => {
        fc.assert(fc.property(
            fc.uniqueArray(secretValue, { minLength: 1, maxLength: 3 }),
            fc.array(fc.tuple(filler, fc.nat(9)), { minLength: 1, maxLength: 8 }),
            fc.array(fc.nat(500), { maxLength: 12 }),
            (values, parts, cuts) => {
                const forms = values.flatMap(v => encodedForms(v));
                const pieces = parts.map(([text, pick]) => text + (pick < forms.length ? forms[pick] : ''));
                const input = Buffer.from(pieces.join(''), 'utf8');
                const scrubbed = runStream(createScrubber(values), chunked(input, cuts)).toString('utf8');
                for (const form of forms) expect(scrubbed).not.toContain(form);
                let expected = pieces.join('');
                for (const form of [...forms].sort((a, b) => b.length - a.length)) expected = expected.split(form).join(REDACTED);
                expect(scrubbed).toBe(expected);
            },
        ), { numRuns: 300 });
    });

    it('Given een dienst die de sleutel over twee stream-chunks gesplitst terugecho\'t When gescrubd Then ziet de tool ***', () => {
        const value = 'sk-ant-api03-ABCDEFGHIJKLMNOP';
        const s = createScrubber([value]);
        const out = Buffer.concat([s.push(Buffer.from('data: {"error":"invalid key sk-ant-api')), s.push(Buffer.from('03-ABCDEFGHIJKLMNOP"}\n\n')), s.end()]).toString();
        expect(out).toBe('data: {"error":"invalid key ***"}\n\n');
    });

    it('houdt niets vast als het einde van een chunk geen begin van een waarde kan zijn (streaming blijft vlot)', () => {
        const s = createScrubber(['sk-geheim-123456']);
        expect(s.push(Buffer.from('data: hallo\n\n')).toString()).toBe('data: hallo\n\n');
        expect(s.push(Buffer.from('data: sk-ge')).toString()).toBe('data: '); // "sk-ge" kan het begin zijn
        expect(s.push(Buffer.from('neraal\n\n')).toString()).toBe('sk-generaal\n\n');
        expect(s.end().toString()).toBe('');
    });

    it('ook gangbare coderingen: base64, base64url, URL-encoded en JSON-escaped', () => {
        const value = 'a/b+c=d"e\\f?g&h';
        const forms = encodedForms(value);
        expect(forms).toEqual(expect.arrayContaining([value, Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url'), encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]));
        expect(createScrubber([value]).text(`x ${forms.join(' ')} y`)).toBe(`x ${forms.map(() => REDACTED).join(' ')} y`);
    });

    it('een waarde met niet-ASCII-tekens wordt op bytes gescrubd, ook als een chunk midden in een UTF-8-teken splitst', () => {
        const value = 'pässwörd-€-geheim';
        const bytes = Buffer.from(`voor ${value} na`);
        const s = createScrubber([value]);
        const out = Buffer.concat([...Array.from(bytes).map(b => s.push(Buffer.from([b]))), s.end()]).toString('utf8');
        expect(out).toBe('voor *** na');
    });

    it('zonder waarden is de scrubber een doorgeefluik', () => {
        const s = createScrubber([]);
        expect(s.push(Buffer.from('abc')).toString()).toBe('abc');
        expect(s.end().length).toBe(0);
        expect(s.text('abc')).toBe('abc');
    });

    it('MOET weigeren: een lege waarde (zou alles vervangen)', () => {
        expect(() => createScrubber([''])).toThrow(/empty/);
    });
});

describe('scrubben: coderingen binnen een groter blok (review 2026-10-09, bevinding 1)', () => {
    it('Given een waarde met een willekeurig voorvoegsel (elke base64-uitlijning) When base64-gecodeerd teruggegeven Then wordt het deel met de waarde gescrubd', () => {
        fc.assert(fc.property(secretValue, fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), fc.array(fc.nat(400), { maxLength: 6 }), (value, before, after, cuts) => {
            const blob = Buffer.from(`${before}${value}${after}`).toString('base64');
            const out = runStream(createScrubber([value]), chunked(Buffer.from(`echo: ${blob} einde`), cuts)).toString();
            // Na scrubben mag de base64 niet meer tot iets met de waarde decoderen.
            const decoded = Buffer.from(out.slice('echo: '.length).replace(/ einde$/, '').replace(/\*/g, 'A'), 'base64').toString('latin1');
            expect(decoded).not.toContain(value);
            expect(out).toContain('***');
        }), { numRuns: 300 });
    });

    it('Basic-auth (user:secret) en "Bearer <secret>" in base64, zoals een echo-endpoint ze teruggeeft', () => {
        const value = 'sk-test-ABCDEFGHIJKLMNOP1234';
        for (const wrapped of [`a:${value}`, `user:${value}`, `Bearer ${value}`]) {
            const out = createScrubber([value]).text(`Authorization: Basic ${Buffer.from(wrapped).toString('base64')}`);
            expect(Buffer.from(out.split(' ').at(-1).replace(/\*/g, 'A'), 'base64').toString('latin1'), wrapped).not.toContain(value);
        }
    });

    it('hex, in kleine en hoofdletters', () => {
        const value = 'sk-test-ABCDEFGHIJKLMNOP1234';
        const hex = Buffer.from(value).toString('hex');
        expect(createScrubber([value]).text(`x ${hex} ${hex.toUpperCase()} y`)).toBe('x *** *** y');
    });

    it('telt hoeveel keer een waarde vervangen werd (in stukken en in een tekst), nooit welke', () => {
        const scrubber = createScrubber(['FAKE-tel-123']);
        scrubber.push(Buffer.from('a FAKE-tel'));
        scrubber.push(Buffer.from('-123 b FAKE-tel-123'));
        scrubber.end();
        expect(scrubber.replaced()).toBe(2);
        scrubber.text('x FAKE-tel-123');
        expect(scrubber.replaced()).toBe(3);
        expect(createScrubber([]).replaced()).toBe(0);
    });
});
