// `npm run demo`. Start de mock-provider, Vaultgate (het echte proces, met tray) in een demo-map en het
// portaalvenster, en toont het draaiboek (docs/demo.md). Nooit de echte kluis: de demo-map moet onder `outputs/` of de
// tijdelijke map liggen.
//
//   npm run demo                      demo-map outputs/demo-home (bewaard tussen runs)
//   npm run demo -- --fresh           eerst een lege demo-map
//   npm run demo:watch                idem, maar bouwt UI en CSS opnieuw en herstart Vaultgate bij wijzigingen
//   node scripts/demo.mjs --check     alles op vrije poorten starten, controleren en stoppen (voor de test)
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createMockProvider } from './mock-provider.mjs';
import { openPortalWindow } from '../src/window/index.js';
import { startBuilders, watchSources } from './demo-watch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUTS = path.join(ROOT, 'outputs');

const { values: args } = parseArgs({
    options: {
        home: { type: 'string', default: path.join(OUTPUTS, 'demo-home') },
        fresh: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        tray: { type: 'string', default: 'auto' },
        watch: { type: 'boolean', default: false },
    },
});

if (args.watch && args.check) {
    process.stderr.write('--watch en --check gaan niet samen\n');
    process.exit(2);
}

/** Alleen een map onder outputs/ of de tijdelijke map: zo raakt de demo nooit de echte kluis. */
/** Het echte pad (lange namen i.p.v. 8.3-namen zoals USER~1), ook voor een map die nog niet bestaat. */
function real(dir) {
    const missing = [];
    let at = path.resolve(dir);
    while (!fs.existsSync(at)) { missing.unshift(path.basename(at)); at = path.dirname(at); }
    return path.join(fs.realpathSync.native(at), ...missing);
}
const inside = (dir, parent) => { const rel = path.relative(real(parent), real(dir)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
const home = path.resolve(args.home);
fs.mkdirSync(OUTPUTS, { recursive: true });
let allowedHome = false;
try { allowedHome = inside(home, OUTPUTS) || inside(home, os.tmpdir()); } catch { /* inaccessible or unresolved paths are outside the allowed roots */ }
if (!allowedHome) {
    process.stderr.write(`De demo-map moet onder ${OUTPUTS} of de tijdelijke map liggen (nooit de echte kluis): ${home}\n`);
    process.exit(2);
}
if (args.fresh) fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });

const ports = args.check ? { mock: 0, proxy: 0, portal: 0 } : { mock: 5099, proxy: 8484, portal: 8485 };
const mock = createMockProvider();
const mockOrigin = await mock.start(ports.mock);

// --- Vaultgate starten en stoppen -------------------------------------------------------------------------------

const logFile = fs.createWriteStream(path.join(home, 'demo.log'), { flags: 'a' });
const vaultgateArgs = [path.join(ROOT, 'src', 'main.js'), '--home', home, '--proxy-port', String(ports.proxy), '--portal-port', String(ports.portal), '--tray', args.tray];
let child = null;
let stopping = false;

/** Start Vaultgate en geeft het ready-event terug. */
function startVaultgate() {
    const proc = spawn(process.execPath, vaultgateArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    // end: false: bij een herstart blijft de log open voor het volgende proces.
    proc.stdout.pipe(logFile, { end: false });
    proc.stderr.pipe(logFile, { end: false });
    return new Promise((resolve, reject) => {
        let started = false;
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', line => {
            let event;
            try { event = JSON.parse(line); } catch { return; /* geen JSON: negeren */ }
            if (event.event === 'ready' && !started) { started = true; resolve(event); }
            if (event.event === 'fatal' && !started) reject(new Error(`Vaultgate startte niet: ${event.message}`));
        });
        proc.once('exit', code => {
            if (!started) reject(new Error(`Vaultgate stopte (code ${code}); zie ${path.join(home, 'demo.log')}`));
            else if (!proc.intentional && !stopping) {
                process.stdout.write(`Vaultgate stopte onverwacht (code ${code}); zie demo.log${args.watch ? '. Wacht op een wijziging.' : ''}\n`);
            }
        });
    });
}

/** Stopt Vaultgate en wacht tot het proces echt weg is (poorten vrij). */
async function stopVaultgate() {
    const proc = child;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    proc.intentional = true;
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
}

