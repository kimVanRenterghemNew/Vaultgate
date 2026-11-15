// Een agent volgt via de MCP-tool http_request een redirect (bv. het jobverslag van GitHub Actions: 302 naar een
// tijdelijke blob-link). De proxy volgt; de secrets gaan alleen mee binnen de oorspronkelijke origin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, startProcess, MAIN } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('redirect-token');

describe('MCP http_request volgt een redirect', () => {
    let a; let b; let proc; let key;

    beforeAll(async () => {
        b = await startUpstream((req, res) => {
            if (req.url.startsWith('/loop/')) {
                res.writeHead(302, { location: `/loop/${Number(req.url.slice(6)) + 1}` });
                res.end();
                return;
            }
            // De blob-host stuurt (per ongeluk) de waarde terug: die moet gescrubd zijn.
            res.writeHead(200, { 'content-type': 'text/plain', 'x-echo': value });
            res.end(`log line 1\nleak ${value}\n`);
        });
        a = await startUpstream((req, res) => {
            const go = location => { res.writeHead(302, { location }); res.end(); };
            if (req.url === '/logs') return go(`${b.origin}/blob?sig=geheim`);
            if (req.url === '/same') return go('/final');
            if (req.url === '/final') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ auth: req.headers.authorization })); }
            if (req.url === '/loop') return go(`${b.origin}/loop/1`);
            if (req.url === '/meta') return go('http://169.254.169.254/latest/meta-data');
            res.writeHead(404, { 'content-type': 'text/plain', 'x-test': 'ja' });
            return res.end('not found');
        });
        const home = tempHome();
        key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'api', value, hosts: [a.origin] });
            const tool = await registry.addTool({ name: 'agent-tool', kind: 'mcp' });
            await registry.addGrant({ toolId: tool.id, secretName: 'api', host: a.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await startProcess(home);
    }, 60_000);

    afterAll(async () => {
        await proc?.stop();
        await a?.close();
        await b?.close();
    });

    async function call(path) {
        const child = spawn(process.execPath, [MAIN, 'mcp', '--proxy', proc.proxy], { env: { ...process.env, VAULTGATE_TOOL_KEY: key }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        const lines = readline.createInterface({ input: child.stdout });
        const answer = new Promise(resolve => lines.on('line', line => { const msg = JSON.parse(line); if (msg.id === 1) resolve(msg.result); }));
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'http_request', arguments: { url: `${a.origin}${path}`, headers: { authorization: 'Bearer {{secret:api}}' } } } })}\n`);
        try {
            const result = await answer;
            return { result, text: result.content.map(c => c.text).join('\n'), out: () => out };
        } finally { child.kill(); }
    }

    it('Given een 302 naar een andere host When de agent de logs vraagt Then krijgt hij de inhoud van die host, zonder dat het secret meeging', async () => {
        const { result, text, out } = await call('/logs');
        expect(result.isError).toBe(false);
        expect(text).toContain('log line 1');
        expect(text).toContain('HTTP 200');
        const blob = b.requests.find(r => r.url === '/blob?sig=geheim');
        expect(blob).toBeDefined();
        expect(blob.headers.authorization).toBeUndefined();
        expect(findLeaks({ blob: JSON.stringify(blob), text, out: out(), proc: proc.output() }, [value, key])).toEqual([]);
    });

    it('Given een redirect binnen dezelfde origin When gevolgd Then vult de proxy het secret opnieuw in', async () => {
        const final = () => a.requests.filter(r => r.url === '/final');
        const before = final().length;
        const { text } = await call('/same');
        expect(final()).toHaveLength(before + 1);
        expect(final().at(-1).headers.authorization).toBe(`Bearer ${value}`);
        expect(text).toContain('Bearer ***');
        expect(text).not.toContain(value);
    });

    it('MOET weigeren: meer dan 5 redirects', async () => {
        const { result, text } = await call('/loop');
        expect(result.isError).toBe(true);
        expect(text).toContain('too-many-redirects');
    });

    it('MOET weigeren: een redirect naar het cloud-metadata-adres', async () => {
        const { result, text } = await call('/meta');
        expect(result.isError).toBe(true);
        expect(text).toContain('ssrf-target-blocked');
    });

    it('Given een 404 When de agent vraagt Then ziet hij de status en de headers', async () => {
        const { text } = await call('/nope');
        expect(text).toContain('HTTP 404');
        expect(text).toContain('x-test: ja');
        expect(text).toContain('not found');
    });
});
