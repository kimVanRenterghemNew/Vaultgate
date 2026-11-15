// Het portaal zet de vaultgate-MCP in de agents van deze pc, of geeft de JSON om te kopiëren. De key die de
// pagina net kreeg is het bewijs: hij wordt beschermd bewaard (clients/<tool>.key) en de agent krijgt alleen `--name`.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mcpRoutes } from '../../src/portal/mcp-routes.js';
import { httpError } from '../../src/portal/errors.js';

const KEY = 'ks_FAKE-mcp-route-key-0123456789';
let home;
let vaultHome;
let audited;
let route;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'mcp-routes-'));
    vaultHome = fs.mkdtempSync(path.join(process.env.VAULTGATE_HOME, 'mcp-vault-'));
    fs.mkdirSync(path.join(home, '.cursor'));
    audited = [];
    const tools = { [KEY]: { id: 'a1', name: 'agent', kind: 'mcp' }, ks_web: { id: 'b2', name: 'web-tool', kind: 'web' } };
    const routes = mcpRoutes({
        registry: { findToolByKey: async key => tools[key] ?? null },
        home: vaultHome,
        proxyUrl: () => 'http://127.0.0.1:9999',
        auditAdmin: async (rule, fields) => { audited.push({ rule, ...fields }); },
        httpError,
        protector: null,
        env: { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') },
    });
    route = (method, p) => routes.find(([m, re]) => m === method && re.test(p))[3];
});

const failure = async promise => promise.then(() => null, error => ({ code: error.code, rule: error.rule, message: error.message }));
const everything = () => JSON.stringify(audited) + [home, vaultHome].flatMap(dir => fs.readdirSync(dir, { recursive: true }).map(f => {
    const file = path.join(dir, String(f));
    return fs.statSync(file).isFile() && !String(f).startsWith('clients') ? fs.readFileSync(file, 'utf8') : '';
})).join('');

describe('portaal: MCP in de agents', () => {
    it('GET agents: elke gekende agent, met of hij op deze pc staat', async () => {
        const agents = await route('GET', '/api/mcp/agents')({});
        expect(agents.find(a => a.id === 'cursor')).toEqual({ id: 'cursor', label: 'Cursor', present: true, installed: false });
        expect(agents.find(a => a.id === 'claude-code').present).toBe(false);
    });

    it('Given een MCP-key When installeren in Cursor Then entry met --name, key bewaard, audit zonder key', async () => {
        const result = await route('POST', '/api/mcp/install')({ body: { key: KEY, agents: ['cursor'] } });

        expect(result.results).toEqual([{ id: 'cursor', label: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), status: 'installed' }]);
        const entry = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers['vaultgate-agent'];
        expect(entry.args.slice(1)).toEqual(['mcp', '--name', 'agent', '--home', vaultHome, '--proxy', 'http://127.0.0.1:9999']);
        expect(fs.readFileSync(path.join(vaultHome, 'clients', 'agent.key'), 'utf8')).toContain(KEY); // zonder beschermer (niet-Windows)
        expect(audited).toEqual([{ rule: 'mcp-installed', tool: 'agent', scope: 'user', detail: 'cursor: installed' }]);
        expect(everything()).not.toContain(KEY);
    });

    it('JSON kopiëren: de entry met --name, key bewaard, nooit de key in het antwoord', async () => {
        const json = await route('POST', '/api/mcp/entry')({ body: { key: KEY } });
        expect(json.mcpServers['vaultgate-agent'].args).toContain('--name');
        expect(JSON.stringify(json)).not.toContain(KEY);
        expect(fs.existsSync(path.join(vaultHome, 'clients', 'agent.key'))).toBe(true);
    });

    it('MOET weigeren: onbekende key, een web-key, geen agents; zonder iets te schrijven en zonder de key te noemen', async () => {
        const unknown = await failure(route('POST', '/api/mcp/install')({ body: { key: 'ks_nope', agents: ['cursor'] } }));
        expect(unknown).toMatchObject({ code: 'BAD_REQUEST', rule: 'mcp-key-unknown' });
        expect(unknown.message).not.toContain('ks_nope');
        expect(await failure(route('POST', '/api/mcp/entry')({ body: { key: 'ks_web' } }))).toMatchObject({ rule: 'mcp-tool-required' });
        expect(await failure(route('POST', '/api/mcp/install')({ body: { key: KEY, agents: [] } }))).toMatchObject({ rule: 'mcp-agent-required' });
        expect(await failure(route('POST', '/api/mcp/install')({ body: { key: KEY } }))).toMatchObject({ rule: 'mcp-agent-required' });
        expect(fs.existsSync(path.join(home, '.cursor', 'mcp.json'))).toBe(false);
        expect(fs.existsSync(path.join(vaultHome, 'clients'))).toBe(false);
        expect(audited).toEqual([]);
    });

    it('een onbekende agent geeft een fout per agent, de rest gaat door', async () => {
        const { results } = await route('POST', '/api/mcp/install')({ body: { key: KEY, agents: ['foo', 'cursor'] } });
        expect(results.map(r => [r.id, r.status])).toEqual([['foo', 'error'], ['cursor', 'installed']]);
    });

    it('Skill installeren en verwijderen via de API logt audit mcp-skill-installed en uninstalled', async () => {
        const claudeDir = path.join(home, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });

        const installed = await route('POST', '/api/mcp/skill/install')({ body: { key: KEY } });
        expect(installed.results.length).toBeGreaterThan(0);
        expect(audited.some(a => a.rule === 'mcp-skill-installed')).toBe(true);

        const uninstalled = await route('POST', '/api/mcp/skill/uninstall')({ body: { key: KEY } });
        expect(uninstalled.results.length).toBeGreaterThan(0);
        expect(audited.some(a => a.rule === 'mcp-skill-uninstalled')).toBe(true);
    });
});