// --- watch: UI en CSS bouwen, Vaultgate herstarten --------------------------------------------------------------

let lastReason = '';
let restarting = false;
let again = false;

/** Herstart Vaultgate. Wijzigingen tijdens een herstart geven precies één extra herstart. */
async function restart() {
    if (stopping) return;
    if (restarting) { again = true; return; }
    restarting = true;
    do {
        again = false;
        process.stdout.write(`\nWijziging in ${lastReason}: Vaultgate herstart...\n`);
        await stopVaultgate();
        if (stopping) break;
        try {
            await startVaultgate();
            process.stdout.write('Vaultgate klaar. Herlaad het portaal (en ontgrendel de kluis als die vergrendeld is).\n');
        } catch (error) {
            process.stdout.write(`${error.message}\n(Wacht op de volgende wijziging.)\n`);
        }
    } while (again && !stopping);
    restarting = false;
}

// --- starten -------------------------------------------------------------------------------------------------------

const builders = args.watch ? await startBuilders(ROOT) : null;

const ready = await startVaultgate().catch(async error => {
    process.stderr.write(`${error.message}\n`);
    await builders?.stop();
    await mock.stop();
    process.exit(1);
});

const unwatch = args.watch ? watchSources(ROOT, reason => { lastReason = reason; restart(); }) : null;

const proxy = `http://127.0.0.1:${ready.proxyPort}`;
const portal = `http://localhost:${ready.portalPort}/`;

async function stop() {
    stopping = true;
    unwatch?.();
    await stopVaultgate();
    await builders?.stop();
    await mock.stop();
}

if (args.check) {
    const results = [
        ['portaal', (await fetch(portal)).status === 200],
        ['proxy (zonder tool-key: no-tool-key)', (await fetch(`${proxy}/forward/${mockOrigin}/echo`)).headers.get('x-vault-gate-rule') !== null],
        ['mock-provider', (await fetch(`${mockOrigin}/v1/models`)).status === 200],
    ];
    await stop();
    for (const [name, ok] of results) process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`);
    const all = results.every(([, ok]) => ok);
    process.stdout.write(all ? 'demo-check geslaagd\n' : 'demo-check gefaald\n');
    process.exit(all ? 0 : 1);
}

try {
    openPortalWindow({ url: portal, home });
} catch (error) {
    process.stdout.write(`(Portaalvenster niet geopend: ${error.message}. Open ${portal} zelf.)\n`);
}

process.stdout.write(`
Vaultgate demo
  portaal:        ${portal}
  proxy:          ${proxy}
  mock-provider:  ${mockOrigin}   (nep-API: /echo toont wat er binnenkwam)
  demo-map:       ${home}   (proceslog: demo.log)
${args.watch ? '  watch:          src/ en web/portal/ (UI en CSS worden opnieuw gebouwd, Vaultgate herstart)\n' : ''}
Draaiboek (volledig in docs/demo.md):
  1. Portaal: kluis aanmaken (passphrase), herstelcode bevestigen, passkey registreren (Windows Hello).
  2. Secret "demo" met waarde sk-demo-geheim-1234567890 en host ${mockOrigin}.
  3. Tool "mytool" toevoegen en de key kopiëren.
  4. In PowerShell:
     curl.exe -s ${proxy}/forward/${mockOrigin}/echo -H "x-vault-gate-tool-key: <key>" -H "Authorization: Bearer {{secret:demo}}" -d "{}"
     -> de tray vraagt toestemming; kies "Eenmalig". De echo toont "Bearer ***": het secret kwam aan, maar komt niet terug.
  5. Zelfde call naar een vreemde host:
     curl.exe -s -i ${proxy}/forward/https://example.com/ -H "x-vault-gate-tool-key: <key>" -H "Authorization: Bearer {{secret:demo}}"
     -> 403, x-vault-gate-rule: target-host-not-allowed (er werd niets ontsleuteld).
  6. Tabblad Audit in het portaal: beide calls met de regel die besliste.
  7. Tray-menu "Nu vergrendelen", dan de call van stap 4 opnieuw: 423 vault-locked.

Ctrl+C om te stoppen.
`);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stop(); process.exit(0); });
