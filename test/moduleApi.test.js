/**
 * Module architecture rules, enforced from the first line of code:
 *  1. A folder is a module. Its `index.js` is the deliberately chosen public API.
 *  2. Code outside a module only imports the module's `index.js`, never a file inside it.
 *  3. No dumping-ground folders (`tools`, `utils`, `helpers`, `common`, `shared`, `misc`, `lib`).
 *  4. No `class` (also enforced by eslint): objects come from factories, errors are tagged.
 * There is NO baseline: this repo starts clean, so every violation fails.
 * Scope: runtime code (`src/`, `scripts/`, and the browser code in `web/`). Tests are allowed to test internals (`*.internal.test.js`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['src', 'scripts', 'web'];
const DUMP_FOLDER_NAMES = new Set(['tools', 'tool', 'utils', 'util', 'helpers', 'helper', 'common', 'shared', 'misc', 'lib']);

function walk(dir, out = { files: [], dirs: [] }) {
    if (!fs.existsSync(path.join(ROOT, dir))) return out;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) { out.dirs.push(rel); walk(rel, out); }
        else if (/\.(m?js|cjs)$/.test(entry.name)) out.files.push(rel);
    }
    return out;
}

const tree = SCOPES.reduce((acc, scope) => walk(scope, acc), { files: [], dirs: [] });

describe('module architecture (no baseline: the repo starts clean)', () => {
    it('imports between modules go through index.js', () => {
        expect(moduleBypasses(tree.files)).toEqual([]);
    });

    it('every folder in src/ with code has an index.js', () => {
        const missing = tree.dirs.filter(dir => dir.startsWith('src/'))
            .filter(dir => fs.readdirSync(path.join(ROOT, dir)).some(name => /\.m?js$/.test(name)))
            .filter(dir => !fs.existsSync(path.join(ROOT, dir, 'index.js')));
        expect(missing).toEqual([]);
    });

    it('no dumping-ground folders', () => {
        expect(tree.dirs.filter(dir => DUMP_FOLDER_NAMES.has(path.posix.basename(dir)))).toEqual([]);
    });

    it('the bypass detector rejects an import past an index.js (the check itself)', () => {
        const files = ['src/proxy/index.js'];
        const read = () => "import { decide } from '../policy/rules.js';";
        const resolve = () => 'src/policy/rules.js';
        expect(moduleBypasses(files, read, resolve)).toEqual(['src/proxy/index.js -> src/policy/rules.js']);
        expect(moduleBypasses(files, () => "import { decide } from '../policy/index.js';", () => 'src/policy/index.js')).toEqual([]);
    });
});
