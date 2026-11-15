// `npm run demo`. De check-modus start alles (mock-provider, Vaultgate, portaal) op vrije poorten in een
// tijdelijke map, controleert dat het antwoordt en stopt. De demo raakt nooit de echte kluis: een map buiten `outputs/` of
// de tijdelijke map wordt geweigerd.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome } from '../helpers/journey.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const demo = args => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'demo.mjs'), ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, KS_TRAY: 'none' } });

describe('npm run demo', () => {
    it('Given een lege demo-map When --check Then starten portaal, proxy en mock, antwoorden ze, en stopt alles', () => {
        const home = tempHome();
        const r = demo(['--check', '--tray', 'none', '--home', home]);
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('demo-check geslaagd');
        expect(fs.existsSync(path.join(home, 'demo.log'))).toBe(true); // het echte proces draaide in de demo-map
    }, 90_000);

    it('MOET weigeren: een demo-map buiten outputs/ of de tijdelijke map (bv. de echte kluis)', () => {
        const home = path.join(os.homedir(), `vaultgate-demo-niet-hier-${process.pid}`);
        const r = demo(['--check', '--tray', 'none', '--home', home]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('demo-map');
        expect(fs.existsSync(home)).toBe(false);
    });
});
