/**
 * De vaultgate-MCP in agents met een TOML-config (Codex, Mistral Vibe), zonder TOML-bibliotheek: een blok achteraan
 * waarvan elke regel eindigt op `# vaultgate:mcp`, zodat uninstall precies die regels weghaalt en de rest byte-gelijk
 * blijft. Een entry die met de hand geschreven is, blijft staan (een tweede zou het bestand breken). Patroon van
 * lady-lens `core/mcp/tomlInstall.js`.
 *
 * @module mcp/install-toml
 */
import fs from 'node:fs';

const MARK = '# vaultgate:mcp';

// JSON-strings en arrays van strings zijn geldige TOML; een object wordt een inline table.
const toml = value => (typeof value === 'object' && !Array.isArray(value)
    ? `{ ${Object.entries(value).map(([key, item]) => `${key} = ${JSON.stringify(item)}`).join(', ')} }`
    : JSON.stringify(value));

/** Het blok voor `entry` ({ command, args, env? }) in het dialect 'codex' of 'vibe'. */
export function tomlBlock(dialect, entry) {
    const fields = { command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
    const head = dialect === 'vibe' ? ['[[mcp_servers]]', 'name = "vaultgate"', 'transport = "stdio"'] : ['[mcp_servers.vaultgate]'];
    return [...head, ...Object.entries(fields).map(([key, value]) => `${key} = ${toml(value)}`)].map(line => `${line}  ${MARK}`);
}

/** `text` zonder onze gemarkeerde regels (en de lege regel die we ervoor zetten). */
function without(text) {
    const kept = [];
    for (const line of text.split(/(?<=\n)/)) {
        if (!line.includes(MARK)) kept.push(line);
        else if (/^\r?\n$/.test(kept[kept.length - 1] ?? '')) kept.pop();
    }
    return kept.join('');
}

/** `text` met ons blok één keer achteraan, na een lege regel, in de regeleinden van het bestand. */
function withBlock(text, lines) {
    const rest = without(text);
    const eol = rest.includes('\r\n') ? '\r\n' : '\n';
    return `${rest}${rest && !rest.endsWith('\n') ? eol : ''}${rest ? eol : ''}${lines.join(eol)}${eol}`;
}

const byHand = text => /^\s*\[mcp_servers\.["']?vaultgate["']?\]|^\s*name\s*=\s*["']vaultgate["']/m.test(without(text));
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

export function tomlInstall(target, entry, dryRun, write) {
    const before = read(target.file);
    if (before !== null && byHand(before)) return { status: 'error', reason: 'vaultgate is already configured by hand; left as it is' };
    const after = withBlock(before ?? '', tomlBlock(target.toml, entry));
    if (after === before) return { status: 'unchanged' };
    if (!dryRun) write(target.file, after);
    return { status: before?.includes(MARK) ? 'updated' : 'installed' };
}

export function tomlUninstall(target, dryRun, write) {
    const before = read(target.file);
    if (before === null || !before.includes(MARK)) return { status: 'absent' };
    if (!dryRun) write(target.file, without(before));
    return { status: 'removed' };
}
