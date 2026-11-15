#!/usr/bin/env node
// Startpunt van Vaultgate. Dun: argumenten lezen, het proces samenstellen (src/composition.js), signalen afhandelen.
//
//   node src/main.js [--home DIR] [--proxy-port 8484] [--portal-port 8485] [--portal-host 127.0.0.1]
//                    [--tray auto|windows|none] [--tray-command script.mjs] [--unlock-stdin] [--window app|none]
//
// --unlock-stdin: lees de passphrase als eerste regel van stdin (nooit via argv of een omgevingsvariabele: die zijn
// zichtbaar voor andere processen). Uitvoer: één JSON-gebeurtenis per regel op stdout, nooit een waarde.
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { createApp } from './composition.js';
import { loadConfig, resolveEffectiveConfig } from './config/index.js';
import { runDeviceLogin, rotateSavedKey, saveKey, keyProtector, gitCredential } from './device/index.js';
import { openPortalWindow } from './window/index.js';
import { appLanguage, translator } from './locale/index.js';
import { resolveHome } from './legacy-name/index.js';
import { runMcpCli } from './mcp/index.js';

const language = appLanguage();
const t = translator(language);

// CLI-commando's lezen een nog niet overgenomen installatie ter plaatse; alleen de server verplaatst ze.
const cliHome = arg => resolveHome({ arg }).home;

// `node src/main.js login --name <tool> [--proxy URL] [--print]`: deze tool koppelen via de device flow.
if (process.argv[2] === 'login') {
    const { values: opts } = parseArgs({
        args: process.argv.slice(3),
        options: { name: { type: 'string' }, proxy: { type: 'string', default: 'http://127.0.0.1:8484' }, home: { type: 'string' }, print: { type: 'boolean', default: false } },
    });
    const home = cliHome(opts.home);
    try {
        const { toolKey, toolName } = await runDeviceLogin({ proxy: opts.proxy, name: opts.name, out: text => process.stderr.write(`${text}\n`), t });
        if (opts.print) {
            process.stdout.write(`${toolKey}\n`);
        } else {
            // Standaard niet op het scherm: in een bestand van deze gebruiker, op Windows versleuteld met DPAPI.
            const file = saveKey({ home, name: toolName, key: toolKey, protector: keyProtector(), proxy: opts.proxy, t });
            process.stderr.write(`${t('cli.login.saved', { file })}\n`);
        }
        process.exit(0);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

// `node src/main.js key --name <tool> [--proxy URL]`: de opgeslagen key inwisselen voor een token van 10 min (de key
// roteert: de nieuwe staat meteen in het bestand) en het token printen, als `apiKeyHelper` voor Claude Code.
// `node src/main.js git-credential --name <tool> <get|store|erase>`: git credential helper die alleen zo'n token levert.
if (process.argv[2] === 'key' || process.argv[2] === 'git-credential') {
    const { values: opts, positionals } = parseArgs({ args: process.argv.slice(3), allowPositionals: true, options: { name: { type: 'string' }, home: { type: 'string' }, proxy: { type: 'string' } } });
    const home = cliHome(opts.home);
    try {
        const helper = process.argv[2] === 'key';
        // git bewaart niets (store/erase): alleen `get` wisselt uit.
        const token = helper || positionals[0] === 'get' ? await rotateSavedKey({ home, name: opts.name, proxy: opts.proxy ?? null, protector: keyProtector(), t }) : null;
        process.stdout.write(helper ? `${token}\n` : gitCredential({ operation: positionals[0], key: token }));
        process.exit(0);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

// `node src/main.js portal [--port 8485]`: het portaal openen in het afgeschermde venster.
if (process.argv[2] === 'portal') {
    const { values: opts } = parseArgs({ args: process.argv.slice(3), options: { port: { type: 'string', default: '8485' }, home: { type: 'string' } } });
    const home = cliHome(opts.home);
    try {
        const { browser, extensions } = openPortalWindow({ url: `http://localhost:${opts.port}/`, home });
        process.stderr.write(`${t('cli.portal.opened', { browser })}\n`);
        if (extensions.length) process.stderr.write(`${t('cli.portal.extensions', { count: extensions.length })}\n`);
        process.exit(0);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

// `node src/main.js mcp [--name <tool>] [--proxy URL] [--key <key>]`: MCP-server over stdio.
if (process.argv[2] === 'mcp') {
    const { values: opts } = parseArgs({
        args: process.argv.slice(3),
        options: { name: { type: 'string' }, proxy: { type: 'string', default: 'http://127.0.0.1:8484' }, home: { type: 'string' }, key: { type: 'string' } },
    });
    const home = cliHome(opts.home);
    await runMcpCli({ opts, home, env: process.env, t });
    process.exit(0);
}

const rawArgs = process.argv.slice(2);
const startArgs = rawArgs[0] === 'start' ? rawArgs.slice(1) : rawArgs;
const { values: rawOpts } = parseArgs({
    args: startArgs,
    options: {
        help: { type: 'boolean', short: 'h', default: false },
        config: { type: 'string' },
        home: { type: 'string' },
        'proxy-port': { type: 'string' },
        'portal-port': { type: 'string' },
        'portal-host': { type: 'string' },
        tray: { type: 'string' },
        window: { type: 'string' }, // 'none': nooit een venster openen (tests)
        'tray-command': { type: 'string' },
        'unlock-stdin': { type: 'boolean' },
        'device-interval-seconds': { type: 'string' },
    },
});

if (rawOpts.help || process.argv[2] === 'help') {
    process.stdout.write('Usage: vaultgate [start|login|portal|key|mcp] [options]\n');
    process.exit(0);
}

const config = loadConfig({ configPath: rawOpts.config });
const args = resolveEffectiveConfig(config, rawOpts);

const placed = resolveHome({ arg: args.home, move: true });
const home = placed.home;
const log = event => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
if (placed.migrated) log({ event: 'home-migrated', from: placed.from, to: home });
if (placed.error) log({ event: 'home-migration-failed', code: placed.error, home });

async function readFirstLine() {
    const rl = readline.createInterface({ input: process.stdin });
    try {
        for await (const line of rl) return line;
        return '';
    } finally {
        rl.close();
    }
}

let app;
try {
    app = createApp({
        home,
        proxyPort: args.proxyPort,
        portalPort: args.portalPort,
        portalHost: args.portalHost,
        tray: args.trayCommand ? { script: path.resolve(args.trayCommand) } : args.tray,
        log,
        deviceIntervalSeconds: args.deviceIntervalSeconds,
        window: args.window,
    });
    const ports = await app.start();
    if (args.unlockStdin) {
        try {
            await app.unlockWithPassphrase(await readFirstLine());
        } catch (error) {
            // --unlock-stdin bevestigt nooit (oudere kopie, gewijzigde code); de gewijzigde bestanden staan erbij.
            log({ event: 'unlock-failed', code: error.code ?? 'unknown', ...(error.files ? { files: error.files } : {}) });
        }
    }
    log({ event: 'ready', home, ...ports, unlocked: app.vault.isUnlocked() });
    if (args.window !== 'none') {
        app.openPortal();
    }
} catch (error) {
    log({ event: 'fatal', code: error.code ?? 'unknown', message: error.message });
    process.exit(error.code === 'PORTAL_NOT_LOCAL' ? 2 : 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        await app.stop();
        process.exit(0);
    });
}
