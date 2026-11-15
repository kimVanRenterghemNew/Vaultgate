/**
 * Tests import a module through its index.js.
 * A test that deliberately tests internals is named `*.internal.test.js`. So an internal refactor only breaks
 * the tests that chose to depend on internals.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// De compositiewortel is publiek: poortcontracttests lopen over de implementaties die hij registreert (architecture.md §4).
const PUBLIC_ROOT_FILES = new Set(['src/composition.js']);

function testFiles(dir = 'test', out = []) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) testFiles(rel, out);
        else if (/\.test\.m?js$/.test(entry.name) && !/\.internal\.test\.m?js$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('tests use the public module API', () => {
    it('no test (other than *.internal.test.js) imports a file inside src/ past its index.js', () => {
        const intoSrc = moduleBypasses(testFiles()).filter(edge => edge.split(' -> ')[1].startsWith('src/'))
            .filter(edge => !PUBLIC_ROOT_FILES.has(edge.split(' -> ')[1]));
        expect(intoSrc).toEqual([]);
    });
});
