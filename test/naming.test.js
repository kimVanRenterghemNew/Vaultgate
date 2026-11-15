// De productnaam is Vaultgate. Een bestaande installatie onder de oude naam wordt bij de start overgenomen (map, en
// een overgangsperiode voor de oude omgevingsvariabelen; de oude headers werken niet meer); buiten de ene migratiemodule
// (src/legacy-name) en de historische documentatie staat de oude naam nergens meer.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHome, legacyHome, LEGACY_ENV } from '../src/legacy-name/index.js';
import { tempHome, seedVault, MAIN, PASSPHRASE } from './helpers/journey.js';
import { startUpstream } from './helpers/fakeUpstream.js';
import { fakeSecret } from './helpers/secretLeak.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = /kura/i;

/** Een nep-gebruikersprofiel: APPDATA en de thuismap wijzen naar een tijdelijke map. */
const profile = () => {
    const dir = tempHome();
    return { dir, platform: process.platform, env: { APPDATA: dir }, homedir: dir };
};
const writeTree = (dir, files) => Object.entries(files).forEach(([name, body]) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
});
const readTree = dir => Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => [path.relative(dir, path.join(e.parentPath, e.name)).replace(/\\/g, '/'), fs.readFileSync(path.join(e.parentPath, e.name), 'utf8')]));

describe('de oude map wordt overgenomen', () => {
    const files = { 'vault/header.json': 'ingepakte sleutels', 'vault/records.bin': 'versleuteld', 'clients/mytool.key': 'ks_x' };

    it('Given een installatie in de oude map en geen nieuwe When de server start Then staat alles onveranderd in de nieuwe map en is de oude weg', () => {
        const p = profile();
        writeTree(legacyHome(p), files);
        const { home, migrated } = resolveHome({ ...p, move: true });
        expect(path.basename(home)).toMatch(/^\.?vaultgate$/);
        expect(migrated).toBe(true);
        expect(readTree(home)).toEqual(files);
        expect(fs.existsSync(legacyHome(p))).toBe(false);
    });

    it('Given beide mappen When de server start Then wint de nieuwe en blijft de oude onaangeroerd', () => {
        const p = profile();
        writeTree(legacyHome(p), files);
        const target = path.join(path.dirname(legacyHome(p)), process.platform === 'win32' ? 'vaultgate' : '.vaultgate');
        writeTree(target, { 'vault/header.json': 'nieuw' });
        expect(resolveHome({ ...p, move: true })).toMatchObject({ home: target, migrated: false });
        expect(readTree(legacyHome(p))).toEqual(files);
    });

    it('Given alleen de oude map When een CLI-commando (key, login) Then leest het uit de oude map zonder te verplaatsen', () => {
        const p = profile();
        writeTree(legacyHome(p), files);
        expect(resolveHome({ ...p, move: false })).toMatchObject({ home: legacyHome(p), migrated: false });
        expect(readTree(legacyHome(p))).toEqual(files);
    });

    it('Given een verplaatsing die faalt (map in gebruik) When de server start Then gebruikt hij de oude map: niets verloren', () => {
        const p = profile();
        writeTree(legacyHome(p), files);
        const failing = { ...fs, renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); } };
        expect(resolveHome({ ...p, move: true, fs: failing })).toMatchObject({ home: legacyHome(p), migrated: false, error: 'EPERM' });
        expect(readTree(legacyHome(p))).toEqual(files);
    });

    it('Given --home, VAULTGATE_HOME of de oude variabele When de map gekozen wordt Then die, zonder migratie, in die volgorde', () => {
        const p = profile();
        writeTree(legacyHome(p), files);
        const legacyVar = LEGACY_ENV.VAULTGATE_HOME;
        expect(resolveHome({ ...p, arg: '/a', env: { VAULTGATE_HOME: '/b', [legacyVar]: '/c' }, move: true }).home).toBe('/a');
        expect(resolveHome({ ...p, env: { VAULTGATE_HOME: '/b', [legacyVar]: '/c' }, move: true }).home).toBe('/b');
        expect(resolveHome({ ...p, env: { [legacyVar]: '/c' }, move: true }).home).toBe('/c');
        expect(fs.existsSync(legacyHome(p))).toBe(true);
    });

    it('Given niets bestaand When de server start Then de nieuwe standaardmap', () => {
        const p = profile();
        expect(resolveHome({ ...p, move: true })).toMatchObject({ migrated: false });
        expect(path.basename(resolveHome({ ...p, move: true }).home)).toMatch(/^\.?vaultgate$/);
    });
});

