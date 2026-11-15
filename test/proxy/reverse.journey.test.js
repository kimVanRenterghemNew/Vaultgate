// Reverse-routes per provider. Een eenvoudige client zet alleen zijn base-URL op de proxy en gebruikt
// zijn tool-key waar hij anders de provider-sleutel zet (beslissing van de product owner: in de provider-header). De nep-provider ontvangt
// de echte sleutel in de header die hij verwacht; de client heeft geen provider-sleutel.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const anthropicKey = fakeSecret('anthropic');
const litellmKey = fakeSecret('litellm');
let anthropic;
let litellm;
let proc;
let toolKey;

describe.each(MODES)('%s', (mode, start) => {
    beforeAll(async () => {
        anthropic = await startUpstream((req, res, rec) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id: 'msg_1', type: 'message', content: [{ type: 'text', text: `model ${JSON.parse(rec.body).model}` }] }));
        });
        litellm = await startUpstream((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"choices":[{"message":{"content":"hallo"}}]}');
        });
        const home = tempHome();
        toolKey = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'anthropic', value: anthropicKey, hosts: [anthropic.origin] });
            await registry.addSecret({ name: 'litellm', value: litellmKey, hosts: [litellm.origin] });
            await registry.updateSettings({ routes: [
                { name: 'anthropic', base: anthropic.origin, secret: 'anthropic', header: 'x-api-key' },
                { name: 'litellm', base: litellm.origin, secret: 'litellm', header: 'authorization' },
            ] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'anthropic', host: anthropic.origin, origin: 'portal' });
            await registry.addGrant({ toolId: tool.id, secretName: 'litellm', host: litellm.origin, origin: 'portal' });
            return tool.key;
        });
        proc = await start(home);
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await anthropic?.close();
        await litellm?.close();
    });

    describe('reverse-routes per provider', () => {
        it('Given een nep-Anthropic-server When een eenvoudige client met alleen base-URL en tool-key Then ontvangt de nep-server x-api-key met de waarde', async () => {
            const baseUrl = `${proc.proxy}/anthropic`;
            const res = await fetch(`${baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'x-api-key': toolKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'hoi' }] }),
            });
            expect(res.status).toBe(200);
            expect((await res.json()).content[0].text).toBe('model claude-sonnet-5-5');
            const received = anthropic.requests.at(-1);
            expect(received.url).toBe('/v1/messages');
            expect(received.headers['x-api-key']).toBe(anthropicKey);
            expect(received.headers['anthropic-version']).toBe('2023-06-01');
            expect(JSON.stringify(received.headers)).not.toContain(toolKey);
            expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
        });

        it('de tool-key als Authorization: Bearer (Claude Code met ANTHROPIC_AUTH_TOKEN) werkt ook, en de nep-server krijgt alleen x-api-key', async () => {
            const res = await fetch(`${proc.proxy}/anthropic/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${toolKey}`, 'content-type': 'application/json' }, body: '{"model":"m"}' });
            expect(res.status).toBe(200);
            const received = anthropic.requests.at(-1);
            expect(received.headers['x-api-key']).toBe(anthropicKey);
            expect(received.headers.authorization).toBeUndefined();
        });

        it('OpenAI-compatibel / LiteLLM: Authorization: Bearer met de echte sleutel', async () => {
            const res = await fetch(`${proc.proxy}/litellm/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${toolKey}`, 'content-type': 'application/json' }, body: '{"model":"gpt","messages":[]}' });
            expect(res.status).toBe(200);
            expect(litellm.requests.at(-1)).toMatchObject({ url: '/v1/chat/completions', headers: { authorization: `Bearer ${litellmKey}` } });
        });

        it('een onbekende route: 404 unknown-route; zonder tool-key: 401', async () => {
            expect((await fetch(`${proc.proxy}/bestaat-niet/v1`)).status).toBe(404);
            const res = await fetch(`${proc.proxy}/anthropic/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'sk-ant-een-echte-sleutel-die-hier-niet-hoort' }, body: '{}' });
            expect(res.status).toBe(401);
            expect(res.headers.get('x-vault-gate-rule')).toBe('no-tool-key');
        });

        it('geen lek in de uitvoer van het proces', () => {
            expect(findLeaks({ output: proc.output() }, [anthropicKey, litellmKey, toolKey])).toEqual([]);
        });
    });
});
