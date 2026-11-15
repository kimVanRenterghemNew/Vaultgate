// De helper van een gekoppelde tool (`key --name`, git credential helper): de opgeslagen lange sleutel inwisselen bij de
// proxy (`POST /device/exchange`) voor een token van 10 minuten en een nieuwe lange sleutel. Eerst de nieuwe sleutel
// bewaren (atomair, versleuteld), dan pas het token teruggeven. Een slot per tool zorgt dat twee helpers tegelijk na
// elkaar uitwisselen: anders overschrijft de ene de sleutel van de andere en lijkt dat een gestolen kopie. Draait in het
// proces van de tool, niet in de proxy.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tagged, local } from './client.js';
import { savedKeyPath, readSavedKey, saveKey, savedProxy } from './key-file.js';

export const DEFAULT_PROXY = 'http://127.0.0.1:8484';
/** Een slot ouder dan dit is achtergebleven (de uitwisseling wacht hoogstens de goedkeurings-time-out, max. 10 min). */
const STALE_MS = 11 * 60_000;

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** Een slot dat van een gestopt proces is of te oud: weg ermee. */
function staleLock(file) {
    try {
        const pid = Number(fs.readFileSync(file, 'utf8'));
        return !Number.isSafeInteger(pid) || pid <= 0 || !alive(pid) || Date.now() - fs.statSync(file).mtimeMs > STALE_MS;
    } catch {
        return false; // net weg of nog niet geschreven: opnieuw proberen
    }
}

async function withLock(file, work) {
    for (;;) {
        try {
            fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (staleLock(file)) fs.rmSync(file, { force: true });
            else await delay(25);
        }
    }
    try { return await work(); } finally { fs.rmSync(file, { force: true }); }
}

/**
 * Wisselt de opgeslagen key van `name` in; geeft het token terug. `proxy` (de vlag) wint van het adres in het bestand.
 * @param {{ home: string, name: string, proxy?: string, protector: object|null, fetchImpl?: typeof fetch, t?: Function }} options
 */
export async function rotateSavedKey({ home, name, proxy = null, protector, fetchImpl = fetch, t = k => k }) {
    const file = savedKeyPath(home, name);
    const readFile = f => fs.readFileSync(f, 'utf8');
    const writeFile = (f, text) => fs.writeFileSync(f, text, { mode: 0o600 });
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); // het slot staat naast het bestand; zonder key volgt NO_SAVED_KEY
    return withLock(`${file}.lock`, async () => {
        const key = readSavedKey({ home, name, readFile, writeFile, protector, t });
        const base = (proxy ?? savedProxy(readFile(file)) ?? DEFAULT_PROXY).replace(/\/$/, '');
        const res = await fetchImpl(`${base}/device/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool_key: key }) });
        const body = await res.json().catch(() => ({}));
        const failed = rule => tagged('KEY_EXCHANGE_FAILED', local(t, 'cli.key.exchangeFailed', 'Vaultgate refused the key exchange: {rule}', { rule }));
        if (res.status !== 200) throw failed(body.rule ?? res.status);
        if (!/^ks_[A-Za-z0-9_-]{20,}$/.test(body.key ?? '') || !/^ks_[A-Za-z0-9_-]{20,}$/.test(body.token ?? '')) throw failed('bad-response');
        saveKey({ home, name, key: body.key, protector, proxy: base, t });
        return body.token;
    });
}
