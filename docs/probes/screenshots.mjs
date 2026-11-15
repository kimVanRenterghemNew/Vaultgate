// Maakt alle screenshots in docs/screenshots/ opnieuw (zie docs/screenshots/README.md): het portaal via de journey-tests in
// een echte browser (KS_SCREENSHOTS=1), en op Windows ook de tray-pop-ups en -menu's via docs/probes/windows-tray.mjs.
// Alleen nep-data uit tijdelijke kluizen; nooit een echt secret.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } }).status;

// Journeys buiten test/portal/ die ook een scherm vastleggen (aanraakvenster, rollback, integriteit).
const OTHER_SCREENS = ['test/approval/touch.journey.test.js', 'test/integrity/integrity.journey.test.js', 'test/touch/window.journey.test.js', 'test/vault/rollback.journey.test.js'];
const portal = run([path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--project', 'journey', 'test/portal/', ...OTHER_SCREENS], { KS_SCREENSHOTS: '1' });
const tray = process.platform === 'win32' ? run([path.join(ROOT, 'docs', 'probes', 'windows-tray.mjs'), '--screenshots']) : 0;
process.exit(portal || tray);
