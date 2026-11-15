// Het watch-deel van `npm run demo:watch`: de portaal-UI en -CSS opnieuw bouwen bij een wijziging, en melden wanneer
// Vaultgate moet herstarten (een bron in src/ of een gebouwd portaalbestand veranderde echt van inhoud).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** esbuild (in-process) en tailwind (--watch) bouwen bij elke wijziging opnieuw. */
export async function startBuilders(ROOT) {
    const esbuild = await import('esbuild');
    const bundle = (entry, outfile) => esbuild.context({
        entryPoints: [path.join(ROOT, entry)],
        outfile: path.join(ROOT, outfile),
        bundle: true,
        format: 'iife',
        loader: { '.html': 'text' },
        charset: 'utf8',
        logLevel: 'info',
    });
    const contexts = await Promise.all([
        bundle('web/portal/index.js', 'web/portal/portal.generated.js'),
        bundle('web/portal/touch/index.js', 'web/portal/touch.generated.js'),
    ]);
    // Eerst één keer bouwen, zodat Vaultgate meteen met verse bundels start.
    await Promise.all(contexts.map(ctx => ctx.rebuild()));
    await Promise.all(contexts.map(ctx => ctx.watch()));

    // stdin als pipe: tailwind stopt vanzelf als dit proces wegvalt.
    // --minify zoals build:css, anders verschilt de eerste watch-build van de bestaande CSS en volgt een nodeloze herstart.
    const tailwind = spawn('npx tailwindcss -i web/portal/portal.css -o web/portal/portal.generated.css --minify --watch', {
        cwd: ROOT, shell: true, stdio: ['pipe', 'inherit', 'inherit'],
    });

    return {
        async stop() {
            await Promise.all(contexts.map(ctx => ctx.dispose()));
            tailwind.stdin.end();
            tailwind.kill();
        },
    };
}

/**
 * Bekijkt src/ en de gebouwde portaalbestanden en roept `onChange(reden)` (na 250 ms rust) als de inhoud echt veranderde.
 * Geeft een functie terug om te stoppen.
 */
export function watchSources(ROOT, onChange) {
    const PORTAL_DIR = path.join(ROOT, 'web', 'portal');
    const SRC = path.join(ROOT, 'src');
    const GENERATED = ['portal.generated.js', 'touch.generated.js', 'portal.generated.css'];
    const hash = file => {
        try { return createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
        catch { return null; /* weg, of een map */ }
    };
    // Alleen herstarten als de inhoud echt veranderde. Op Windows meldt fs.watch ook louter lezen (last-access):
    // de tray leest bij het starten windows-tray.ps1 en Popup.cs, wat anders een herstart na elke herstart gaf.
    // Ook esbuild en tailwind schrijven bij hun eerste build dezelfde inhoud opnieuw weg.
    const seen = new Map();
    for (const entry of fs.readdirSync(SRC, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) { const file = path.join(entry.parentPath, entry.name); seen.set(file, hash(file)); }
    }
    for (const name of GENERATED) { const file = path.join(PORTAL_DIR, name); seen.set(file, hash(file)); }
    const changed = file => {
        const h = hash(file);
        if (h === (seen.get(file) ?? null)) return false;
        seen.set(file, h);
        return true;
    };

    let timer = null;
    const trigger = reason => {
        clearTimeout(timer);
        timer = setTimeout(() => onChange(reason), 250);
    };
    const watchers = [
        fs.watch(SRC, { recursive: true }, (_, name) => {
            if (!name) return;
            const file = path.join(SRC, name);
            if (changed(file)) trigger(path.relative(ROOT, file));
        }),
        fs.watch(PORTAL_DIR, (_, name) => {
            if (!GENERATED.includes(name)) return;
            const file = path.join(PORTAL_DIR, name);
            if (changed(file)) trigger(path.relative(ROOT, file));
        }),
    ];
    return () => { clearTimeout(timer); for (const w of watchers) w.close(); };
}
