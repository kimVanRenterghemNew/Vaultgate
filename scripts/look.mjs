// `npm run look`: elk portaalscherm als screenshot, in donker en licht, op de maat van het portaalvenster, naar
// outputs/look/<thema>/, met per scherm de problemen die een gebruiker zou zien (test/helpers/look.js). Gebruikt de
// journey-tests (echte processen in tijdelijke mappen, virtuele passkey); docs/screenshots/ blijft onaangeroerd.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', 'look');
const REPORT = path.join(OUT, 'report.jsonl');
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const scheme of ['dark', 'light']) {
    const env = { ...process.env, KS_SCREENSHOTS: '1', KS_SCREENSHOTS_DIR: path.join(OUT, scheme), KS_COLOR_SCHEME: scheme, KS_LOOK_REPORT: REPORT };
    const run = spawnSync(process.execPath, [VITEST, 'run', '--project', 'journey', 'test/portal/'], { cwd: ROOT, stdio: 'inherit', env });
    failed ||= run.status;
}

const lines = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const withProblems = lines.filter(entry => entry.problems.length);
process.stdout.write(`\n${lines.length} screens in ${path.relative(ROOT, OUT)}; ${withProblems.length} with problems\n`);
for (const { scheme, name, problems } of withProblems) process.stdout.write(`  ${scheme}/${name}: ${problems.join('; ')}\n`);
process.exit(failed);
