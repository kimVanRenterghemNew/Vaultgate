// De device flow verharden.
// Sinds 9.17 vraagt goedkeuren een aanraking van de passkey; hier een aanraakpoort die "ok" zegt (dat gedrag staat in touch.test.js).
// Een device-aanvraag kan een bestaande tool niet overnemen (ook niet als de naam pas tijdens het wachten ontstaat), een
// nieuwe key heft een intrekking niet stil op, /device/* aanvaardt alleen JSON met een loopback-/IP-Host (geen webpagina via
// DNS-rebinding of een formulier), en de CLI schrijft alleen een geldige, gevraagde naam weg.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createDeviceFlow, runDeviceLogin } from '../../src/device/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { createProxy } from '../../src/proxy/index.js';
import { newVault, crypto } from '../vault/fixtures.js';
import { fakeTimers, touchOk } from '../approval/fixtures.js';

let clock;
let registry;
let audited;
let flow;
beforeEach(async () => {
    clock = fakeTimers();
    const { vault } = newVault({ clock });
    await vault.create({ passphrase: 'p' });
    registry = createRegistry({ vault, clock, crypto });
    audited = [];
    flow = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async e => { audited.push(e); } }, intervalSeconds: 5, touch: touchOk });
});

describe('geen overname van een bestaande tool', () => {
    it('Given een bestaande tool "mytool" When een device-aanvraag met naam "mytool" Then geweigerd (name-taken), key en toekenningen ongemoeid', async () => {
        const { key } = await registry.addTool({ name: 'mytool' });
        await expect(flow.request({ clientName: 'mytool', client: '127.0.0.1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
        expect(await flow.pending()).toEqual([]);
        expect(audited.at(-1)).toMatchObject({ tool: 'mytool', allow: false, rule: 'device-name-taken' });
        expect(await registry.findToolByKey(key)).toMatchObject({ name: 'mytool', revoked: false });
    });

    it('na Rotate kan dezelfde naam opnieuw koppelen; de nieuwe key wordt pas na code en aanraking actief', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        const { key: rotatedKey } = await registry.rotateToolKey(id);
        const request = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const pending = (await flow.pending())[0];
        flow.verifyCode(pending.id, request.user_code);
        await flow.approve(pending.id, { requireCode: true });
        clock.advance(5_000);
        const ready = await flow.poll({ deviceCode: request.device_code });
        expect(ready).toMatchObject({ status: 200, body: { tool_name: 'mytool' } });
        expect(await registry.findToolByKey(rotatedKey)).toBeNull();
        expect(await registry.findToolByKey(ready.body.tool_key)).toMatchObject({ id, name: 'mytool' });
    });

    it('Given Rotate When binnen 10 minuten gekoppeld Then lukt de koppeling; daarna is de tool niet meer open', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        await registry.rotateToolKey(id);
        await clock.advance(10 * 60_000 - 1);
        const request = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const pending = (await flow.pending())[0];
        expect(pending).toMatchObject({ existing: true, pairable: true });
        flow.verifyCode(pending.id, request.user_code);
        expect(await flow.approve(pending.id, { requireCode: true })).toEqual({ approved: true });
        await expect(flow.request({ clientName: 'mytool', client: '127.0.0.1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    });

    it('MOET weigeren: Rotate en meer dan 10 minuten later koppelen met dezelfde naam (name-taken), ook niet via rePairToolKey', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        const { key: rotatedKey } = await registry.rotateToolKey(id);
        await clock.advance(10 * 60_000 + 1);
        await expect(flow.request({ clientName: 'mytool', client: '127.0.0.1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
        expect(audited.at(-1)).toMatchObject({ tool: 'mytool', allow: false, rule: 'device-name-taken' });
        await expect(registry.rePairToolKey(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await registry.findToolByKey(rotatedKey)).toMatchObject({ id, name: 'mytool', pairableAfterRotate: false });
    });

    it('MOET weigeren: een aanvraag die na Rotate startte, verloopt bij goedkeuren na de 10 minuten van Rotate', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        const { key: rotatedKey } = await registry.rotateToolKey(id);
        await clock.advance(9 * 60_000);
        const request = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const pending = (await flow.pending())[0];
        flow.verifyCode(pending.id, request.user_code);
        await clock.advance(2 * 60_000);
        expect(await flow.approve(pending.id, { requireCode: true })).toEqual({ denied: 'device-name-taken' });
        expect(await registry.findToolByKey(rotatedKey)).toMatchObject({ id });
    });

    it('MOET weigeren: een ingetrokken tool wordt niet opnieuw gekoppeld, ook niet na Rotate (name-taken, nooit "approved")', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        const { key: rotatedKey } = await registry.rotateToolKey(id);
        const request = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        await registry.revokeTool(id);
        await expect(registry.rePairToolKey(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const pending = (await flow.pending())[0];
        flow.verifyCode(pending.id, request.user_code);
        expect(await flow.approve(pending.id, { requireCode: true })).toEqual({ denied: 'device-name-taken' });
        clock.advance(5_000);
        expect(await flow.poll({ deviceCode: request.device_code })).toMatchObject({ status: 400, body: { error: 'access_denied' } });
        expect(await registry.findToolByKey(rotatedKey)).toMatchObject({ id, revoked: true });
        await expect(flow.request({ clientName: 'mytool', client: '127.0.0.1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    });

    it('MOET weigeren: de naam ontstaat terwijl de aanvraag wacht; goedkeuren neemt de tool niet over (access_denied)', async () => {
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const { key } = await registry.addTool({ name: 'mytool' });
        await flow.approve((await flow.pending())[0].id);
        clock.advance(5_000);
        expect(await flow.poll({ deviceCode: r.device_code, client: '127.0.0.1' })).toMatchObject({ status: 400, body: { error: 'access_denied' } });
        expect(await registry.findToolByKey(key)).toMatchObject({ name: 'mytool' });
        expect(audited.map(e => e.rule)).toContain('device-name-taken');
    });
});

describe('een nieuwe key heft een intrekking niet op', () => {
    it('Given een ingetrokken tool When een nieuwe key Then blijft ze ingetrokken tot ze expliciet geheractiveerd wordt', async () => {
        const { id } = await registry.addTool({ name: 'mytool' });
        await registry.revokeTool(id);
        const { key } = await registry.rotateToolKey(id);
        expect(await registry.findToolByKey(key)).toMatchObject({ revoked: true });
        await registry.reactivateTool(id);
        expect(await registry.findToolByKey(key)).toMatchObject({ revoked: false });
    });
});

describe('CLI: alleen een geldige, gevraagde naam', () => {
    const fakeServer = toolName => async url => ({
        status: 200,
        json: async () => (url.endsWith('/device/code') ? { device_code: 'd', user_code: 'ABCD-EFGH', interval: 0 } : { tool_key: 'ks_x', tool_name: toolName }),
    });
    for (const toolName of ['../../evil', 'ander']) {
        it(`MOET weigeren: een serverantwoord met tool_name ${JSON.stringify(toolName)}`, async () => {
            await expect(runDeviceLogin({ proxy: 'http://127.0.0.1:1', name: 'mytool', fetchImpl: fakeServer(toolName), sleep: async () => {} })).rejects.toMatchObject({ code: 'DEVICE_BAD_RESPONSE' });
        });
    }
    it('de gevraagde naam gaat door', async () => {
        expect(await runDeviceLogin({ proxy: 'http://127.0.0.1:1', name: 'mytool', fetchImpl: fakeServer('mytool'), sleep: async () => {} })).toEqual({ toolKey: 'ks_x', toolName: 'mytool' });
    });
});

describe('proxy: /device/* alleen JSON met een loopback- of IP-Host', () => {
    const servers = [];
    afterEach(() => servers.splice(0).forEach(s => s.close()));
    async function serve() {
        const device = { request: async () => ({ device_code: 'd' }), poll: async () => ({ status: 400, body: { error: 'authorization_pending' } }) };
        const proxy = createProxy({ vault: { isUnlocked: () => true }, registry: {}, audit: { append: async () => {} }, approval: {}, device, newRequestId: () => 'r' });
        const server = http.createServer((req, res) => proxy.handle(req, res));
        servers.push(server);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        return server.address().port;
    }
    const post = (port, headers) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/device/code', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
        req.end('{"client_name":"mytool"}');
    });

    it('een gewone aanvraag (localhost, 127.0.0.1 of een VM-adres als Host, JSON) gaat door', async () => {
        const port = await serve();
        for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `192.168.56.1:${port}`, `[::1]:${port}`]) expect(await post(port, { host, 'content-type': 'application/json' })).toBe(200);
    });

    it('MOET weigeren: een Host met een domeinnaam (DNS-rebinding): 421', async () => {
        const port = await serve();
        expect(await post(port, { host: `evil.example:${port}`, 'content-type': 'application/json' })).toBe(421);
    });

    it('MOET weigeren: geen JSON (een HTML-formulier of text/plain zonder CORS-preflight): 415', async () => {
        const port = await serve();
        for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) expect(await post(port, { host: `127.0.0.1:${port}`, ...(type ? { 'content-type': type } : {}) })).toBe(415);
    });
});
