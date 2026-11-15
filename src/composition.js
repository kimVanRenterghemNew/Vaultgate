// De enige plek die implementaties van poorten kiest (docs/architecture.md §4, afgedwongen door test/composition.test.js),
// en die het proces samenstelt: kluis, registry, audit, goedkeuring, tray, proxy en portaal.
// Een implementatie toevoegen = één map + één regel in IMPLEMENTATIONS; de contracttest in test/ports/ draait er vanzelf over.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStore } from './store/local/index.js'; import { createMemoryStore } from './store/memory/index.js';
import { createTrayNotifier } from './approval/tray/index.js'; import { createNoNotifier } from './approval/none/index.js';
import { createCrypto, DEFAULT_KDF } from './crypto/index.js'; import { createVault, epochLocation, CODE_CHANGED } from './vault/index.js';
import { createRegistry } from './registry/index.js'; import { createAudit, auditedRegistry, createAdminNotices } from './audit/index.js';
import { createApproval } from './approval/index.js'; import { createTrayLink, windowsTray } from './tray-link/index.js';
import { snapshotCode } from './code-integrity/index.js'; import { createProxy, createKeyExchange, DEFAULT_ROUTES } from './proxy/index.js';
import { createPortal, assertLocalPortalHost } from './portal/index.js'; import { createDeviceFlow, readSavedKey, keyProtector } from './device/index.js';
import { createMcpHttpHandler } from './mcp/index.js';
import { openPortalWindow } from './window/index.js';
import { createTlsTrust } from './tls/index.js'; import { createTouch, touchCredentials } from './touch/index.js';
import { createThrottle } from './throttle/index.js'; import { appLanguage, translator, pickPrefix } from './locale/index.js';

export const IMPLEMENTATIONS = Object.freeze({
    store: Object.freeze({ local: createLocalStore, memory: createMemoryStore }),
    approval: Object.freeze({ tray: createTrayNotifier, none: createNoNotifier }),
});

export function choose(port, name, options) {
    const factory = IMPLEMENTATIONS[port]?.[name];
    if (!factory) throw Object.assign(new Error(`unknown ${port} implementation: ${name}`), { code: 'UNKNOWN_IMPLEMENTATION' });
    return factory(options);
}

/** Welke tray: 'none', 'windows' (standaard op Windows; uit de gecontroleerde code) of een eigen script met het tray-protocol. */
function trayCommand(tray, code) {
    if (tray && typeof tray === 'object') return { command: process.execPath, args: [tray.script] };
    return tray === 'windows' || (tray === 'auto' && process.platform === 'win32') ? windowsTray(code) : null;
}

const realClock = Object.freeze({ now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) });

/**
 * Stelt het proces samen. Opties: home (map), proxyPort/portalPort (0 = vrij), portalHost (alleen loopback), tray,
 * kdf (voor een nieuwe kluis), log (JSON-gebeurtenissen; nooit een waarde), env (o.a. VAULTGATE_EPOCH_DIR: de teller buiten de kluismap),
 * codeRoot (alleen tests: een kopie van de installatie; geen CLI-vlag of omgevingsvariabele).
 */
