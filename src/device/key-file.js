// De tool-key bij de client: `login` schrijft hem in `clients/<tool>.key`, `key --name` en de git credential helper lezen
// hem. Op Windows versleuteld met DPAPI (CurrentUser): wie het bestand leest, kopieert of in een back-up vindt, heeft geen
// bruikbare key; op een andere pc of als andere gebruiker gaat hij niet open. Restrisico (docs/security-model.md): een
// proces van dezelfde gebruiker kan DPAPI zelf aanroepen of `key --name` starten. Zonder beschermer (macOS, Linux) blijft
// het een bestand met rechten 0600. Een oud, leesbaar bestand wordt bij het lezen versleuteld. Een tweede regel
// `proxy <url>` (niet geheim) onthoudt waar `login` koppelde: daar wisselt de helper uit (exchange-client.js).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NAME, local, tagged } from './client.js';

const PREFIX = 'dpapi:';
// Base64 in op stdin, base64 uit op stdout: de key staat nooit op de opdrachtregel (die zien andere processen).
const script = op => `Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($b, $null, 'CurrentUser')))`;

/** DPAPI (CurrentUser) via PowerShell. `run` is ingespoten (spawnSync) om te testen zonder Windows. */
export function createDpapi({ run = spawnSync } = {}) {
    const call = (op, base64) => {
        const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(op)], { input: base64, encoding: 'utf8', windowsHide: true });
        // Nooit stderr doorgeven: de fout zegt alleen dat het mislukte.
        if (r.status !== 0 || !r.stdout?.trim()) throw tagged('KEY_PROTECT_FAILED', `DPAPI ${op} failed`);
        return r.stdout.trim();
    };
    return Object.freeze({
        protect: text => PREFIX + call('Protect', Buffer.from(text, 'utf8').toString('base64')),
        unprotect: stored => Buffer.from(call('Unprotect', stored.slice(PREFIX.length)), 'base64').toString('utf8'),
    });
}

/** De beschermer van dit platform: DPAPI op Windows; elders (nog) geen (keychain en secret-service: macOS/Linux-fase). */
export const keyProtector = (platform = process.platform) => (platform === 'win32' ? createDpapi() : null);

/** Het pad van de opgeslagen key van een tool (geschreven door `login`). */
export const savedKeyPath = (home, name) => `${home.replace(/[\\/]$/, '')}/clients/${name}.key`;

const checkName = (name, t) => {
    if (typeof name !== 'string' || !NAME.test(name)) throw tagged('INVALID_NAME', local(t, 'cli.key.invalidName', 'invalid tool name {name}', { name: JSON.stringify(name) }));
};

/** Het proxy-adres uit een key-bestand (de regel `proxy <url>`), of null. */
export const savedProxy = text => /^proxy (\S+)$/m.exec(String(text))?.[1] ?? null;

/**
 * Schrijft de key van `name`, versleuteld als er een beschermer is; map 0700, bestand 0600. Atomair (tijdelijk bestand,
 * dan hernoemen): een crash laat het oude of het nieuwe bestand achter, nooit een half. Geeft het pad terug.
 */
export function saveKey({ home, name, key, protector, proxy = null, t = k => k }) {
    checkName(name, t);
    const file = savedKeyPath(home, name);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${file}.tmp`, `${protector ? protector.protect(key) : key}\n${proxy ? `proxy ${proxy}\n` : ''}`, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    return file;
}

/**
 * Leest de opgeslagen tool-key (voor `apiKeyHelper` van Claude Code en de git credential helper). Alleen deze key:
 * nooit een provider-sleutel. Met `writeFile` en een beschermer wordt een oud, leesbaar bestand versleuteld.
 */
export function readSavedKey({ home, name, readFile, writeFile = null, protector = null, t = k => k }) {
    checkName(name, t);
    const file = savedKeyPath(home, name);
    const unreadable = () => tagged('NO_SAVED_KEY', local(t, 'cli.key.unreadable', 'the key for {name} cannot be opened here (other user or PC): run "node src/main.js login --name {name}" again', { name }));
    let text;
    let rest;
    try { [text, ...rest] = String(readFile(file)).trim().split(/\r?\n/); } catch { throw tagged('NO_SAVED_KEY', local(t, 'cli.key.noSaved', 'no key for {name}: run "node src/main.js login --name {name}" first', { name })); }
    let key = text;
    if (text.startsWith(PREFIX)) {
        if (!protector) throw unreadable();
        try { key = protector.unprotect(text); } catch { throw unreadable(); }
    }
    if (!key.startsWith('ks_')) throw tagged('NO_SAVED_KEY', local(t, 'cli.key.invalidSaved', 'the key file for {name} is not a Vaultgate tool key', { name }));
    if (key === text && protector && writeFile) {
        // Overzetten mag mislukken: de tool blijft werken en het volgende lezen probeert het opnieuw.
        try { writeFile(file, [protector.protect(key), ...rest, ''].join('\n')); } catch { /* het oude bestand blijft */ }
    }
    return key;
}
