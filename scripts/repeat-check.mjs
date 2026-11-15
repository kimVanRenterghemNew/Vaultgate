// Draait `npm run check` N keer na elkaar en stopt bij de eerste rode run; die uitvoer blijft bewaard in
// outputs/repeat-check/, zodat een wisselvallige test zich niet achter een groene herhaling verstopt.
// `node scripts/repeat-check.mjs [N=10]`; exit 0 alleen als alle N runs groen zijn.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ times: number, command?: string, outDir?: string, log?: (line: string) => void }} options
 * @returns {{ ok: boolean, run: number, file?: string }} ok false: `run` is de eerste rode run, `file` haar uitvoer.
 */
export function repeatCheck({ times, command = 'npm run check', outDir = path.join(ROOT, 'outputs', 'repeat-check'), log = console.log }) {
    if (!Number.isInteger(times) || times < 1) throw new Error(`N must be a positive integer, got ${times}`);
    for (let run = 1; run <= times; run++) {
        const started = Date.now();
        const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 1 << 30 });
        const seconds = Math.round((Date.now() - started) / 1000);
        if (result.status !== 0) {
            fs.mkdirSync(outDir, { recursive: true });
            const file = path.join(outDir, `run-${run}-of-${times}.log`);
            fs.writeFileSync(file, `${command}\nexit ${result.status}${result.error ? ` (${result.error.message})` : ''}\n\n${result.stdout ?? ''}${result.stderr ?? ''}`);
            log(`run ${run}/${times} red (exit ${result.status}, ${seconds} s); output: ${file}`);
            return { ok: false, run, file };
        }
        log(`run ${run}/${times} green (${seconds} s)`);
    }
    return { ok: true, run: times };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = repeatCheck({ times: Number(process.argv[2] ?? 10) }).ok ? 0 : 1;
}
