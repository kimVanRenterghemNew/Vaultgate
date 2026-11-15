/**
 * Ports and composition, enforced from the first line of code:
 *  1. An implementation lives in its own folder under the module that owns the port: `src/<module>/<impl>/index.js`.
 *  2. Only `src/composition.js` chooses implementations: no other file outside `src/<module>/` imports
 *     `src/<module>/<impl>/...`. Other modules receive the port as a parameter.
 *  3. Every module that has implementations has a contract test `test/ports/<module>.contract.test.js` that runs the
 *     same requirements over every implementation (`describe.each`).
 * See docs/architecture.md §4.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses, resolveImport, strip, IMPORT } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSITION = 'src/composition.js';

function walk(dir, out = []) {
    if (!fs.existsSync(path.join(ROOT, dir))) return out;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel, out);
        else if (/\.m?js$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/** `src/store/local/index.js` -> { module: 'store', impl: 'local' }; anything shallower -> null. */
export const implementationOf = (rel) => {
    const parts = rel.split('/');
    return parts[0] === 'src' && parts.length >= 4 ? { module: parts[1], impl: parts[2] } : null;
};

/** Imports of an implementation folder from outside its own module, other than by src/composition.js. */
export function implementationChoosers(files, read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'), resolve = resolveImport) {
    const found = [];
    for (const rel of files) {
        if (rel === COMPOSITION) continue;
        for (const match of strip(read(rel)).matchAll(IMPORT)) {
            const target = resolve(rel, match[1] || match[2] || match[3]);
            const impl = target && implementationOf(target);
            if (!impl) continue;
            if (rel.startsWith(`src/${impl.module}/`)) continue; // the owning module may use its own implementations
            found.push(`${rel} -> ${target}`);
        }
    }
    return found.sort();
}

export function modulesWithImplementations(dirs) {
    return [...new Set(dirs.map(d => d.split('/')).filter(p => p[0] === 'src' && p.length === 3).map(p => p[1]))].sort();
}

const srcFiles = walk('src');
const runtimeFiles = [...srcFiles, ...walk('scripts')];
const srcDirs = [...new Set(srcFiles.map(f => path.posix.dirname(f)))];

describe('ports and composition (docs/architecture.md §4)', () => {
    it(`only ${COMPOSITION} chooses an implementation of another module's port`, () => {
        expect(implementationChoosers(runtimeFiles)).toEqual([]);
    });

    it('every module with implementations has a port contract test', () => {
        const missing = modulesWithImplementations(srcDirs).filter(m => !fs.existsSync(path.join(ROOT, 'test', 'ports', `${m}.contract.test.js`)));
        expect(missing).toEqual([]);
    });

    it('the checks reject what they are there to catch (the checks themselves)', () => {
        const read = () => "import { createLocalStore } from '../store/local/index.js';";
        expect(implementationChoosers(['src/vault/index.js'], read, () => 'src/store/local/index.js')).toEqual(['src/vault/index.js -> src/store/local/index.js']);
        expect(implementationChoosers([COMPOSITION], read, () => 'src/store/local/index.js')).toEqual([]);
        expect(implementationChoosers(['src/store/index.js'], () => "import x from './local/index.js';", () => 'src/store/local/index.js')).toEqual([]);
        expect(modulesWithImplementations(['src/store/local', 'src/store/memory', 'src/policy'])).toEqual(['store']);
        expect(moduleBypasses(['src/vault/index.js'], read, () => 'src/store/local/index.js')).toEqual([]); // passes the index rule, caught by this one
    });
});