export function createApp({ home, proxyPort = 8484, portalPort = 8485, portalHost = '127.0.0.1', tray = 'auto', trayEnv, kdf = DEFAULT_KDF, log = () => {}, clock = realClock, deviceIntervalSeconds = 5, openWindow = openPortalWindow, window = 'app', throttle: throttleOptions = {}, tlsExtraCa = [], trayConnectTimeoutMs = 60_000, env = process.env, codeRoot }) {
    assertLocalPortalHost(portalHost); // Het portaal draait nooit op een niet-lokaal adres
    const crypto = createCrypto();
    const code = snapshotCode({ root: codeRoot, crypto }); // de eigen bestanden, één keer bij de start (gecontroleerd bij ontgrendelen)
    const vaultDir = path.join(home, 'vault');
    const store = choose('store', 'local', { dir: vaultDir });
    const counter = epochLocation({ vaultDir, crypto, env }); // anti-rollback: buiten de kluismap
    const vault = createVault({ store, crypto, clock, kdf, epoch: { store: choose('store', 'local', { dir: counter.dir }), name: counter.name }, code: code.hashes });
    const registry = createRegistry({ vault, clock, crypto });
    // Elke nieuwe audit-regel (ook een koppelverzoek: mode 'device', beheer: mode 'admin') meldt het open portaal wat
    // veranderde, zonder inhoud; een beheerregel geeft ook een melding in de tray, met alleen namen (src/audit/notify.js).
    const auditLog = createAudit({ vault, store, clock });
    const audit = Object.freeze({ ...auditLog, append: entry => auditLog.append(entry).then(() => { portal.publish(['device', 'admin'].includes(entry.mode) ? entry.mode : 'audit'); adminNotices.notice(entry); }) });

    const trayCmd = trayCommand(tray, code);
    const language = appLanguage();
    const tr = translator(language);
    const trayLink = trayCmd ? createTrayLink({ ...trayCmd, env: trayEnv, crypto, socketDir: home, onLockRequest: () => portal.lockPortal(), onLogoutRequest: () => portal.closeVault(), onOpenPortal: () => openPortal(),
        init: () => ({ portal: portalUrl, texts: pickPrefix(language, 'tray.') }) }) : null;
    const notifier = trayLink ? choose('approval', 'tray', { trayLink }) : choose('approval', 'none', {});
    const adminNotices = createAdminNotices({ notify: n => trayLink?.notify(n), translate: tr, clock, policyState: () => settings ?? {} });

    let settings = null; // bekend na het ontgrendelen
    let portalUrl = null; // bekend na het starten van het portaal
    /** Het portaal in het afgeschermde venster (Edge app-modus, eigen profiel), nooit in de standaardbrowser. */
    function openPortal(url = (vault.isUnlocked() ? portal.sessionUrl() : portalUrl)) {
        // window 'none' (tests): niets openen; de test opent zelf de pagina.
        if (window === 'none') return;
        try {
            const result = openWindow({ url: url ?? portalUrl, home, log });
            log({ event: 'portal-window-opened', browser: result.browser });
        } catch (error) {
            log({ event: 'portal-window-failed', code: error.code ?? 'unknown' });
        }
    }
    const activeUntil = (until, now) => until === null || until === undefined || now < until;
    const blockedPasskeys = () => new Set((settings?.blocks ?? []).filter(block => block.kind === 'passkey' && activeUntil(block.until, clock.now())).map(block => block.passkeyId));
    const allowedTouch = () => {
        const blocked = blockedPasskeys();
        return touchCredentials(vault.listCredentials(), settings?.touchAuthenticator ?? 'any').filter(c => !blocked.has(c.id));
    };
    const touch = createTouch({
        clock,
        newId: () => crypto.randomToken(),
        available: () => allowedTouch().length > 0,
        open: id => { log({ event: 'touch-requested', id }); openPortal(`${portalUrl}touch#${id}`); },
    });
    // Beheer in de audit met de herkomst: de tray (toekenningen), de device flow (nieuwe tools), de proxy (geleerde plekken).
    const [byTray, byDevice, byProxy] = ['tray', 'device', 'proxy'].map(origin => auditedRegistry(registry, { audit, origin }));
    const approvalCore = createApproval({
        notifier,
        clock,
        timeoutMs: () => settings?.approvalTimeoutMs ?? 30_000,
        createGrant: async ({ alias, ...g }) => { if (alias) await byTray.addSecretHost(g.secretName, g.host); const cur = await registry.findGrant(g.toolId, g.secretName, g.host); return cur ? byTray.setGrant(cur.id, { ...(g.authShape ? { authShape: g.authShape } : {}) }) : byTray.addGrant(g); }, // alias: ja op nieuw subdomein
        touch,
    });
    const publishState = () => trayLink?.publishState({ locked: !vault.isUnlocked(), pending: approvalCore.pending() });
    const approvalsChanged = () => { publishState(); portal.publish('approvals'); };
    const approval = Object.freeze({
        pending: approvalCore.pending,
        request: async question => {
            const result = approvalCore.request(question);
            approvalsChanged();
            try { return await result; } finally { approvalsChanged(); }
        },
    });

    const routes = async () => [...(settings?.routes ?? []), ...DEFAULT_ROUTES];
    const throttle = createThrottle({ clock });
    const device = createDeviceFlow({ crypto, clock, registry: byDevice, vault, audit, notifier, touch, throttle, log, intervalSeconds: deviceIntervalSeconds, verificationUri: () => (portalUrl ? `${portalUrl}#device` : null) });
    // tlsExtraCa: alleen voor tests (eigen test-CA's); in gebruik: Node + de momentopname van de systeemstore (src/tls).
    const tlsTrust = createTlsTrust({ registry, audit, clock, extraCa: tlsExtraCa, log });
    // 9.13: vertragen na foute pogingen (5 in 3 min), met een melding in de tray. tarpitMs alleen korter in tests.
    // Lange sleutel -> token van 10 min + nieuwe sleutel; een gesloten kluis wacht zoals een uitgebleven goedkeuring.
    const keyExchange = createKeyExchange({ vault, registry, audit, touch, notify: n => trayLink?.notify(n), translate: tr, closedWaitMs: () => settings?.approvalTimeoutMs ?? 30_000, log });
    const mcp = createMcpHttpHandler({
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        home,
        readKeyFn: ({ home: h, name }) => {
            try { return readSavedKey({ home: h, name, readFile: f => fs.readFileSync(f, 'utf8'), protector: keyProtector(), t: tr }); } catch { return null; }
        },
        fetchFn: fetch,
    });
    const proxy = createProxy({ vault, registry: byProxy, audit, approval, device, keyExchange, tlsTrust, routes, newRequestId: () => crypto.randomBytes(8).toString('hex'), log,
        throttle, tarpitMs: throttleOptions.tarpitMs ?? 30_000, notify: n => trayLink?.notify(n), translate: tr, clock, policyState: () => settings ?? {}, mcp });
    const servers = [];
    const extraListeners = new Map();

    function listen(server, port, host) {
        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
        });
    }

    function proxyServer() {
        const server = http.createServer((req, res) => { proxy.handle(req, res); });
        server.on('connect', (req, socket) => proxy.handleConnect(req, socket));
        servers.push(server);
        return server;
    }

    async function applySettings() {
        settings = await registry.getSettings();
        for (const l of settings.listeners) {
            const key = `${l.host}:${l.port}`;
            if (extraListeners.has(key)) continue;
            try {
                await listen(proxyServer(), l.port, l.host);
                extraListeners.set(key, true);
                log({ event: 'listening-extra', host: l.host, port: l.port });
            } catch (error) {
                log({ event: 'listen-failed', host: l.host, port: l.port, code: error.code });
            }
        }
    }

    let settingsApplied = Promise.resolve();
    vault.onChange(state => {
        log({ event: state.unlocked ? 'unlocked' : 'locked' });
        publishState();
        portal.publish('lock'); // open of dicht: het portaal toont het juiste scherm
        if (state.unlocked) settingsApplied = applySettings().catch(error => log({ event: 'settings-failed', code: error.code ?? 'unknown' }));
    });
    /** Ontgrendelen is pas klaar als de instellingen (routes, luisteradressen) toegepast zijn. */
    const codeChanged = error => { if (error.code === CODE_CHANGED) trayLink?.notify({ title: tr('tray.notify.codeChanged.title'), text: tr('tray.notify.codeChanged.text', { files: error.files.join(', ') }) }); throw error; };
    // Gewijzigde eigen code: ook een melding in de tray (het portaal toont de rode balk).
    const afterUnlock = async unlock => { const result = await unlock().catch(codeChanged); await settingsApplied; return result; };

    const portal = createPortal({ home, vault, registry, audit, approval, device, tlsTrust, touch, touchCredentials: allowedTouch, crypto, clock, log, portalHost, notify: n => trayLink?.notify(n), translate: tr, afterUnlock: unlock => afterUnlock(unlock), afterSettings: () => applySettings(), mainScript: fileURLToPath(new URL('./main.js', import.meta.url)), policyState: () => settings ?? {} });

    async function start() {
        await vault.load();
        const actualProxyPort = await listen(proxyServer(), proxyPort, '127.0.0.1');
        const portalServer = http.createServer((req, res) => { portal.handle(req, res); });
        servers.push(portalServer);
        const actualPortalPort = await listen(portalServer, portalPort, portalHost);
        portal.setPort(actualPortalPort);
        portal.setProxyPort(actualProxyPort);
        portalUrl = `http://localhost:${actualPortalPort}/`;
        if (trayLink) {
            await trayLink.start();
            // Zichtbaar in de log of de tray er is (en voor journeys: wachten tot ze verbonden is in plaats van op de klok).
            trayLink.waitForTray(trayConnectTimeoutMs).then(ok => log({ event: ok ? 'tray-connected' : 'tray-not-connected' }));
        }
        publishState();
        return { proxyPort: actualProxyPort, portalPort: actualPortalPort };
    }

    async function stop() {
        vault.lock();
        trayLink?.close();
        await Promise.all(servers.map(s => new Promise(resolve => { s.closeAllConnections?.(); s.close(() => resolve()); })));
    }

    return Object.freeze({ start, stop, vault, registry, audit, approval, openPortal: () => openPortal(), unlockWithPassphrase: (p, options) => afterUnlock(() => vault.unlockWithPassphrase(p, options)) });
}