describe('journey: een bestaande installatie start onder de nieuwe naam', () => {
    let proc;
    let upstream;
    afterAll(async () => { if (proc && proc.exitCode === null) proc.kill(); await upstream?.close(); });

    it('Given een kluis in de oude standaardmap When het echte proces start zonder --home Then is de map overgenomen, ontgrendelt de kluis, werkt de nieuwe tool-key-header en wordt de oude geweigerd', async () => {
        const p = profile();
        const value = fakeSecret('naming');
        upstream = await startUpstream((req, res) => { res.writeHead(200); res.end('ok'); });
        const { key } = await seedVault(legacyHome(p), async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return tool;
        });
        const env = { ...process.env, APPDATA: p.dir, HOME: p.dir, USERPROFILE: p.dir };
        for (const name of ['VAULTGATE_HOME', ...Object.values(LEGACY_ENV)]) delete env[name];
        proc = spawn(process.execPath, [MAIN, '--proxy-port', '0', '--portal-port', '0', '--unlock-stdin', '--tray', 'none', '--window', 'none'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stdin.write(`${PASSPHRASE}\n`);
        let out = '';
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { out += d; });
        const events = () => out.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
        const deadline = Date.now() + 15_000;
        while (!events().some(e => e.event === 'ready' || e.event === 'fatal') && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        const ready = events().find(e => e.event === 'ready');
        expect(ready, out).toBeDefined();
        expect(ready.unlocked).toBe(true);
        expect(path.basename(ready.home)).toMatch(/^\.?vaultgate$/);
        expect(fs.existsSync(legacyHome(p))).toBe(false);
        expect(events().find(e => e.event === 'home-migrated')).toMatchObject({ to: ready.home });

        const call = headers => fetch(`http://127.0.0.1:${ready.proxyPort}/forward/${upstream.origin}/x`, { headers: { ...headers, authorization: 'Bearer {{secret:demo}}' } });
        const res = await call({ 'x-vault-gate-tool-key': key });
        expect(res.status).toBe(200);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
        expect(upstream.requests.at(-1).headers['x-vault-gate-tool-key']).toBeUndefined(); // de tool-key gaat nooit naar de doelhost

        // De oude header werkt niet meer : geen oude headers meer. MOET weigeren.
        const seen = upstream.requests.length;
        const refused = await call({ 'x-kura-tool-key': key });
        expect(refused.status).not.toBe(200);
        expect(upstream.requests).toHaveLength(seen);
        expect(out).not.toContain(value);
    }, 30_000);
});

// ---- de oude naam nergens meer -------------------------------------------------------------------------------------

/** Bestanden waar de oude naam mag staan, met de reden. */
const ALLOWED = [
    [/^[b]acklog\//, 'intern werkkader (tekenklasse: zo telt deze regel niet als verwijzing in de export)'],
    [/^docs\/([v]oorcoder\.md|review-[^/]*\.md|[s]pikes\/|ux-waw\.md|security-audit-[^/]*\.md)/, 'historische documentatie (berichten, reviews, verkenningen)'],
    [/^docs\/mockups\/(review 2026 10 15.*\.md|review-v19\.md|Vaultgate {2}security-vragen beantwoord met de code\.md)$/, 'historische mockup-reviews'],
    [/^CLAUDE\.md$/, 'werkwijze voor agents, verwijst naar de herkomst van de werkwijze'],
    [/^src\/legacy-name\//, 'de enige migratiemodule: oude map en variabelen'],
    [/^test\/naming\.test\.js$/, 'deze test'],
    [/^test\/scripts\/releaseExport\.test\.js$/, 'bewaker die verwijzingen naar het vorige werkkader in de export weigert'],
    [/^src\/policy\/public-suffix-list\.dat$/, 'externe lijst (Mozilla) met echte domeinnamen'],
];
const BINARY = /\.(png|ico|jpg|jpeg|gif|woff2?|pdf|zip)$/i;

/** Regels met de oude naam in `files` (pad -> inhoud), buiten de toegelaten bestanden. */
const offenders = (files, read) => files
    .filter(f => !BINARY.test(f) && !ALLOWED.some(([re]) => re.test(f)))
    .flatMap(f => (OLD.test(f) ? [`${f} (pad)`] : []).concat(read(f).split('\n').flatMap((line, i) => (OLD.test(line) ? [`${f}:${i + 1}`] : []))));

describe('de oude naam staat nergens meer, behalve in de migratie', () => {
    it('geen enkel bestand van de repo (gevolgd of nieuw) noemt de oude naam', () => {
        const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split('\0').filter(f => f && fs.existsSync(path.join(ROOT, f)));
        expect(files.length).toBeGreaterThan(100);
        expect(offenders(files, f => fs.readFileSync(path.join(ROOT, f), 'utf8'))).toEqual([]);
    });

    it('MOET weigeren: de oude naam in code, een header, een pad of een variabele; toegelaten in de migratie en historische docs, niet in de gewone docs', () => {
        const text = {
            'src/a.js': "const h = 'x-KURA-tool-key';",
            'src/b.js': '// gewoon commentaar',
            'scripts/kura.mjs': '',
            'i18n/en.json': '"title": "Kura-secrets"',
            'src/legacy-name/index.js': "'kura-secrets'",
            'docs/ux-waw.md': 'Kura-regel',
            'docs/architecture.md': 'zoals in Kura',
        };
        expect(offenders(Object.keys(text), f => text[f])).toEqual(['src/a.js:1', 'scripts/kura.mjs (pad)', 'i18n/en.json:1', 'docs/architecture.md:1']);
    });
});
