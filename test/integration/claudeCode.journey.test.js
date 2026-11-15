// Claude Code (en andere sessies) via Vaultgate, zonder één sleutel bij de client. Twee wegen:
//  1. de Anthropic-API: ANTHROPIC_BASE_URL naar de proxy en `apiKeyHelper` = `node src/main.js key --name claude-code`;
//  2. git over HTTPS: `url.<proxy>/github/.insteadOf https://github.com/` + credential helper `node src/main.js git-credential`,
//     zodat de remote-URL de echte blijft en git alleen de tool-key kent; de proxy zet het echte token in Basic-auth.
// Nieuwe combinaties keurt de tray goed ("altijd"). Nergens een provider-sleutel of token bij de client of in de uitvoer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, MAIN } from '../helpers/journey.js';
import { createMockProvider } from '../../scripts/mock-provider.mjs';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const anthropicKey = fakeSecret('anthropic');
const githubToken = fakeSecret('github');
const SHA = 'a'.repeat(40);
const ROOT = path.resolve(path.dirname(MAIN), '..');
const pkt = s => (Buffer.byteLength(s) + 4).toString(16).padStart(4, '0') + s;

function run(cmd, args, env = {}) {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
}

describe.each(MODES)('Claude Code via Vaultgate, %s', (mode, start) => {
    let mock;
    let gitServer;
    let proc;
    let clientHome;
    let toolKey;
    const mockLog = [];

    beforeAll(async () => {
        mock = createMockProvider({ log: e => mockLog.push(e) });
        await mock.start(0);
        // Nep-GitHub (smart HTTP): aanvaardt alleen Basic x-access-token:<echt token>, anders 401 met challenge.
        const expected = `Basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`;
        gitServer = await startUpstream((req, res) => {
            if (req.headers.authorization !== expected) { res.writeHead(401, { 'www-authenticate': 'Basic realm="GitHub"' }); res.end(); return; }
            res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement', 'cache-control': 'no-cache' });
            res.end(`${pkt('# service=git-upload-pack\n')}0000${pkt(`${SHA} HEAD\0side-band-64k agent=fake-github\n`)}${pkt(`${SHA} refs/heads/main\n`)}0000`);
        });
        const home = tempHome();
        clientHome = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'anthropic', value: anthropicKey, hosts: [mock.origin] });
            await registry.addSecret({ name: 'github_token', value: githubToken, hosts: [gitServer.origin] });
            await registry.updateSettings({ routes: [
                { name: 'anthropic', base: mock.origin, secret: 'anthropic', header: 'x-api-key' },
                { name: 'github', base: gitServer.origin, secret: 'github_token', header: 'basic' },
            ] });
            return (await registry.addTool({ name: 'claude-code' })).key;
        });
        proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: 'always' } });
        // Zoals na `node src/main.js login --name claude-code`: de key en het adres van de proxy staan in het bestand van de client.
        fs.mkdirSync(path.join(clientHome, 'clients'), { recursive: true });
        fs.writeFileSync(path.join(clientHome, 'clients', 'claude-code.key'), `${toolKey}\nproxy ${proc.proxy}\n`);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
        await mock?.stop();
        await gitServer?.close();
    });

    it('Given een Claude Code-achtige client met alleen base-URL en apiKeyHelper When een gestreamde call Then slaagt ze en kent de client geen sleutel', async () => {
        const helper = await run(process.execPath, [MAIN, 'key', '--name', 'claude-code', '--home', clientHome]);
        expect(helper.code, helper.stderr).toBe(0);
        const apiKey = helper.stdout.trim();
        // De helper wisselde de key in: een token van 10 minuten, en een nieuwe key in het bestand (op Windows met DPAPI).
        expect(apiKey).toMatch(/^ks_/);
        expect(apiKey).not.toBe(toolKey);
        expect(fs.readFileSync(path.join(clientHome, 'clients', 'claude-code.key'), 'utf8')).not.toContain(toolKey);
        const res = await fetch(`${proc.proxy}/anthropic/v1/messages`, { method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5-5', stream: true }) });
        expect(res.status).toBe(200);
        // Sinds 9.3 maakt "altijd" zonder passkey-aanraking geen toekenning (deze kluis heeft geen passkey): eenmalig.
        expect(['approved-always', 'granted', 'approved-once']).toContain(res.headers.get('x-vault-gate-rule'));
        expect(await res.text()).toContain('message_stop');
    }, 30_000);

    it('git ls-remote op de echte GitHub-URL gaat via de proxy; git kent alleen de tool-key, de nep-GitHub krijgt het echte token', async () => {
        const gitconfig = path.join(clientHome, 'gitconfig');
        // In een gitconfig-waarde verwerkt git zelf de aanhalingstekens; \" laat ze door naar de shell (pad met spaties).
        const q = p => `\\"${p.replace(/\\/g, '/')}\\"`;
        const helperCmd = `!${q(process.execPath)} ${q(MAIN)} git-credential --name claude-code --home ${q(clientHome)}`;
        fs.writeFileSync(gitconfig, `[safe]\n\tdirectory = "${ROOT.replace(/\\/g, '/')}"\n[url "${proc.proxy}/github/"]\n\tinsteadOf = https://github.com/\n[credential]\n\thelper = ${helperCmd}\n`);
        const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
        const git = await run('git', ['ls-remote', 'https://github.com/user/vaultgate.git'], env);
        expect(git.code, git.stderr).toBe(0);
        expect(git.stdout).toContain(`${SHA}\trefs/heads/main`);
        const authed = gitServer.requests.filter(r => r.headers.authorization?.startsWith('Basic'));
        expect(authed.length).toBeGreaterThan(0);
        expect(authed.at(-1).url).toBe('/user/vaultgate.git/info/refs?service=git-upload-pack');
        expect(Buffer.from(authed.at(-1).headers.authorization.slice(6), 'base64').toString()).toBe(`x-access-token:${githubToken}`);
        expect(findLeaks({ gitconfig: fs.readFileSync(gitconfig), stdout: git.stdout, stderr: git.stderr }, [githubToken, anthropicKey])).toEqual([]);
    }, 60_000);

    it('nergens een provider-sleutel of token: niet in de procesuitvoer, de clientmap of de mock-log', () => {
        const clientFiles = Object.fromEntries(fs.readdirSync(path.join(clientHome, 'clients')).map(f => [f, fs.readFileSync(path.join(clientHome, 'clients', f))]));
        expect(findLeaks({ out: proc.output(), mock: JSON.stringify(mockLog), ...clientFiles }, [anthropicKey, githubToken])).toEqual([]);
    });
});
