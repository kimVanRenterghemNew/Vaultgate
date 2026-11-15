// Integriteit van de eigen code: bij de start leest Vaultgate zijn geïnstalleerde bestanden één keer (hash per bestand,
// BLAKE2b via libsodium, en de bytes zelf). De kluis vergelijkt die hashes bij ontgrendelen met de lijst die ze de vorige
// keer vastlegde (zie src/vault/code-check.js). Wat later van schijf gelezen wordt en ertoe doet (het tray-script en zijn
// C#), komt uit deze snapshot en niet opnieuw van schijf: wat gecontroleerd is, is wat draait.
//
// Grens: dit vangt een aanpassing van één bestand (bv. het tray-script dat altijd "toestaan" antwoordt), niet een aanvaller
// die als dezelfde gebruiker ook deze controle zelf wegpatcht. Dat vraagt een map waarin de gebruiker niet schrijft en
// een ondertekende release (docs/code-integriteit-en-distributie.md). node_modules valt erbuiten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** De map van de installatie (waar package.json staat). */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Wat tot de code hoort, relatief aan de installatie: alles wat het proces laadt, uitvoert of aan het portaal geeft. */
export const CODE_PATHS = Object.freeze(['package.json', 'i18n', 'src', 'web']);

const notInSnapshot = file => Object.assign(new Error(`${file} is not part of the installed code`), { code: 'NOT_IN_SNAPSHOT' });

/** Alle gewone bestanden onder `rel` (posix-paden). Een symlink of ander soort item telt niet mee en valt dus op als weg. */
function filesUnder(root, rel) {
    const full = path.join(root, rel);
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (!stat) return [];
    if (stat.isFile()) return [rel];
    if (!stat.isDirectory()) return [];
    return fs.readdirSync(full).sort().flatMap(name => filesUnder(root, path.posix.join(rel, name)));
}

/**
 * Leest de code één keer.
 * @param {{ root?: string, crypto: { keyedHash(key: undefined, data: Buffer): string }, paths?: readonly string[] }} options
 * @returns {{ hashes: Readonly<Record<string, string>>, read(file: string): Buffer }}
 */
export function snapshotCode({ root = INSTALL_ROOT, crypto, paths = CODE_PATHS }) {
    const bytes = new Map(paths.flatMap(rel => filesUnder(root, rel)).map(file => [file, fs.readFileSync(path.join(root, file))]));
    const hashes = Object.freeze(Object.fromEntries([...bytes].map(([file, data]) => [file, crypto.keyedHash(undefined, data)])));
    return Object.freeze({
        hashes,
        /** De bytes zoals bij de start gelezen (een kopie). */
        read(file) {
            if (!bytes.has(file)) throw notInSnapshot(file);
            return Buffer.from(bytes.get(file));
        },
    });
}

/** De bestanden die verschillen tussen twee lijsten (gewijzigd, toegevoegd of weg), gesorteerd. */
export function changedFiles(recorded, current) {
    const all = new Set([...Object.keys(recorded), ...Object.keys(current)]);
    const own = (list, file) => (Object.hasOwn(list, file) ? list[file] : undefined);
    return [...all].filter(file => own(recorded, file) !== own(current, file)).sort();
}
