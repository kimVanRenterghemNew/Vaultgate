// Het tray-protocol. De proxy is de pipe-server (named pipe op Windows, unix-socket
// elders), start de tray met pijpnaam + token via stdin, laat alleen een tray met het juiste token toe, stuurt vragen en de
// toestand (vergrendeld/ontgrendeld, wachtende goedkeuringen) en ontvangt "nu vergrendelen".
import { describe, it, expect, afterEach } from 'vitest';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTrayLink } from '../../src/tray-link/index.js';
import { createCrypto } from '../../src/crypto/index.js';
import { newVault } from '../vault/fixtures.js';

const FAKE_TRAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fakeTray.mjs');
const crypto = createCrypto();
const links = [];

function start(env = {}, extra = {}) {
    const received = [];
    const spawnTray = (cmd, args, opts) => {
        const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
        let buf = '';
        child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) >= 0) { received.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); } });
        return child;
    };
    const link = createTrayLink({ command: process.execPath, args: [FAKE_TRAY], crypto, socketDir: process.env.VAULTGATE_HOME, spawn: spawnTray, ...extra });
    links.push(link);
    return { link, received };
}

const until = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting'); await new Promise(r => setTimeout(r, 10)); }
};

afterEach(() => { for (const l of links.splice(0)) l.close(); });