describe('portaal: MCP bijwerken na een versiewissel', () => {
    const memoryVault = () => {
        const docs = new Map();
        let n = 0;
        return {
            ids: async () => [...docs.keys()],
            get: async (id, fields) => Object.fromEntries(fields.map(f => [f, docs.get(id)[f]])),
            put: async (doc, id) => { const key = id ?? `d${n++}`; docs.set(key, doc); return key; },
        };
    };
    let refreshRoute;
    let vault;
    let claudeFile;

    beforeEach(() => {
        vault = memoryVault();
        const routes = mcpRoutes({
            registry: { vault, findToolByKey: async () => null },
            home: vaultHome, proxyUrl: () => 'http://127.0.0.1:9999', auditAdmin: async () => {}, httpError, protector: null,
            env: { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') },
        });
        refreshRoute = routes.find(([m, re]) => m === 'POST' && re.test('/api/mcp/refresh'))[3];
        claudeFile = path.join(home, '.claude.json');
        fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { 'vaultgate-agent': { command: 'old', args: ['x', 'mcp', '--name', 'agent'] } } }));
    });

    it('Given een kluis zonder bewaarde versie When auto Then alleen de versie onthouden, niets geschreven (MOET niets doen)', async () => {
        const before = fs.readFileSync(claudeFile, 'utf8');
        expect(await refreshRoute({ body: { auto: true } })).toMatchObject({ files: [], skipped: true });
        expect(fs.readFileSync(claudeFile, 'utf8')).toBe(before);
        expect(await refreshRoute({ body: { auto: true } })).toMatchObject({ files: [], skipped: true });
        expect(fs.readFileSync(claudeFile, 'utf8')).toBe(before);
    });

    it('Given een andere bewaarde versie When auto Then bijgewerkt, met het aangepaste bestand in het antwoord', async () => {
        await vault.put({ kind: 'mcp_installations', list: [], version: '0.0.0-oud' });
        const res = await refreshRoute({ body: { auto: true } });
        expect(res.files.map(f => f.file)).toEqual([claudeFile]);
        expect(await refreshRoute({ body: { auto: true } })).toMatchObject({ skipped: true });
    });

    it('When Bijwerken (zonder auto) Then altijd bijgewerkt', async () => {
        const res = await refreshRoute({ body: {} });
        expect(res.files.map(f => f.file)).toEqual([claudeFile]);
    });
});

describe('portaal: welke bestanden een actie aanpaste', () => {
    it('Given Cursor met een bestaande config When installeren Then changed noemt mcp.json met zijn .bak', async () => {
        const file = path.join(home, '.cursor', 'mcp.json');
        fs.writeFileSync(file, '{"mcpServers":{"other":{"command":"x"}}}');
        const { changed } = await route('POST', '/api/mcp/install')({ body: { key: KEY, agents: ['cursor'] } });
        expect(changed).toEqual([{ file, status: 'installed', backup: `${file}.vaultgate.bak` }]);
    });

    it('Given een al geïnstalleerde entry When opnieuw installeren Then changed is leeg (MOET niets melden)', async () => {
        await route('POST', '/api/mcp/install')({ body: { key: KEY, agents: ['cursor'] } });
        const { changed } = await route('POST', '/api/mcp/install')({ body: { key: KEY, agents: ['cursor'] } });
        expect(changed).toEqual([]);
    });
});
