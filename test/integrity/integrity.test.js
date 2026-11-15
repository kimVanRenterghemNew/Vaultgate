// Integriteit van de eigen code: de hashes van de geïnstalleerde bestanden (bij de start gelezen) tegen de lijst die de
// kluis vastlegde, versleuteld met de vault key. Een aangepast tray-script of portaalbestand: de kluis opent niet tot de
// gebruiker het bevestigt. Echte bestanden in een kopie van de installatie in een tijdelijke map, eigen kluis per test.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { snapshotCode, changedFiles, CODE_PATHS, INSTALL_ROOT } from '../../src/code-integrity/index.js';
import { createVault, CODE_CHANGED, VAULT_TAMPERED } from '../../src/vault/index.js';
import { MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';
import { crypto, fakeClock } from '../vault/fixtures.js';
import { fakeSecret } from '../helpers/secretLeak.js';
import { copyInstall } from '../helpers/install.js';

const PASS = 'integrity test passphrase';
const TRAY = 'src/tray-link/windows-tray.ps1';
let counter = 0;
const tempDir = name => path.join(process.env.VAULTGATE_HOME, `${name}-${process.pid}-${counter++}`);

/** Een kopie van de installatie en een kluismap; `open(snapshot)` is een nieuwe start met de code zoals ze dan is. */
function place() {
    const install = copyInstall(tempDir('install'));
    const dir = tempDir('vault');
    const clock = fakeClock();
    const open = code => createVault({ store: choose('store', 'local', { dir }), crypto, clock, kdf: MIN_KDF, code });
    const snap = () => snapshotCode({ root: install, crypto }).hashes;
    return { install, dir, open, snap };
}

async function reopen(p, code) {
    const vault = p.open(code);
    await vault.load();
    return vault;
}

describe('de geïnstalleerde bestanden lezen', () => {
    it('Given de installatie When een snapshot Then elk codebestand met een hash, posix-paden, en de bytes zoals gelezen', () => {
        const snapshot = snapshotCode({ crypto });
        const files = Object.keys(snapshot.hashes);
        expect(INSTALL_ROOT).toBe(path.resolve(import.meta.dirname, '..', '..'));
        expect(files).toContain(TRAY);
        expect(files).toContain('package.json');
        expect(files.every(f => CODE_PATHS.some(p => f === p || f.startsWith(`${p}/`)))).toBe(true);
        expect(files.some(f => f.includes('\\') || f.startsWith('test/') || f.startsWith('node_modules/'))).toBe(false);
        expect(snapshot.read(TRAY).equals(fs.readFileSync(path.join(INSTALL_ROOT, TRAY)))).toBe(true);
        expect(snapshot.hashes[TRAY]).toBe(crypto.keyedHash(undefined, fs.readFileSync(path.join(INSTALL_ROOT, TRAY))));
    });

    it('Given een snapshot When het bestand daarna op schijf verandert Then geeft read() nog de bytes van de start (geen TOCTOU)', () => {
        const install = copyInstall(tempDir('install'));
        const snapshot = snapshotCode({ root: install, crypto });
        const before = snapshot.read(TRAY);
        fs.writeFileSync(path.join(install, TRAY), 'exit 99');
        expect(snapshot.read(TRAY).equals(before)).toBe(true);
        snapshot.read(TRAY).fill(0); // een kopie: de snapshot zelf blijft intact
        expect(snapshot.read(TRAY).equals(before)).toBe(true);
    });

    it('MOET weigeren: read() van een bestand buiten de snapshot', () => {
        const snapshot = snapshotCode({ root: copyInstall(tempDir('install')), crypto });
        expect(() => snapshot.read('../outside.txt')).toThrow(/not part of the installed code/);
        expect(() => snapshot.read('test/x.js')).toThrow(/not part of the installed code/);
    });

    it('MOET opvallen: een gewijzigd, een toegevoegd en een verwijderd bestand', () => {
        const p = place();
        const before = p.snap();
        fs.appendFileSync(path.join(p.install, TRAY), '\n# altijd toestaan\n');
        fs.writeFileSync(path.join(p.install, 'src', 'policy', 'extra.js'), 'export default 1;\n');
        fs.rmSync(path.join(p.install, 'web', 'portal', 'portal.generated.css'));
        expect(changedFiles(before, p.snap())).toEqual(['src/policy/extra.js', TRAY, 'web/portal/portal.generated.css'].sort());
    });

    it('Invariant: changedFiles is leeg precies als beide lijsten gelijk zijn, en noemt elk verschillend pad één keer', () => {
        const list = fc.dictionary(fc.constantFrom('a.js', 'b.js', 'src/c.js', 'web/d.html'), fc.constantFrom('h1', 'h2'));
        fc.assert(fc.property(list, list, (a, b) => {
            const changed = changedFiles(a, b);
            const expected = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(f => a[f] !== b[f]).sort();
            expect(changed).toEqual(expected);
            expect(changed.length === 0).toBe(JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()));
        }));
    });
});

