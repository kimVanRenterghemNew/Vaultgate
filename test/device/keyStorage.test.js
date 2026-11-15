// De tool-key bij de client: op Windows versleuteld met DPAPI (CurrentUser), zodat wie het bestand `clients/<tool>.key`
// leest, kopieert of in een back-up vindt geen bruikbare key ziet. Alleen `key --name` (DPAPI van dezelfde gebruiker)
// geeft hem terug. Elders (geen beschermer) blijft het bestand met rechten 0600. De echte DPAPI draait alleen op Windows;
// de rest met een nep-PowerShell die laat zien wat er op de opdrachtregel en op stdin gaat.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDpapi, keyProtector, saveKey, readSavedKey, savedKeyPath } from '../../src/device/index.js';

const KEY = 'ks_herkenbaarNepToolKey0123456789abcdefghij';
let n = 0;
const freshHome = () => path.join(process.env.VAULTGATE_HOME, `client-${n++}`);
const readFile = file => fs.readFileSync(file, 'utf8');
const writeFile = (file, text) => fs.writeFileSync(file, text, { mode: 0o600 });

/** Nep-PowerShell: draait de bytes om (geen echte versleuteling) en onthoudt elke aanroep. */
function fakePowerShell({ fail = false } = {}) {
    const calls = [];
    const run = (command, args, options) => {
        calls.push({ command, args, input: options.input });
        if (fail) return { status: 1, stdout: '', stderr: 'boom' };
        return { status: 0, stdout: Buffer.from(Buffer.from(options.input, 'base64').reverse()).toString('base64') + '\r\n', stderr: '' };
    };
    return { run, calls };
}

describe.runIf(process.platform === 'win32')('tool-key met de echte DPAPI (Windows)', () => {
    it('Given een tool-key opgeslagen met DPAPI When een ander proces leest het bestand Then vindt het geen bruikbare key', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: keyProtector() });
        const other = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))', savedKeyPath(home, 'mytool')], { encoding: 'utf8' });
        expect(other.status).toBe(0);
        expect(other.stdout).toMatch(/^dpapi:[A-Za-z0-9+/=]+\s*$/);
        expect(other.stdout).not.toContain(KEY);
        expect(other.stdout).not.toContain('ks_');
        expect(readSavedKey({ home, name: 'mytool', readFile, protector: keyProtector() })).toBe(KEY);
    }, 30_000);

    it('MOET weigeren: een beschadigd DPAPI-bestand geeft geen key en geen inhoud in de fout', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: null });
        writeFile(savedKeyPath(home, 'mytool'), 'dpapi:AAAAbm9nIGVlbiBibG9i\n');
        expect(() => readSavedKey({ home, name: 'mytool', readFile, protector: keyProtector() })).toThrow(expect.objectContaining({ code: 'NO_SAVED_KEY' }));
    }, 30_000);
});

describe('tool-key bij de client opslaan en lezen', () => {
    it('keyProtector: DPAPI op Windows, elders (nog) geen', () => {
        expect(keyProtector('win32')).toMatchObject({ protect: expect.any(Function), unprotect: expect.any(Function) });
        expect(keyProtector('linux')).toBeNull();
        expect(keyProtector('darwin')).toBeNull();
    });

    it('de key gaat via stdin naar PowerShell, nooit op de opdrachtregel; het bestand bevat hem niet', () => {
        const ps = fakePowerShell();
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: createDpapi({ run: ps.run }) });
        const stored = fs.readFileSync(savedKeyPath(home, 'mytool'), 'utf8');
        expect(stored).toMatch(/^dpapi:/);
        expect(stored).not.toContain(KEY);
        expect(ps.calls[0].command).toBe('powershell.exe');
        expect(ps.calls[0].args.join(' ')).toContain("'CurrentUser'");
        expect(ps.calls[0].args.join(' ')).not.toContain(KEY);
        expect(ps.calls[0].args.join(' ')).not.toContain(Buffer.from(KEY).toString('base64'));
        expect(readSavedKey({ home, name: 'mytool', readFile, protector: createDpapi({ run: ps.run }) })).toBe(KEY);
        expect(ps.calls.map(c => c.args.at(-1).match(/ProtectedData\]::(\w+)/)[1])).toEqual(['Protect', 'Unprotect']);
    });

    it('Given een oud, leesbaar key-bestand When de key gelezen wordt Then staat het daarna versleuteld en blijft de key werken', () => {
        const ps = fakePowerShell();
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: null });
        expect(fs.readFileSync(savedKeyPath(home, 'mytool'), 'utf8')).toBe(`${KEY}\n`);
        const protector = createDpapi({ run: ps.run });
        expect(readSavedKey({ home, name: 'mytool', readFile, writeFile, protector })).toBe(KEY);
        expect(fs.readFileSync(savedKeyPath(home, 'mytool'), 'utf8')).toMatch(/^dpapi:/);
        expect(readSavedKey({ home, name: 'mytool', readFile, writeFile, protector })).toBe(KEY);
    });

    it('lukt het versleutelen bij het overzetten niet, dan werkt de key nog en blijft het bestand zoals het was', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: null });
        expect(readSavedKey({ home, name: 'mytool', readFile, writeFile, protector: createDpapi({ run: fakePowerShell({ fail: true }).run }) })).toBe(KEY);
        expect(fs.readFileSync(savedKeyPath(home, 'mytool'), 'utf8')).toBe(`${KEY}\n`);
    });

    it('zonder beschermer (macOS, Linux): het bestand met alleen de key, rechten 0600 waar het systeem dat kent', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: null });
        const file = savedKeyPath(home, 'mytool');
        expect(fs.readFileSync(file, 'utf8')).toBe(`${KEY}\n`);
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(readSavedKey({ home, name: 'mytool', readFile, protector: null })).toBe(KEY);
    });

    it('MOET weigeren: DPAPI faalt (andere gebruiker of pc), of een DPAPI-bestand zonder beschermer; de fout bevat de inhoud niet', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: KEY, protector: createDpapi({ run: fakePowerShell().run }) });
        const stored = fs.readFileSync(savedKeyPath(home, 'mytool'), 'utf8').trim();
        for (const protector of [createDpapi({ run: fakePowerShell({ fail: true }).run }), null]) {
            let error;
            try { readSavedKey({ home, name: 'mytool', readFile, protector }); } catch (e) { error = e; }
            expect(error).toMatchObject({ code: 'NO_SAVED_KEY' });
            expect(error.message).not.toContain(stored.slice(6));
            expect(error.message).toMatch(/login --name mytool/);
        }
    });

    it('MOET weigeren: wat na het ontsleutelen geen Vaultgate tool-key is', () => {
        const home = freshHome();
        saveKey({ home, name: 'mytool', key: 'sk-ant-geen-tool-key', protector: createDpapi({ run: fakePowerShell().run }) });
        expect(() => readSavedKey({ home, name: 'mytool', readFile, protector: createDpapi({ run: fakePowerShell().run }) })).toThrow(expect.objectContaining({ code: 'NO_SAVED_KEY' }));
    });

    it('MOET weigeren: saveKey met een ongeldige toolnaam (de naam wordt een bestandsnaam)', () => {
        expect(() => saveKey({ home: freshHome(), name: '../buiten', key: KEY, protector: null })).toThrow(expect.objectContaining({ code: 'INVALID_NAME' }));
    });
});
