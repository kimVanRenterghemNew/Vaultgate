// Screenshots van alle mockups (docs/mockups/*.html) en van elke handeling in een scherm, naar
// docs/mockups/screenshots/<thema>/<mockup>--<toestand>.png, met een overzicht in docs/mockups/screenshots/README.md.
// De toestanden komen uit de pagina zelf: `data-open` (een dialoog, id = naam), `data-group`/`data-pick` (een keuze;
// binnen een dialoog samen met die dialoog), `data-selects`/`data-select` (een rij in een lijst met detail), en voor de welkom-flow een vaste lijst (stappen, keuzes, dialoog).
// Gebruikt de geïnstalleerde Edge (zoals de mockups zelf getest worden), of PW_CHANNEL.
//
//   node docs/probes/mockup-screenshots.mjs                  beide thema's
//   node docs/probes/mockup-screenshots.mjs --theme dracula  een thema
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCKUPS = path.join(ROOT, 'docs', 'mockups');
const OUT = path.join(MOCKUPS, 'screenshots');
const { values: args } = parseArgs({ options: { theme: { type: 'string' } } });
const THEMES = args.theme ? [args.theme] : ['dracula', 'console-light'];
// Doorverwijzingen en het overzicht zelf zijn geen scherm.
const SKIP = new Set(['index.html', '03a-virtuele-key-web-review.html', '03b-virtuele-key-mcp-review.html', '10-koppelen.html']);

/** De toestanden van een geopende mockup: [naam, query]. */
async function statesOf(page, file) {
    if (file === '00-welcome-flow.html') {
        return [['1-welcome', '?step=1'], ['2-unlock', '?step=2'], ['2-prf-missing', '?step=2&prf=missing'], ['2-sqrl', '?step=2&dialog=sqrl'],
            ['3-auto', '?step=3'], ['3-manual', '?step=3&way=manual'], ['3-mcp', '?step=3&kind=mcp'], ['4-done', '?step=4']];
    }
    const found = await page.evaluate(() => {
        const doc = globalThis.document;
        const dialogs = [...new Set([...doc.querySelectorAll('[data-open]')].map(el => el.dataset.open))].filter(id => doc.getElementById(id)?.tagName === 'DIALOG');
        const picks = [];
        const defaults = {};
        for (const el of doc.querySelectorAll('[data-group][data-pick]')) {
            const { group, pick } = el.dataset;
            defaults[group] ??= pick;
            picks.push({ group, pick, dialog: el.closest('dialog')?.id ?? null });
        }
        const selects = [...doc.querySelectorAll('[data-selects]')].flatMap(list => [...list.querySelectorAll('[data-select]')].slice(1).map(r => ({ list: list.dataset.selects, id: r.dataset.select })));
        return { dialogs, picks, defaults, selects };
    });
    const states = [['default', '']];
    for (const d of found.dialogs) states.push([d, `?dialog=${d}`]);
    for (const { group, pick, dialog } of found.picks) {
        if (pick === found.defaults[group] && !dialog) continue;
        const query = dialog ? `?dialog=${dialog}&${group}=${pick}` : `?${group}=${pick}`;
        const name = dialog ? `${dialog}-${group}-${pick}` : `${group}-${pick}`;
        if (!states.some(([, q]) => q === query)) states.push([name, query]);
    }
    for (const { list, id } of found.selects) states.push([`${list}-${id}`, `?${list}=${id}`]);
    return states;
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const files = fs.readdirSync(MOCKUPS).filter(f => f.endsWith('.html') && !SKIP.has(f)).sort();
const rows = [];
let missing = 0;
for (const theme of THEMES) {
    const dir = path.join(OUT, theme);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) {
        const url = pathToFileURL(path.join(MOCKUPS, file)).href;
        await page.goto(`${url}?theme=${theme}`);
        for (const [state, query] of await statesOf(page, file)) {
            const sep = query ? '&' : '?';
            await page.goto(`${url}${query}${sep}theme=${theme}`);
            await page.waitForTimeout(400);
            const name = `${file.replace(/\.html$/, '')}--${state}.png`;
            const screen = page.locator('.screen:visible').first();
            const target = (await screen.count()) ? screen : page;
            await target.screenshot({ path: path.join(dir, name) });
            const ok = fs.existsSync(path.join(dir, name));
            if (!ok) missing += 1;
            rows.push({ theme, file, state, name, ok });
        }
        process.stdout.write(`${theme} ${file}: ${rows.filter(r => r.theme === theme && r.file === file).length} states\n`);
    }
}
await browser.close();

const lines = ['# Screenshots van de mockups', '', 'Gemaakt met `node docs/probes/mockup-screenshots.mjs`. Per mockup de begintoestand, elke dialoog en elke keuze.', ''];
for (const theme of THEMES) {
    lines.push(`## ${theme}`, '', '| mockup | toestand | screenshot |', '|---|---|---|');
    for (const r of rows.filter(x => x.theme === theme)) lines.push(`| ${r.file} | ${r.state} | [${r.name}](${theme}/${r.name}) |`);
    lines.push('');
}
fs.writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'));
process.stdout.write(`\n${rows.length} screenshots in ${path.relative(ROOT, OUT)}; missing: ${missing}; page errors: ${errors.length}\n`);
for (const e of errors) process.stdout.write(`  js error: ${e}\n`);
process.exit(missing || errors.length ? 1 : 0);
