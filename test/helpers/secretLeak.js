/**
 * The central guarantee of Vaultgate: a secret value never appears in anything a tool, a model, a log or the
 * portal can see. Every journey test creates its secrets with `fakeSecret()` and ends with `findLeaks(...)` over
 * everything it captured (responses, headers, logs, audit, portal HTML, files on disk).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** A unique, recognizable value that cannot occur by accident. */
export const fakeSecret = (label = 'secret') => `FAKE-${label}-${crypto.randomBytes(12).toString('hex')}`;

/** Common encodings a service might echo a value in (scrubbing must cover them too). */
export const encodings = (value) => [value, Buffer.from(value).toString('base64'), encodeURIComponent(value), Buffer.from(value).toString('hex')];

/**
 * @param {Record<string, string|Buffer>} captured  name -> captured text (response body, log file, html, ...)
 * @param {string[]} secrets  values that must not appear
 * @returns {string[]} where a secret leaked, e.g. "audit.log: FAKE-github… (base64)" - never the full value
 */
export function findLeaks(captured, secrets) {
    const leaks = [];
    for (const [where, content] of Object.entries(captured)) {
        const text = Buffer.isBuffer(content) ? content.toString('latin1') : String(content ?? '');
        for (const secret of secrets) {
            const names = ['plain', 'base64', 'url', 'hex'];
            // An encoding identical to an earlier form (e.g. URL-encoding of a plain [A-Za-z0-9-] value) is one leak, not two.
            const seen = new Set();
            encodings(secret).forEach((form, i) => {
                if (seen.has(form)) return;
                seen.add(form);
                if (text.includes(form)) leaks.push(`${where}: ${secret.slice(0, 12)}… (${names[i]})`);
            });
        }
    }
    return leaks;
}

/**
 * Every regular file under `dir` (path -> content), to search with `findLeaks`. Sockets, pipes and devices are skipped:
 * on Linux the tray socket lives in the home directory, and opening it gives ENXIO.
 * @param {string} dir
 * @returns {Record<string, Buffer>}
 */
export function readTree(dir, out = {}) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) readTree(full, out);
        else if (entry.isFile()) out[full] = fs.readFileSync(full);
    }
    return out;
}
