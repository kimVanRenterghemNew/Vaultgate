// Het portaal in een eigen, afgeschermd venster. Edge in app-modus met
// een eigen profiel onder de Vaultgate-map, extensies en sync uit: niets te installeren (Edge is door Microsoft ondertekend
// en staat op elke Windows 11), dus geen werk voor Defender of AppLocker. Zo deelt het portaal niets met het gewone
// browserprofiel van de gebruiker (extensies, cookies, synchronisatie). TLS op localhost is geen optie (beslissing van de product owner).
import nodeFs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

export const NO_BROWSER = 'NO_BROWSER';

/** Mogelijke browsers per platform in voorkeursvolgorde: Edge, Chrome, Brave, Vivaldi, Chromium, Firefox. */
export function candidateBrowsers({ platform = process.platform, env = process.env } = {}) {
    if (platform === 'win32') {
        return [
            ['edge', env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
            ['edge', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
            ['chrome', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')],
            ['chrome', env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')],
            ['chrome', env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')],
            ['brave', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')],
            ['brave', env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')],
            ['vivaldi', env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe')],
            ['vivaldi', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Vivaldi', 'Application', 'vivaldi.exe')],
            ['chromium', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Chromium', 'Application', 'chrome.exe')],
            ['chromium', env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe')],
            ['firefox', env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Mozilla Firefox', 'firefox.exe')],
            ['firefox', env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Mozilla Firefox', 'firefox.exe')],
        ];
    }
    if (platform === 'darwin') {
        return [
            ['edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
            ['chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
            ['brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
            ['vivaldi', '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
            ['chromium', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
            ['firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'],
        ];
    }
    return [
        ['edge', '/usr/bin/microsoft-edge-stable'],
        ['edge', '/usr/bin/microsoft-edge'],
        ['chrome', '/usr/bin/google-chrome-stable'],
        ['chrome', '/usr/bin/google-chrome'],
        ['brave', '/usr/bin/brave-browser'],
        ['brave', '/usr/bin/brave'],
        ['vivaldi', '/usr/bin/vivaldi-stable'],
        ['vivaldi', '/usr/bin/vivaldi'],
        ['chromium', '/usr/bin/chromium'],
        ['chromium', '/usr/bin/chromium-browser'],
        ['firefox', '/usr/bin/firefox'],
    ];
}

/** Edge eerst (overal aanwezig), dan Chrome, Brave, Vivaldi, Chromium, Firefox; of de opgegeven voorkeur. */
export function findBrowser({ preference, platform = process.platform, env = process.env, exists = nodeFs.existsSync } = {}) {
    const all = candidateBrowsers({ platform, env });
    const candidates = preference ? all.filter(([kind]) => kind === String(preference).toLowerCase()) : all;
    const found = candidates.find(([, p]) => p && exists(p));
    if (!found) throw Object.assign(new Error(preference ? `no ${preference} found to open the portal window` : 'no Edge or Chrome found to open the portal window'), { code: NO_BROWSER });
    return { path: found[1], kind: found[0] };
}

/** De argumenten van het venster; alleen voor het lokale portaal (RP-id `localhost`). */
export function windowArgs({ url, profileDir, kind = 'edge' }) {
    if (!/^http:\/\/localhost:\d+\/?/.test(url)) throw new Error(`the portal window only opens http://localhost:<port>, not ${url}`);
    if (kind === 'firefox') {
        return ['-profile', profileDir, '-no-remote', url];
    }
    return [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        '--window-size=1280,860', // past rond de tegel van het welkom
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-features=msEdgeSidebarV2,msShoppingAssistant,Translate',
    ];
}

/** Extensies in het eigen profiel (bv. door groepsbeleid afgedwongen, die `--disable-extensions` negeren). */
export function unexpectedExtensions(profileDir, fsImpl = nodeFs) {
    const dir = path.join(profileDir, 'Default', 'Extensions');
    if (!fsImpl.existsSync(dir)) return [];
    return fsImpl.readdirSync(dir).filter(name => /^[a-p]{32}$/.test(name));
}

/** Start het venster los van het proces. Meldt extensies die bij een vorige start in het profiel kwamen. */
export function openPortalWindow({ url, home, preference, platform, env, exists, fsImpl = nodeFs, spawn = nodeSpawn, log = () => {} }) {
    // De testomgeving (test/setup/isolate.js) zet dit, ook voor elk proces dat een test start: nooit een venster op een testkluis.
    if ((env ?? process.env).VAULTGATE_WINDOW === 'none') return { browser: 'none', extensions: [] };
    const browser = findBrowser({ preference, platform, env, exists });
    const profileDir = path.join(home, 'portal-profile');
    fsImpl.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const extensions = unexpectedExtensions(profileDir, fsImpl);
    if (extensions.length) log({ event: 'portal-window-extensions', count: extensions.length });
    const child = spawn(browser.path, windowArgs({ url, profileDir, kind: browser.kind }), { detached: true, stdio: 'ignore' });
    child.on?.('error', error => log({ event: 'portal-window-failed', code: error.code ?? 'unknown' }));
    child.unref?.();
    return { browser: browser.kind, extensions };
}
