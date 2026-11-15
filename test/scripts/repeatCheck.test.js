// The repeat script must catch a flaky check: a check that is red on one run out of N is reported, with its output kept.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repeatCheck } from '../../scripts/repeat-check.mjs';

const FLAKY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'flakyCheck.mjs');
const command = `"${process.execPath}" "${FLAKY}"`;
let dir;
const lines = [];

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'repeat-'));
    process.env.FLAKY_COUNTER = path.join(dir, 'counter');
    lines.length = 0;
});
afterEach(() => { delete process.env.FLAKY_COUNTER; delete process.env.FLAKY_FAIL_AT; });

describe('repeat-check', () => {
    it('Given a planted flaky check that is red on run 3 When repeated 5 times Then it stops at run 3 and keeps that output (MUST reject)', () => {
        process.env.FLAKY_FAIL_AT = '3';
        const result = repeatCheck({ times: 5, command, outDir: path.join(dir, 'out'), log: l => lines.push(l) });
        expect(result).toMatchObject({ ok: false, run: 3 });
        expect(fs.readFileSync(path.join(dir, 'counter'), 'utf8')).toBe('3'); // runs 4 and 5 never started
        const kept = fs.readFileSync(result.file, 'utf8');
        expect(kept).toContain('exit 1');
        expect(kept).toContain('flaky check run 3');
        expect(kept).toContain('planted failure');
        expect(lines.at(-1)).toContain('run 3/5 red');
    });

    it('Given a check that is always green When repeated 3 times Then ok, and nothing is written', () => {
        const outDir = path.join(dir, 'out');
        expect(repeatCheck({ times: 3, command, outDir, log: l => lines.push(l) })).toEqual({ ok: true, run: 3 });
        expect(lines).toHaveLength(3);
        expect(fs.existsSync(outDir)).toBe(false);
    });

    it('refuses an N that is not a positive integer', () => {
        for (const bad of [0, -1, 1.5, NaN]) expect(() => repeatCheck({ times: bad, command })).toThrow(/positive integer/);
    });
});
