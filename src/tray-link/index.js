// Protocol naar de tray-app. Het proxy-proces is de server: een named pipe op Windows
// (`\\.\pipe\vaultgate-tray-<random>`), een unix-socket in de eigen map elders. Het start de tray en geeft pijpnaam en
// token via stdin (niet via argv). Vóór een geldig `hello` met token stuurt de server niets (de pipe-ACL van Node laat
// Everyone lezen), en er is maar één tray tegelijk. Berichten: JSON per regel.
//   server -> tray: { type: 'ask', id, tool, secret, host, client, timeoutMs, sensitive?, variant?, certRoot? } | { type: 'state', locked, pending: [...] }
//                 | { type: 'notify', title, text }
//   tray -> server: { type: 'hello', token } | { type: 'answer', id, answer } | { type: 'lock' } (portaal dicht, kluis open)
//                 | { type: 'logout' } (kluis dicht) | { type: 'open-portal' }
// Nooit een secret-waarde: het protocol heeft er geen veld voor.
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn as defaultSpawn } from 'node:child_process';
import { asciiJson } from './windows.js';

const MAX_LINE = 64 * 1024;
const ANSWERS = new Set(['once', 'always', 'deny', 'timeout']);
const STARTUP_WAIT_MS = 5_000;

export { windowsTray, asciiJson } from './windows.js';

/** preamble: regels die vóór de init-regel naar stdin gaan (de Windows-tray: zijn eigen gecontroleerde bron). */
export function createTrayLink({ command, args = [], preamble = '', env, crypto, socketDir, spawn = defaultSpawn, onLockRequest = () => {}, onLogoutRequest = () => {}, onOpenPortal = () => {}, init = () => ({}) }) {
    const token = Buffer.from(crypto.randomToken());
    const suffix = crypto.randomBytes(16).toString('hex');
    const pipeName = `vaultgate-tray-${suffix}`;
    const address = process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : path.join(socketDir, `tray-${suffix}.sock`);
    const pending = new Map(); // id -> resolve
    const stats = { rejected: 0, ignored: 0 };
    let tray = null;
    let child = null;
    let server = null;
    let lastState = null;
    const waiters = new Set();

    const sameToken = given => typeof given === 'string' && crypto.equal(Buffer.from(given), token);
    const send = msg => { if (tray) tray.write(`${JSON.stringify(msg)}\n`); };

    function onConnection(socket) {
        let authed = false;
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('error', () => {});
        socket.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > MAX_LINE) { socket.destroy(); return; }
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 1);
                let msg;
                try { msg = JSON.parse(line); } catch { msg = {}; }
                if (!authed) {
                    if (msg.type !== 'hello' || !sameToken(msg.token) || tray) { stats.rejected++; socket.destroy(); return; }
                    authed = true;
                    tray = socket;
                    for (const w of waiters) w();
                    waiters.clear();
                    if (lastState) send(lastState);
                    continue;
                }
                if (msg.type === 'answer' && pending.has(msg.id)) {
                    const resolve = pending.get(msg.id);
                    pending.delete(msg.id);
                    resolve(ANSWERS.has(msg.answer) ? msg.answer : 'unavailable');
                } else if (msg.type === 'lock') {
                    onLockRequest();
                } else if (msg.type === 'logout') {
                    onLogoutRequest();
                } else if (msg.type === 'open-portal') {
                    onOpenPortal(); // Het afgeschermde venster, niet de standaardbrowser
                } else {
                    stats.ignored++;
                }
            }
        });
        socket.on('close', () => {
            if (socket !== tray) return;
            tray = null;
            for (const [id, resolve] of pending) { pending.delete(id); resolve('unavailable'); }
        });
    }

    async function start() {
        if (process.platform !== 'win32') {
            fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
            fs.rmSync(address, { force: true });
        }
        server = net.createServer(onConnection);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
        if (process.platform !== 'win32') fs.chmodSync(address, 0o600);
        try {
            child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, ...(env ? { env } : {}) });
        } catch {
            child = null;
            return;
        }
        child.on('error', () => { child = null; });
        child.on('exit', () => { child = null; });
        child.stdin?.on('error', () => {});
        child.stdin?.end(`${preamble}${asciiJson({ pipe: address, pipeName, token: token.toString(), ...init() })}\n`);
    }

    function waitForTray(ms) {
        if (tray) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = setTimeout(() => { waiters.delete(done); resolve(false); }, ms);
            const done = () => { clearTimeout(timer); resolve(true); };
            waiters.add(done);
        });
    }

    /**
     * Zonder tray-proces: meteen 'unavailable' (3.1 approval-unavailable). Draait het proces wel maar is het nog niet
     * verbonden (opstarten: PowerShell compileert ±1,5 s), dan kort wachten op de verbinding.
     */
    async function ask(question) {
        if (!tray && child?.pid && child.exitCode === null) await waitForTray(STARTUP_WAIT_MS);
        if (!tray) return 'unavailable';
        return new Promise(resolve => {
            pending.set(question.id, resolve);
            send({ type: 'ask', id: question.id, tool: question.tool, secret: question.secret, host: question.host, client: question.client, method: question.method, path: question.path, timeoutMs: question.timeoutMs, variant: question.variant ?? 'approve', ...(question.sensitive ? { sensitive: true } : {}), ...(question.certRoot ? { certRoot: question.certRoot } : {}) });
        });
    }

    /** Een melding (geen vraag) in de tray, bv. bij vertragen. Zonder tray: niets. */
    function notify({ title, text }) {
        send({ type: 'notify', title: String(title), text: String(text) });
    }

    function publishState({ locked, pending: waiting = [] }) {
        lastState = { type: 'state', locked: Boolean(locked), pending: waiting.map(p => ({ tool: p.tool, secret: p.secret, host: p.host, client: p.client })) };
        send(lastState);
    }

    function close() {
        for (const [id, resolve] of pending) { pending.delete(id); resolve('unavailable'); }
        if (tray) tray.destroy();
        tray = null;
        if (child?.pid) { try { child.kill(); } catch { /* al weg */ } }
        if (server) server.close();
    }

    return Object.freeze({
        start,
        waitForTray,
        ask,
        publishState,
        notify,
        close,
        connected: () => tray !== null,
        stats: () => ({ ...stats }),
        killTrayForTest: () => { if (tray) tray.destroy(); },
    });
}
