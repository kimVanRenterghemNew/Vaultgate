// Scrubben: elke waarde die de proxy in deze request invulde, en haar gangbare coderingen, wordt `***` in het
// antwoord (headers en body), ook als een dienst ze over twee chunks gesplitst terugecho't. Werkt op bytes (latin1 als
// 1-op-1-voorstelling), zodat de rest van het antwoord byte-gelijk blijft, ook bij UTF-8 dat over een chunk-grens valt.
// Niet configureerbaar en geen poort (docs/architecture.md §4).
//
// Vasthouden: na elke chunk blijft alleen het langste staartje over dat het begin van een patroon kan zijn (hoogstens
// lengte - 1), plus een match die over dat knippunt loopt. Eindigt een chunk niet op zo'n begin, dan gaat alles meteen
// door: streaming wordt niet vertraagd. Het resultaat is gelijk aan scrubben van het hele antwoord in één keer.

export const REDACTED = '***';

/**
 * Het stabiele midden van base64(x + waarde) voor elke uitlijning (x = 0, 1 of 2 onbekende bytes ervoor), de standaardtechniek
 * van secret-scanners: de eerste 0/2/3 tekens hangen af van de bytes ervoor, de onvolledige laatste groep van de bytes erna.
 * Zo wordt ook `Basic base64(user:secret)` of `base64(Bearer secret)` gevonden (review 2026-10-09, bevinding 1).
 */
function base64Alignments(bytes) {
    const out = [];
    for (const [k, skip] of [[0, 0], [1, 2], [2, 3]]) {
        const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
        const middle = encoded.slice(skip, Math.floor((k + bytes.length) / 3) * 4);
        if (middle.length >= 8) out.push(middle, middle.replace(/\+/g, '-').replace(/\//g, '_'));
    }
    return out;
}

/** De vormen waarin een waarde in een antwoord kan opduiken: letterlijk, base64 (elke uitlijning), base64url, hex, URL, JSON. */
export function encodedForms(value) {
    const bytes = Buffer.from(value, 'utf8');
    return [...new Set([
        value,
        bytes.toString('base64'),
        bytes.toString('base64').replace(/=+$/, ''),
        bytes.toString('base64url'),
        ...base64Alignments(bytes),
        bytes.toString('hex'),
        bytes.toString('hex').toUpperCase(),
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
    ])].filter(form => form.length > 0);
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latin1 = text => Buffer.from(text, 'utf8').toString('latin1');

export function createScrubber(values) {
    if (values.some(v => typeof v !== 'string' || v.length === 0)) throw new Error('cannot scrub an empty value');
    // Patronen als latin1-strings van hun UTF-8-bytes, langste eerst (een langere vorm gaat voor een vorm die erin zit).
    const patterns = [...new Set(values.flatMap(encodedForms).map(latin1))].sort((a, b) => b.length - a.length);
    const regex = patterns.length ? new RegExp(patterns.map(escapeRegex).join('|'), 'g') : null;
    let replaced = 0; // hoeveel keer een waarde vervangen werd (voor de audit; nooit welke)
    const replace = text => (regex ? text.replace(regex, () => { replaced++; return REDACTED; }) : text);
    let held = '';

    /** Lengte van het langste achtervoegsel van `text` dat een echt voorvoegsel van een patroon is. */
    function holdLength(text) {
        let best = 0;
        for (const p of patterns) {
            for (let k = Math.min(p.length - 1, text.length); k > best; k--) {
                if (text.endsWith(p.slice(0, k))) { best = k; break; }
            }
        }
        return best;
    }

    /**
     * Knippunt: alles ervoor kan niet meer veranderen door later binnenkomende bytes. Daarvoor houden we (1) het langste
     * staartje vast dat het begin van een patroon kan zijn (op de ruwe tekst, dus ook een volledige korte vorm die nog tot
     * een langere kan uitgroeien, zoals base64 zonder en met `=`), en (2) elke match die over het knippunt zou lopen.
     */
    function push(chunk) {
        if (!regex) return Buffer.from(chunk);
        const raw = held + Buffer.from(chunk).toString('latin1');
        let cut = raw.length - holdLength(raw);
        let out = '';
        let last = 0;
        regex.lastIndex = 0;
        for (let m = regex.exec(raw); m; m = regex.exec(raw)) {
            const end = m.index + m[0].length;
            if (end > cut) { cut = Math.min(cut, m.index); break; }
            out += raw.slice(last, m.index) + REDACTED;
            replaced++;
            last = end;
        }
        out += raw.slice(last, Math.max(last, cut));
        held = raw.slice(Math.max(last, cut));
        return Buffer.from(out, 'latin1');
    }

    function end() {
        const rest = held;
        held = '';
        return Buffer.from(replace(rest), 'latin1');
    }

    /** Een volledige tekst in één keer (headers, foutmeldingen). */
    const text = input => Buffer.from(replace(latin1(String(input))), 'latin1').toString('utf8');

    return Object.freeze({ push, end, text, replaced: () => replaced });
}
