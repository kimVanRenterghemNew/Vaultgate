// Een tool koppelen geeft een blijvende key; daarom pas na een aanraking van de passkey, net als
// "altijd". Een klik in de tray (of het portaal) volstaat niet: die kan een programma geven.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDeviceFlow } from '../../src/device/index.js';
import { createRegistry } from '../../src/registry/index.js';
import { newVault, crypto } from '../vault/fixtures.js';
import { fakeTimers } from '../approval/fixtures.js';

let clock;
let vault;
let registry;
let audited;
beforeEach(async () => {
    clock = fakeTimers();
    ({ vault } = newVault({ clock }));
    await vault.create({ passphrase: 'p' });
    registry = createRegistry({ vault, clock, crypto });
    audited = [];
});

function flowWith(touch) {
    const asked = [];
    const port = touch === undefined ? undefined : { confirm: async q => { asked.push(q); return touch; } };
    const flow = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async e => { audited.push(e); } }, intervalSeconds: 5, ...(port ? { touch: port } : {}) });
    return { flow, asked };
}

describe('koppelen met aanraking', () => {
    it('Given een aanvraag When goedgekeurd en de passkey aangeraakt Then is er een tool, en de vraag toonde naam en code', async () => {
        const { flow, asked } = flowWith('ok');
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        expect(await flow.approve((await flow.pending())[0].id)).toEqual({ approved: true });
        expect((await registry.listTools()).map(t => t.name)).toEqual(['mytool']);
        expect(asked).toEqual([expect.objectContaining({ tool: 'mytool', host: r.user_code, reason: 'device' })]);
    });

    it.each([['denied'], ['timeout'], ['unavailable']])('MOET weigeren: aanraking %s geeft geen tool, de CLI krijgt access_denied', async result => {
        const { flow } = flowWith(result);
        const r = await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        expect(await flow.approve((await flow.pending())[0].id)).toEqual({ denied: `touch-${result}` });
        expect(await registry.listTools()).toEqual([]);
        expect((await flow.poll({ deviceCode: r.device_code, client: '127.0.0.1' })).body).toEqual({ error: 'access_denied' });
        expect(audited.at(-1)).toMatchObject({ tool: 'mytool', allow: false, rule: `touch-${result}` });
    });

    it('MOET weigeren: zonder aanraakmodule is koppelen niet mogelijk', async () => {
        const { flow } = flowWith(undefined);
        await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        expect(await flow.approve((await flow.pending())[0].id)).toEqual({ denied: 'touch-unavailable' });
        expect(await registry.listTools()).toEqual([]);
    });
});

describe('koppelen met aanraking: randgevallen', () => {
    function waiting() {
        let answer;
        const flow = createDeviceFlow({ crypto, clock, registry, vault, audit: { append: async () => {} }, intervalSeconds: 5,
            touch: { confirm: () => new Promise(resolve => { answer = resolve; }) } });
        return { flow, answer: r => answer(r) };
    }

    it('tray en portaal keuren tegelijk goed: de tweede wacht niet op een tweede aanraking', async () => {
        const { flow, answer } = waiting();
        await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const { id } = (await flow.pending())[0];
        const first = flow.approve(id);
        await new Promise(r => setImmediate(r));
        expect(await flow.approve(id)).toEqual({ pending: true });
        answer('ok');
        expect(await first).toEqual({ approved: true });
        expect((await registry.listTools())).toHaveLength(1);
    });

    it('MOET weigeren: de naam ontstaat terwijl de aanraking wacht (geen overname, 9.5)', async () => {
        const { flow, answer } = waiting();
        await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const first = flow.approve((await flow.pending())[0].id);
        await new Promise(r => setImmediate(r));
        await registry.addTool({ name: 'mytool' });
        answer('ok');
        expect(await first).toEqual({ denied: 'device-name-taken' });
        expect(await registry.listTools()).toHaveLength(1);
    });

    it('MOET weigeren: de aanvraag verloopt terwijl de aanraking wacht', async () => {
        const { flow, answer } = waiting();
        await flow.request({ clientName: 'mytool', client: '127.0.0.1' });
        const first = flow.approve((await flow.pending())[0].id);
        await new Promise(r => setImmediate(r));
        await clock.advance(11 * 60_000);
        await flow.pending(); // ruimt verlopen aanvragen op
        answer('ok');
        expect(await first).toEqual({ denied: 'device-expired' });
        expect(await registry.listTools()).toEqual([]);
    });
});