describe('de code bij ontgrendelen controleren', () => {
    it('Given een aangepast tray-script When Vaultgate start en ontgrendelt Then weigert het met code-changed en noemt het het bestand', async () => {
        const p = place();
        const first = p.open(p.snap());
        await first.create({ passphrase: PASS });
        const value = fakeSecret('integrity');
        const id = await first.put({ value });
        first.lock();

        fs.writeFileSync(path.join(p.install, TRAY), "exit [KsTray]::Run('always')\n");
        const later = await reopen(p, p.snap());
        const error = await later.unlockWithPassphrase(PASS).catch(e => e);
        expect(error.code).toBe(CODE_CHANGED);
        expect(error.rule).toBe('code-changed');
        expect(error.files).toEqual([TRAY]);
        expect(error.message).toContain(TRAY);
        expect(error.message).not.toContain(value);
        expect(later.isUnlocked()).toBe(false);
        expect(later.internalKeyForTest()).toBeNull();
        expect(later.status().codeChanged).toEqual([TRAY]);
        await expect(later.get(id)).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
    });

    it('Given een afwijking When de gebruiker bevestigt Then opent de kluis, en daarna is de nieuwe code de geldige', async () => {
        const p = place();
        const original = p.snap();
        const first = p.open(original);
        await first.create({ passphrase: PASS });
        first.lock();

        fs.appendFileSync(path.join(p.install, TRAY), '\n# een update\n');
        const updated = p.snap();
        const accepted = await reopen(p, updated);
        expect(await accepted.unlockWithPassphrase(PASS, { acceptCodeChange: true })).toContain('code-change-accepted');
        expect(accepted.status().codeChanged).toEqual([]);
        accepted.lock();

        expect(await (await reopen(p, updated)).unlockWithPassphrase(PASS)).toContain('code-unchanged');
        // Terug naar de oude code is ook een wijziging.
        const back = await reopen(p, original);
        await expect(back.unlockWithPassphrase(PASS)).rejects.toMatchObject({ code: CODE_CHANGED, files: [TRAY] });
    });

    it('Given dezelfde code When herstarten en ontgrendelen Then geen vals alarm', async () => {
        const p = place();
        const first = p.open(p.snap());
        await first.create({ passphrase: PASS });
        first.lock();
        for (let i = 0; i < 2; i++) {
            const again = await reopen(p, p.snap());
            expect(await again.unlockWithPassphrase(PASS)).toContain('code-unchanged');
            await again.put({ n: i }); // een gewone wijziging houdt de lijst
            again.lock();
        }
    });

    it('Given een kluis zonder lijst (van vóór deze controle) When ontgrendelen Then open en vastgelegd; daarna beschermd', async () => {
        const p = place();
        const old = p.open(undefined);
        await old.create({ passphrase: PASS });
        old.lock();
        expect(JSON.parse(fs.readFileSync(path.join(p.dir, 'vault.json'), 'utf8')).code).toBeUndefined();

        expect(await (await reopen(p, p.snap())).unlockWithPassphrase(PASS)).toContain('code-first-seen');
        fs.appendFileSync(path.join(p.install, 'web', 'portal', 'index.html'), '<!-- -->');
        await expect((await reopen(p, p.snap())).unlockWithPassphrase(PASS)).rejects.toMatchObject({ code: CODE_CHANGED, files: ['web/portal/index.html'] });
    });

    it('Given een kluis met alleen passkeys When ontgrendelen met PRF na een wijziging Then geweigerd, na bevestiging open', async () => {
        const p = place();
        const prf = () => Buffer.alloc(32, 7);
        const first = p.open(p.snap());
        await first.createWithPasskey({ credential: { id: 'cred-1', publicKey: 'pk' }, prfOutput: prf() });
        first.lock();
        fs.appendFileSync(path.join(p.install, TRAY), '\n');
        const later = await reopen(p, p.snap());
        await expect(later.unlockWithPrf({ credentialId: 'cred-1', prfOutput: prf() })).rejects.toMatchObject({ code: CODE_CHANGED });
        expect(await later.unlockWithPrf({ credentialId: 'cred-1', prfOutput: prf(), acceptCodeChange: true })).toContain('code-change-accepted');
    });

    it('Given een afwijking When herstellen met de herstelcode Then geldt dezelfde controle', async () => {
        const p = place();
        const first = p.open(p.snap());
        const { recoveryCode } = await first.create({ passphrase: PASS });
        first.lock();
        fs.appendFileSync(path.join(p.install, TRAY), '\n');
        const later = await reopen(p, p.snap());
        await expect(later.recover({ recoveryCode, newPassphrase: 'nieuw' })).rejects.toMatchObject({ code: CODE_CHANGED });
        await expect(later.recover({ recoveryCode, newPassphrase: 'nieuw', acceptCodeChange: true })).resolves.toHaveProperty('recoveryCode');
    });

    it('MOET weigeren: de vastgelegde lijst weghalen, vervangen of uit een andere kluis halen (VAULT_TAMPERED, niet stil opnieuw vastleggen)', async () => {
        const p = place();
        const first = p.open(p.snap());
        await first.create({ passphrase: PASS });
        first.lock();
        const other = place();
        const second = other.open(other.snap());
        await second.create({ passphrase: PASS });
        second.lock();

        const file = path.join(p.dir, 'vault.json');
        const original = JSON.parse(fs.readFileSync(file, 'utf8'));
        const foreign = JSON.parse(fs.readFileSync(path.join(other.dir, 'vault.json'), 'utf8')).code;
        expect(typeof original.code).toBe('string');
        expect(original.code).not.toContain(TRAY); // versleuteld: ook de bestandsnamen staan niet open
        for (const code of [undefined, foreign, `${original.code.slice(0, -4)}AAAA`]) {
            fs.writeFileSync(file, JSON.stringify({ ...original, code }));
            const vault = await reopen(p, p.snap());
            await expect(vault.unlockWithPassphrase(PASS)).rejects.toMatchObject({ code: VAULT_TAMPERED });
            expect(vault.isUnlocked()).toBe(false);
        }
    });
});
