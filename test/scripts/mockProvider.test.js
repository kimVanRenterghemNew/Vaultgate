// De mock-provider. Anthropic- en OpenAI-vormige routes (ook gestreamd), /echo, /v1/models; logt per request welke
// sleutelheader er was en een korte vingerafdruk, nooit de waarde.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createMockProvider, selfTest } from '../../scripts/mock-provider.mjs';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const key = fakeSecret('mock');
let mock;
const logged = [];

beforeAll(async () => {
    mock = createMockProvider({ log: e => logged.push(e) });
    await mock.start(0);
});
afterAll(() => mock.stop());

async function sse(res) {
    const text = await res.text();
    return text.split('\n\n').filter(Boolean);
}

describe('mock-provider', () => {
    it('Anthropic /v1/messages: JSON-antwoord met het gevraagde model', async () => {
        const res = await fetch(`${mock.origin}/v1/messages`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hoi' }] }) });
        const body = await res.json();
        expect(body).toMatchObject({ type: 'message', model: 'claude-sonnet-5-5', role: 'assistant' });
        expect(body.content[0].text).toContain('mock');
    });

    it('Anthropic gestreamd: SSE met message_start, deltas en message_stop', async () => {
        const res = await fetch(`${mock.origin}/v1/messages`, { method: 'POST', headers: { 'x-api-key': key }, body: JSON.stringify({ model: 'm', stream: true }) });
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        const events = await sse(res);
        expect(events[0]).toContain('event: message_start');
        expect(events.filter(e => e.includes('content_block_delta')).length).toBeGreaterThanOrEqual(3);
        expect(events.at(-1)).toContain('event: message_stop');
    });

    it('OpenAI-compatibel /v1/chat/completions, ook gestreamd met [DONE]', async () => {
        const plain = await (await fetch(`${mock.origin}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt' }) })).json();
        expect(plain.choices[0].message.content).toContain('mock');
        const events = await sse(await fetch(`${mock.origin}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt', stream: true }) }));
        expect(events.at(-1)).toBe('data: [DONE]');
    });

    it('/echo geeft headers en body terug (om scrubben te tonen); /v1/models; onbekend: 404', async () => {
        const echo = await (await fetch(`${mock.origin}/echo`, { method: 'POST', headers: { 'x-api-key': key }, body: 'hallo' })).json();
        expect(echo).toMatchObject({ method: 'POST', body: 'hallo', headers: { 'x-api-key': key } });
        expect((await (await fetch(`${mock.origin}/v1/models`)).json()).data.length).toBeGreaterThan(0);
        expect((await fetch(`${mock.origin}/bestaat-niet`)).status).toBe(404);
    });

    it('logt de sleutelheader en een vingerafdruk, nooit de waarde; dezelfde sleutel = dezelfde vingerafdruk', () => {
        const withKey = logged.filter(e => e.keyHeader);
        expect(withKey.length).toBeGreaterThan(3);
        expect(new Set(withKey.map(e => e.keyFingerprint)).size).toBe(1);
        expect(withKey[0].keyFingerprint).toMatch(/^[0-9a-f]{8}$/);
        expect(findLeaks({ log: JSON.stringify(logged) }, [key])).toEqual([]);
    });

    it('--self-test: alle routes slagen', async () => {
        const out = [];
        expect(await selfTest({ out: t => out.push(t) })).toBe(true);
        expect(out.join('\n')).toContain('alle routes geslaagd');
    });
});

describe('mock-provider: CLI en randen', () => {
    it('main: --self-test geeft exitcode 0; anders start de mock op de gevraagde poort en logt elke request als JSON', async () => {
        const { main } = await import('../../scripts/mock-provider.mjs');
        expect((await main(['--self-test'], { out: () => {} })).code).toBe(0);
        const out = [];
        const { mock: started } = await main(['--port', '0'], { out: t => out.push(t) });
        try {
            await fetch(`${started.origin}/v1/models`, { headers: { 'x-goog-api-key': 'g-key' } });
            expect(out[0]).toContain('mock-provider op http://127.0.0.1:');
            expect(JSON.parse(out.at(-1))).toMatchObject({ route: '/v1/models', keyHeader: 'x-goog-api-key' });
            expect(out.join('\n')).not.toContain('g-key');
        } finally {
            await started.stop();
        }
    });

    it('een GET op /v1/messages of kapotte JSON: geen crash (404 resp. een antwoord met het standaardmodel)', async () => {
        expect((await fetch(`${mock.origin}/v1/messages`)).status).toBe(404);
        const res = await fetch(`${mock.origin}/v1/messages`, { method: 'POST', body: '{kapot' });
        expect((await res.json()).model).toBe('mock');
    });

    it('lege POST-body gebruikt het standaardmodel voor beide API-vormen', async () => {
        const anthropic = await (await fetch(`${mock.origin}/v1/messages`, { method: 'POST' })).json();
        const openai = await (await fetch(`${mock.origin}/v1/chat/completions`, { method: 'POST' })).json();
        expect(anthropic).toMatchObject({ model: 'mock', type: 'message' });
        expect(openai).toMatchObject({ model: 'mock', object: 'chat.completion' });
        expect(logged.at(-2)).toMatchObject({ keyHeader: null, stream: false });
    });

    it('stop vóór start is veilig; self-test werkt ook met de standaarduitvoer', async () => {
        await createMockProvider().stop();
        expect(await selfTest()).toBe(true);
    });

    it('CLI start met standaarduitvoer en de self-test CLI eindigt succesvol', async () => {
        const { mock: started } = await (await import('../../scripts/mock-provider.mjs')).main(['--port', '0']);
        try {
            expect(started.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
        } finally {
            await started.stop();
        }
        const cli = spawnSync(process.execPath, [path.resolve('scripts/mock-provider.mjs'), '--self-test'], { encoding: 'utf8', timeout: 15_000 });
        expect(cli.status).toBe(0);
        expect(cli.stdout).toContain('alle routes geslaagd');
    });
});