describe('tray-protocol', () => {
    it('Given een ontgrendelde kluis When "nu vergrendelen" via het tray-protocol Then is de kluis vergrendeld en meldt de tray dat', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        const { link, received } = start({ FAKE_TRAY_LOCK_ON_UNLOCKED: '1' }, { onLockRequest: () => vault.lock() });
        vault.onChange(state => link.publishState({ locked: !state.unlocked, pending: [] }));
        await link.start();
        await link.waitForTray(5000);
        link.publishState({ locked: !vault.isUnlocked(), pending: [] });
        await until(() => !vault.isUnlocked());
        await until(() => received.some(m => m.type === 'state' && m.locked === true));
        expect(received.filter(m => m.type === 'state').map(m => m.locked)).toEqual([false, true]);
    });

    it('de tray krijgt de toestand met de wachtende goedkeuringen (namen, nooit waarden)', async () => {
        const { link, received } = start();
        await link.start();
        await link.waitForTray(5000);
        link.publishState({ locked: false, pending: [{ tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1' }] });
        await until(() => received.some(m => m.type === 'state'));
        expect(received.find(m => m.type === 'state')).toEqual({ type: 'state', locked: false, pending: [{ tool: 'mytool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1' }] });
    });

    it('een vraag gaat naar de tray en het antwoord komt terug', async () => {
        const { link, received } = start({ FAKE_TRAY_ANSWER: 'always' });
        await link.start();
        await link.waitForTray(5000);
        const answer = await link.ask({ id: 'q1', tool: 'mytool', secret: 's', host: 'https://h', client: '127.0.0.1', timeoutMs: 30000 });
        expect(answer).toBe('always');
        expect(received.find(m => m.type === 'ask')).toMatchObject({ id: 'q1', tool: 'mytool', secret: 's', host: 'https://h' });
    });

    it('9.3: een vraag voor een gevoelig secret draagt die markering (de pop-up zegt dat er een aanraking volgt)', async () => {
        const { link, received } = start({ FAKE_TRAY_ANSWER: 'once' });
        await link.start();
        await link.waitForTray(5000);
        await link.ask({ id: 'q2', tool: 'mytool', secret: 's', host: 'https://h', client: '127.0.0.1', timeoutMs: 30000, sensitive: true });
        expect(received.find(m => m.type === 'ask')).toMatchObject({ id: 'q2', sensitive: true });
    });

    it('9.13: een melding gaat naar de tray (titel en tekst, nooit een waarde)', async () => {
        const { link, received } = start();
        await link.start();
        await link.waitForTray(5000);
        link.notify({ title: 'Vertraagd', text: '5 foute pogingen van 127.0.0.1' });
        await until(() => received.some(m => m.type === 'notify'));
        expect(received.find(m => m.type === 'notify')).toEqual({ type: 'notify', title: 'Vertraagd', text: '5 foute pogingen van 127.0.0.1' });
    });

    it('MOET weigeren: een tray met een fout token krijgt niets en geldt niet als verbonden', async () => {
        const { link, received } = start({ FAKE_TRAY_TOKEN: 'fout', FAKE_TRAY_ANSWER: 'always' });
        await link.start();
        await new Promise(r => setTimeout(r, 500));
        expect(link.connected()).toBe(false);
        expect(await link.ask({ id: 'q', tool: 't', secret: 's', host: 'https://h', client: 'c', timeoutMs: 1000 })).toBe('unavailable');
        expect(received).toEqual([]);
        expect(link.stats().rejected).toBe(1);
    }, 15_000); // draait het geweigerde tray-proces nog, dan wacht ask tot 5 s op een verbinding

    it('geen tray (programma bestaat niet): elke vraag krijgt meteen "unavailable"', async () => {
        const { link } = start({}, { command: path.join(process.env.VAULTGATE_HOME, 'bestaat-niet.exe'), args: [] });
        await link.start();
        const t0 = Date.now();
        expect(await link.ask({ id: 'q', tool: 't', secret: 's', host: 'https://h', client: 'c', timeoutMs: 30000 })).toBe('unavailable');
        expect(Date.now() - t0).toBeLessThan(100);
    });

    it('tray weg tijdens een vraag: die vraag krijgt meteen "unavailable"', async () => {
        const { link } = start({ FAKE_TRAY_ANSWER: 'never' });
        await link.start();
        await link.waitForTray(5000);
        const answer = link.ask({ id: 'q', tool: 't', secret: 's', host: 'https://h', client: 'c', timeoutMs: 30000 });
        await new Promise(r => setTimeout(r, 100));
        link.killTrayForTest();
        expect(await answer).toBe('unavailable');
    });

    it('authenticeert het protocol, verwerkt acties, weigert onbekende antwoorden en sluit te grote regels', async () => {
        const childInput = new PassThrough();
        let launch;
        childInput.on('data', chunk => { launch = JSON.parse(chunk.toString()); });
        const child = Object.assign(new EventEmitter(), {
            pid: 1, exitCode: null, stdin: childInput, kill() {},
        });
        const locked = [];
        const loggedOut = [];
        const opened = [];
        const link = createTrayLink({
            command: 'unused', args: [], crypto, socketDir: process.env.VAULTGATE_HOME,
            spawn: () => child,
            onLockRequest: () => locked.push(true), onLogoutRequest: () => loggedOut.push(true), onOpenPortal: () => opened.push(true),
        });
        links.push(link);
        await link.start();
        await until(() => launch);
        const socket = net.connect(launch.pipe);
        await once(socket, 'connect');
        socket.write(`${JSON.stringify({ type: 'hello', token: launch.token })}\n`);
        await until(() => link.connected());
        expect(await link.waitForTray(20)).toBe(true);

        socket.write('{kapot\n{"type":"lock"}\n{"type":"logout"}\n{"type":"open-portal"}\n{"type":"unknown"}\n');
        await until(() => locked.length && loggedOut.length && opened.length && link.stats().ignored === 2);
        expect(link.stats().ignored).toBe(2);

        const pending = link.ask({ id: 'bad-answer', tool: 't', secret: 's', host: 'https://h', client: 'c', timeoutMs: 1000 });
        socket.write('{"type":"answer","id":"bad-answer","answer":"not-an-answer"}\n');
        await expect(pending).resolves.toBe('unavailable');

        socket.write('x'.repeat(65 * 1024));
        await until(() => !link.connected());
        socket.destroy();
    });
});
