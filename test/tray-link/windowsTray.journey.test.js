// De Windows-tray draait uit de bytes die bij de start gelezen en gecontroleerd zijn, niet uit wat er op het moment van
// starten op schijf staat: PowerShell krijgt geen pad, alleen een vaste opstartregel, en leest script en C# van stdin.
// Op Windows ook met de echte PowerShell: een tray-script dat na de snapshot op schijf vervangen werd, draait niet.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { snapshotCode } from '../../src/code-integrity/index.js';
import { createTrayLink, windowsTray, asciiJson } from '../../src/tray-link/index.js';
import { createCrypto } from '../../src/crypto/index.js';
import { copyInstall } from '../helpers/install.js';

const crypto = createCrypto();
const TRAY = 'src/tray-link/windows-tray.ps1';
let counter = 0;
const install = () => copyInstall(path.join(process.env.VAULTGATE_HOME, `tray-install-${process.pid}-${counter++}`));

describe('de Windows-tray starten uit de snapshot', () => {
    it('Given een snapshot When de opstartopdracht Then geen pad in argv, en stdin draagt precies de gelezen bron (alleen ASCII)', () => {
        const dir = install();
        const snapshot = snapshotCode({ root: dir, crypto });
        const launch = windowsTray(snapshot);
        expect(launch.command).toBe('powershell.exe');
        expect(launch.args).not.toContain('-File');
        expect(launch.args.join(' ')).not.toMatch(/\.ps1|\.cs|tray-link/);
        expect(launch.preamble.endsWith('\n')).toBe(true);
        expect(launch.preamble.slice(0, -1)).not.toContain('\n');
        expect(/[^\x20-\x7e]/.test(launch.preamble.slice(0, -1))).toBe(false);
        const sent = JSON.parse(launch.preamble);
        expect(sent.script).toBe(snapshot.read(TRAY).toString('utf8'));
        expect(sent.sources).toEqual(['Theme.cs', 'Tray.cs', 'Popup.cs'].map(f => snapshot.read(`src/tray-link/${f}`).toString('utf8')));
    });

    it('asciiJson: letters buiten ASCII als \\u-escape, en terug te lezen', () => {
        const value = { text: 'Vaultgate: één × “toestaan” 🌼' };
        expect(/[^\x20-\x7e]/.test(asciiJson(value))).toBe(false);
        expect(JSON.parse(asciiJson(value))).toEqual(value);
    });

    it('MOET weigeren: een snapshot zonder tray-script geeft geen opstartopdracht', () => {
        const snapshot = snapshotCode({ root: install(), crypto, paths: ['package.json'] });
        expect(() => windowsTray(snapshot)).toThrow(/not part of the installed code/);
    });

    it.skipIf(process.platform !== 'win32')('Given het tray-script op schijf vervangen na de snapshot When de tray start Then draait de gecontroleerde versie en meldt ze zich', async () => {
        const dir = install();
        const snapshot = snapshotCode({ root: dir, crypto });
        fs.writeFileSync(path.join(dir, TRAY), 'exit 99\n');
        for (const f of ['Theme.cs', 'Tray.cs', 'Popup.cs']) fs.writeFileSync(path.join(dir, 'src', 'tray-link', f), 'this is not C#');
        const link = createTrayLink({ ...windowsTray(snapshot), crypto, socketDir: dir, init: () => ({ portal: 'http://localhost:1/' }) });
        try {
            await link.start();
            expect(await link.waitForTray(25_000)).toBe(true);
        } finally {
            link.close();
        }
    }, 40_000);
});
