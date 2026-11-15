// `npm run attack`: draait de aanvalsbank tegen het echte proces en toont per aanval het resultaat.
// Exitcode 1 als een aanval die geblokkeerd hoort te zijn doorkomt, of als een secret in de uitvoer staat.
import { runBench } from './index.mjs';

const { results, leaks } = await runBench();
const mark = { blocked: 'GEBLOKKEERD', open: 'OPEN       ', FAIL: 'FAIL       ' };
for (const r of results) process.stdout.write(`${mark[r.verdict]}  ${r.id.padEnd(5)} ${r.name}  (${r.detail})\n`);
const failed = results.filter(r => r.verdict === 'FAIL');
const open = results.filter(r => r.verdict === 'open');
process.stdout.write(`\n${results.length - open.length - failed.length} geblokkeerd, ${open.length} open (met reden), ${failed.length} gefaald; lekken: ${leaks.length ? leaks.join(', ') : 'geen'}\n`);
process.exit(failed.length || leaks.length ? 1 : 0);
