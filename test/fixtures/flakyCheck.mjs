// A deliberately flaky "check": green on every run except run number FLAKY_FAIL_AT (counted in the file FLAKY_COUNTER).
import fs from 'node:fs';

const counter = process.env.FLAKY_COUNTER;
const run = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(run));
console.log(`flaky check run ${run}`);
if (run === Number(process.env.FLAKY_FAIL_AT)) {
    console.error('planted failure: expected 1, received 2');
    process.exit(1);
}
