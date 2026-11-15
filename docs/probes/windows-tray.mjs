// Probe voor de echte Windows-tray: start src/tray-link/windows-tray.ps1 via het echte
// tray-protocol, in beide thema's (dim donker, nord licht; afgedwongen met KS_TRAY_THEME, de Windows-instelling blijft
// ongemoeid), stuurt de toestand (ontgrendeld, met een wachtende goedkeuring, vergrendeld) en drie vragen (goedkeuring,
// tunnel, koppelen) met een korte time-out, en controleert wat de tray toont. Er verschijnen pop-ups op het scherm; niet
// klikken (de probe verwacht "timeout"). Alleen op Windows.
//
//   node docs/probes/windows-tray.mjs                 controleren
//   node docs/probes/windows-tray.mjs --screenshots   en de PNG's naar docs/screenshots/ kopiëren
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTrayLink, windowsTray } from '../../src/tray-link/index.js';
import { snapshotCode } from '../../src/code-integrity/index.js';
import { pickPrefix } from '../../src/locale/index.js';
import { createCrypto } from '../../src/crypto/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAPSHOTS = path.join(ROOT, 'outputs', 'tray-snapshots');
const SCREENSHOTS = path.join(ROOT, 'docs', 'screenshots');

if (process.platform !== 'win32') { console.error('alleen op Windows'); process.exit(2); }

const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures.push(name); };
const waitFor = async (file, ms = 15_000) => {
    const t0 = Date.now();
    while (!fs.existsSync(file)) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 100)); }
    await new Promise(r => setTimeout(r, 200));
    return true;
};

async function runTheme(mode, expectedTheme, suffix) {
    const dir = path.join(SNAPSHOTS, mode);
    fs.mkdirSync(dir, { recursive: true });
    const readState = name => JSON.parse(fs.readFileSync(path.join(dir, `state-${name}.json`), 'utf8'));
    let lockRequests = 0;
    const link = createTrayLink({
        ...windowsTray(snapshotCode({ crypto: createCrypto() })), // zoals Vaultgate: uit de gecontroleerde bytes, geen pad
        env: { ...process.env, KS_TRAY_SNAPSHOT_DIR: dir, KS_TRAY_THEME: mode },
        crypto: createCrypto(),
        socketDir: dir,
        onLockRequest: () => { lockRequests += 1; },
        init: () => ({ portal: 'http://localhost:8485/', texts: pickPrefix('nl', 'tray.') }), // de controles hieronder zijn Nederlands
    });
    console.log(`\n--- thema ${expectedTheme} (${mode})`);
    try {
        const t0 = Date.now();
        await link.start();
        check('tray start en meldt zich met het token', await link.waitForTray(20_000), `${Date.now() - t0} ms`);

        link.publishState({ locked: false, pending: [] });
        check('toestand ontgrendeld', await waitFor(path.join(dir, 'state-unlocked.json')));
        const unlocked = readState('unlocked');
        check(`thema ${expectedTheme}`, unlocked.theme === expectedTheme, unlocked.theme);
        check('tooltip en menu bij ontgrendeld', unlocked.tooltip === 'Vaultgate: kluis open' && unlocked.menu.includes('Nu vergrendelen') && unlocked.menu.includes('Portaal openen'), JSON.stringify(unlocked));

        link.publishState({ locked: false, pending: [{ tool: 'claude-code', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1' }] });
        check('toestand met een wachtende goedkeuring', await waitFor(path.join(dir, 'state-pending.json')));
        const pending = readState('pending');
        check('tooltip telt de wachtende goedkeuringen', pending.tooltip === 'Vaultgate: kluis open (1 wachtend)' && pending.menu.includes('Wachtende goedkeuringen (1)'), JSON.stringify(pending));

        const [approve, tunnel, device] = await Promise.all([
            link.ask({ id: 'q1', tool: 'claude-code', secret: 'github_token', host: 'bücher.example', client: '127.0.0.1 (deze pc)', method: 'POST', path: '/repos/user/vaultgate/issues', timeoutMs: 4000 }),
            link.ask({ id: 'q2', tool: 'agent-vm', secret: '', host: 'github.com:443', client: '192.168.56.10', timeoutMs: 4000, variant: 'tunnel' }),
            link.ask({ id: 'q3', tool: 'claude-code', secret: '', host: 'K7QD-M2XP', client: '127.0.0.1', timeoutMs: 4000, variant: 'device' }),
        ]);
        check('niemand klikt: alle pop-ups antwoorden "timeout"', approve === 'timeout' && tunnel === 'timeout' && device === 'timeout', `${approve}, ${tunnel}, ${device}`);
        for (const v of ['approve', 'tunnel', 'device']) check(`pop-up ${v} getekend`, fs.existsSync(path.join(dir, `popup-${v}.png`)));

        link.publishState({ locked: true, pending: [] });
        check('toestand vergrendeld', await waitFor(path.join(dir, 'state-locked.json')));
        const locked = readState('locked');
        check('vergrendeld: "Nu vergrendelen" staat uit', locked.menu.includes('Nu vergrendelen [uit]') && locked.tooltip === 'Vaultgate: kluis dicht', JSON.stringify(locked));
        check('geen lock-verzoek zonder klik', lockRequests === 0);

        if (process.argv.includes('--screenshots')) {
            fs.mkdirSync(SCREENSHOTS, { recursive: true });
            for (const [from, to] of [['popup-approve.png', 'tray-popup-goedkeuring'], ['popup-tunnel.png', 'tray-popup-tunnel'], ['popup-device.png', 'tray-popup-koppelen'],
                ['tray-menu-unlocked.png', 'tray-menu-ontgrendeld'], ['tray-menu-pending.png', 'tray-menu-wachtend'], ['tray-menu-locked.png', 'tray-menu-vergrendeld']]) {
                fs.copyFileSync(path.join(dir, from), path.join(SCREENSHOTS, `${to}${suffix}.png`));
            }
        }
    } finally {
        link.close();
    }
}

fs.rmSync(SNAPSHOTS, { recursive: true, force: true });
await runTheme('dark', 'dim', '');
await runTheme('light', 'nord', '-licht');
if (process.argv.includes('--screenshots')) console.log(`\nscreenshots in ${path.relative(ROOT, SCREENSHOTS)}`);
console.log(failures.length ? `\n${failures.length} controle(s) gefaald` : '\nalle controles geslaagd');
process.exit(failures.length ? 1 : 0);
