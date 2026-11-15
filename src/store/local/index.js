// Lokale store: een map op schijf. Schrijven is atomisch (tijdelijk bestand + fsync + rename in dezelfde map), zodat een
// crash nooit een half bestand op de plaats van een goed bestand zet. Een kapot bestand wordt nooit stil vervangen: de
// kluis zet het in quarantaine.
import fs from 'fs/promises';
import path from 'path';
import { checkName, quarantineName } from '../index.js';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Windows: een rename naar een bestand dat net open is (andere rename, virusscanner, indexer) geeft kort EPERM/EBUSY. */
async function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fs.rename(from, to);
        } catch (error) {
            if (!RETRYABLE.has(error.code) || attempt >= 20) throw error;
            await pause(5 * (attempt + 1));
        }
    }
}

export function createLocalStore({ dir }) {
    let seq = 0;
    const full = name => path.join(dir, ...checkName(name).split('/'));
    // Schrijfacties op dezelfde naam na elkaar: de laatste write wint, en twee renames botsen niet.
    const queues = new Map();
    const serialized = (name, task) => {
        const run = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task);
        queues.set(name, run);
        run.finally(() => { if (queues.get(name) === run) queues.delete(name); }).catch(() => {});
        return run;
    };

    async function ensureDir(file) {
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    }

    const write = async (name, data) => serialized(checkName(name), () => writeNow(name, data));
    const append = async (name, data) => serialized(checkName(name), () => appendNow(name, data));

    async function writeNow(name, data) {
        const target = full(name);
        await ensureDir(target);
        const tmp = `${target}.${process.pid}.${seq++}.tmp`;
        const handle = await fs.open(tmp, 'w', 0o600);
        try {
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await renameWithRetry(tmp, target);
    }

    async function appendNow(name, data) {
        const target = full(name);
        await ensureDir(target);
        const handle = await fs.open(target, 'a', 0o600);
        try {
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    async function read(name) {
        try {
            return await fs.readFile(full(name));
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    async function list(prefix) {
        const results = [];
        async function walk(rel) {
            let entries;
            try {
                entries = await fs.readdir(path.join(dir, ...rel.split('/').filter(Boolean)), { withFileTypes: true });
            } catch (error) {
                if (error.code === 'ENOENT') return;
                throw error;
            }
            for (const entry of entries) {
                const name = rel ? `${rel}/${entry.name}` : entry.name;
                if (entry.isDirectory()) await walk(name);
                else if (!entry.name.endsWith('.tmp')) results.push(name);
            }
        }
        await walk('');
        return results.filter(name => name.startsWith(prefix)).sort();
    }

    async function remove(name) {
        await fs.rm(full(name), { force: true });
    }

    async function quarantine(name) {
        const target = quarantineName(name, `${Date.now()}-${seq++}`);
        const to = full(target);
        await ensureDir(to);
        await renameWithRetry(full(name), to);
        return target;
    }

    return Object.freeze({ read, write, append, list, remove, quarantine });
}
