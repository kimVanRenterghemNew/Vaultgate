// De afhankelijkheden worden in CI nagekeken: bekende kwetsbaarheden (high of hoger, alleen runtime) en de
// registry-handtekeningen van de lockfile, vóór lint en tests, en ook wekelijks zonder commit.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Wat aan de workflow ontbreekt, als lijst van namen. */
function missing(yaml) {
    const out = [];
    if (!/npm audit --omit=dev --audit-level=high/.test(yaml)) out.push('npm audit --omit=dev --audit-level=high');
    if (!/npm audit signatures/.test(yaml)) out.push('npm audit signatures');
    if (!/schedule:\s*\n\s*-\s*cron:/.test(yaml)) out.push('schedule');
    // de controle staat vóór de tests: de testjob wacht erop
    if (!/needs:\s*\[?[^\n]*\bdependencies\b/.test(yaml)) out.push('test needs dependencies');
    return out;
}

describe('afhankelijkheden in CI', () => {
    it('ci.yml kijkt de afhankelijkheden na, vóór de tests en elke week', () => {
        expect(missing(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'))).toEqual([]);
    });

    it('MOET weigeren: een workflow zonder audit, handtekeningen of geplande run', () => {
        const bare = 'name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    steps:\n      - run: npm test\n';
        expect(missing(bare)).toEqual(['npm audit --omit=dev --audit-level=high', 'npm audit signatures', 'schedule', 'test needs dependencies']);
    });
});
