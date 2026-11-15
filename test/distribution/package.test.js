// Vaultgate als npm-pakket (npx vaultgate / vaultgate start / login / portal).
// npm pack bevat alleen de runtime-bestanden (src, bin, UI-assets, i18n, README, LICENSE), geen tests, docs of kluis.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('npm-pakket distributie', () => {
    it('package.json heeft de vereiste distributievelden (bin, files, engines, license)', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('vaultgate');
        expect(pkg.license).toBe('GPL-3.0-or-later');
        expect(pkg.engines?.node).toBe('>=24');
        expect(pkg.bin).toEqual({
            vaultgate: './bin/vaultgate.js',
        });
        expect(Array.isArray(pkg.files)).toBe(true);
        expect(pkg.files).toContain('bin');
        expect(pkg.files).toContain('src');
    });

    it('bin/vaultgate.js bestaat en verwijst naar src/main.js', () => {
        const binFile = path.join(ROOT, 'bin', 'vaultgate.js');
        expect(fs.existsSync(binFile)).toBe(true);
        const text = fs.readFileSync(binFile, 'utf8');
        expect(text).toMatch(/^#!\/usr\/bin\/env node/);
        expect(text).toContain('../src/main.js');
    });

    it('Given npm pack When inhoud bekeken Then staan alleen runtime-bestanden erin (geen tests, docs of kluis)', () => {
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const raw = execFileSync(npmCmd, ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', shell: true });
        const [tarball] = JSON.parse(raw);
        const paths = tarball.files.map(f => f.path);

        // Wel aanwezig
        expect(paths).toContain('bin/vaultgate.js');
        expect(paths).toContain('src/main.js');
        expect(paths).toContain('README.md');
        expect(paths).toContain('LICENSE');
        expect(paths).toContain('web/portal/portal.generated.js');
        expect(paths).toContain('web/portal/portal.generated.css');

        // Uitgesloten: geen tests, documentatie of kluisdata
        const excludedPrefixes = ['test/', 'docs/', 'back' + 'log/', '.claude/', '.git/'];
        for (const p of paths) {
            for (const prefix of excludedPrefixes) expect(p.startsWith(prefix)).toBe(false);
            expect(p).not.toMatch(/\.vault\b/);
        }
    });

    it('subcommando start: node bin/vaultgate.js start accepteert het start-commando', () => {
        // Test dat 'start' als subcommando niet faalt op parseArgs (zoals een onverwachte positional)
        const node = process.execPath;
        const res = execFileSync(node, ['bin/vaultgate.js', 'start', '--help'], { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        // Zonder opties start het proces; met start Args kan de parser starten
        expect(res).toBeDefined();
    });
});
