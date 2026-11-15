// Het portaal opent in een eigen, afgeschermd venster (Edge in app-modus met een eigen profiel zonder
// extensies). De starter is ingespoten: geen echt venster in de test.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { findBrowser, windowArgs, unexpectedExtensions, openPortalWindow, NO_BROWSER } from '../../src/window/index.js';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\k\\AppData\\Local' };

describe('afgeschermd portaalvenster', () => {
    it('kiest Edge (door Microsoft ondertekend, op elke Windows 11), anders Chrome, anders een getagde fout', () => {
        expect(findBrowser({ env, exists: p => p === EDGE || p === CHROME })).toEqual({ path: EDGE, kind: 'edge' });
        expect(findBrowser({ env, exists: p => p === CHROME })).toEqual({ path: CHROME, kind: 'chrome' });
        expect(() => findBrowser({ env, exists: () => false })).toThrow(expect.objectContaining({ code: NO_BROWSER }));
        expect(() => findBrowser({ env: {}, exists: () => true })).toThrow(expect.objectContaining({ code: NO_BROWSER }));
    });

    it('Given een voorkeur "brave" en Brave geïnstalleerd When findBrowser Then start Brave in app-modus met eigen profiel', () => {
        const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        expect(findBrowser({ preference: 'brave', env, exists: p => p === BRAVE || p === EDGE })).toEqual({ path: BRAVE, kind: 'brave' });
        expect(() => findBrowser({ preference: 'brave', env, exists: p => p === EDGE })).toThrow(expect.objectContaining({ code: NO_BROWSER }));
    });

    it('Given macOS When findBrowser Then zoekt op macOS-paden (/Applications/...)', () => {
        const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        expect(findBrowser({ platform: 'darwin', exists: p => p === MAC_CHROME })).toEqual({ path: MAC_CHROME, kind: 'chrome' });
    });

    it('Given Linux When findBrowser Then zoekt op Linux-paden (/usr/bin/...)', () => {
        const LINUX_BRAVE = '/usr/bin/brave-browser';
        expect(findBrowser({ platform: 'linux', exists: p => p === LINUX_BRAVE })).toEqual({ path: LINUX_BRAVE, kind: 'brave' });
    });

    it('Given Firefox When windowArgs Then gebruikt -profile en -no-remote zonder --app', () => {
        const args = windowArgs({ url: 'http://localhost:8485/', profileDir: '/ks/portal-profile', kind: 'firefox' });
        expect(args).toEqual(['-profile', '/ks/portal-profile', '-no-remote', 'http://localhost:8485/']);
    });

    it('argumenten: app-modus, eigen profiel in de Vaultgate-map, extensies/sync/first-run uit', () => {
        const args = windowArgs({ url: 'http://localhost:8485/', profileDir: 'C:\\ks\\portal-profile' });
        expect(args).toEqual(expect.arrayContaining(['--app=http://localhost:8485/', '--user-data-dir=C:\\ks\\portal-profile', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-sync']));
        // het venster past rond de tegel van het welkom (geen leeg kader eromheen)
        expect(args).toContain('--window-size=1280,860');
    });

    it('MOET weigeren: een URL die niet het lokale portaal is', () => {
        expect(() => windowArgs({ url: 'https://evil.example/', profileDir: 'x' })).toThrow(/localhost/);
        expect(() => windowArgs({ url: 'http://127.0.0.1:8485/', profileDir: 'x' })).toThrow(/localhost/); // WebAuthn-RP-id is localhost
    });

    it('extensies in het profiel worden gemeld (bv. door groepsbeleid afgedwongen)', () => {
        const dirs = { [path.join('P', 'Default', 'Extensions')]: ['bbcinlkgjjkejfdpemiealijmmooekmp', 'Temp'] };
        const fsImpl = { existsSync: p => p in dirs, readdirSync: p => dirs[p] };
        expect(unexpectedExtensions('P', fsImpl)).toEqual(['bbcinlkgjjkejfdpemiealijmmooekmp']);
        expect(unexpectedExtensions('Q', fsImpl)).toEqual([]);
    });

    it('VAULTGATE_WINDOW=none (de testomgeving): geen browser, ook niet in een proces dat een test start', () => {
        const started = [];
        const result = openPortalWindow({ url: 'http://localhost:8485/', home: 'C:/ks', env: { ...env, VAULTGATE_WINDOW: 'none' }, exists: p => p === EDGE,
            fsImpl: { existsSync: () => false, mkdirSync: () => { started.push('mkdir'); } }, spawn: () => { started.push('spawn'); return {}; } });
        expect(started).toEqual([]);
        expect(result).toEqual({ browser: 'none', extensions: [] });
    });

    it('openen: start de browser los van het proces, met het profiel onder home; meldt gevonden extensies', () => {
        const started = [];
        const logged = [];
        const result = openPortalWindow({
            url: 'http://localhost:8485/', home: 'C:\\ks', env, exists: p => p === EDGE,
            fsImpl: { existsSync: () => true, readdirSync: () => ['abcdefghijklmnopabcdefghijklmnop'], mkdirSync: () => {} },
            spawn: (cmd, args, opts) => { started.push({ cmd, args, opts }); return { unref: () => {}, on: () => {} }; },
            log: e => logged.push(e),
        });
        expect(started[0].cmd).toBe(EDGE);
        expect(started[0].args).toContain(`--user-data-dir=${path.join('C:\\ks', 'portal-profile')}`);
        expect(started[0].opts).toMatchObject({ detached: true, stdio: 'ignore' });
        expect(result).toMatchObject({ browser: 'edge', extensions: ['abcdefghijklmnopabcdefghijklmnop'] });
        expect(logged).toContainEqual({ event: 'portal-window-extensions', count: 1 });
    });
});

describe('"Portaal openen" in de tray', () => {
    it('opent het afgeschermde venster met de URL van het portaal (niet de standaardbrowser)', async () => {
        const { createApp } = await import('../../src/composition.js');
        const { tempHome, FAKE_TRAY } = await import('../helpers/journey.js');
        const opened = [];
        const events = [];
        const home = tempHome();
        const app = createApp({ home, proxyPort: 0, portalPort: 0, tray: { script: FAKE_TRAY }, trayEnv: { ...process.env, FAKE_TRAY_OPEN_PORTAL: '1' }, log: e => events.push(e),
            openWindow: args => { opened.push(args); return { browser: 'edge', extensions: [] }; } });
        const { portalPort } = await app.start();
        try {
            const t0 = Date.now();
            while (opened.length === 0 && Date.now() - t0 < 10_000) await new Promise(r => setTimeout(r, 20));
            expect(opened[0]).toMatchObject({ url: `http://localhost:${portalPort}/`, home });
            expect(events).toContainEqual({ event: 'portal-window-opened', browser: 'edge' });
        } finally {
            await app.stop();
        }
    }, 20_000);

    it('geen browser gevonden: een gebeurtenis, het proces draait verder', async () => {
        const { createApp } = await import('../../src/composition.js');
        const { tempHome, FAKE_TRAY } = await import('../helpers/journey.js');
        const events = [];
        const app = createApp({ home: tempHome(), proxyPort: 0, portalPort: 0, tray: { script: FAKE_TRAY }, trayEnv: { ...process.env, FAKE_TRAY_OPEN_PORTAL: '1' }, log: e => events.push(e),
            openWindow: () => { throw Object.assign(new Error('geen browser'), { code: NO_BROWSER }); } });
        await app.start();
        try {
            const t0 = Date.now();
            while (!events.some(e => e.event === 'portal-window-failed') && Date.now() - t0 < 10_000) await new Promise(r => setTimeout(r, 20));
            expect(events).toContainEqual({ event: 'portal-window-failed', code: NO_BROWSER });
        } finally {
            await app.stop();
        }
    }, 20_000);

    it('een browserstarter zonder foutcode meldt veilig "unknown"', async () => {
        const { createApp } = await import('../../src/composition.js');
        const { tempHome, FAKE_TRAY } = await import('../helpers/journey.js');
        const events = [];
        const app = createApp({ home: tempHome(), proxyPort: 0, portalPort: 0, tray: { script: FAKE_TRAY }, trayEnv: { ...process.env, FAKE_TRAY_OPEN_PORTAL: '1' }, log: e => events.push(e),
            openWindow: () => { throw new Error('starter unavailable'); } });
        await app.start();
        try {
            const t0 = Date.now();
            while (!events.some(e => e.event === 'portal-window-failed') && Date.now() - t0 < 10_000) await new Promise(r => setTimeout(r, 20));
            expect(events).toContainEqual({ event: 'portal-window-failed', code: 'unknown' });
        } finally {
            await app.stop();
        }
    }, 20_000);
});
