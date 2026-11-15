// Audit-log versleuteld, append-only, zonder waarden. Elke regel apart verzegeld (crypto_box_seal) naar de
// audit-sleutel van de kluis: schrijven kan ook vergrendeld (weigeringen met vault-locked), lezen alleen ontgrendeld.
import { describe, it, expect } from 'vitest';
import { newVault, fakeClock } from '../vault/fixtures.js';
import { createAudit } from '../../src/audit/index.js';
import { VAULT_LOCKED } from '../../src/vault/index.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

async function setup(options = {}) {
    const clock = fakeClock();
    const ctx = newVault({ store: 'local', clock });
    await ctx.vault.create({ passphrase: 'p' });
    const audit = createAudit({ vault: ctx.vault, store: ctx.store, clock, ...options });
    return { ...ctx, audit, clock };
}

async function allFiles(store) {
    const out = {};
    for (const name of await store.list('')) out[name] = await store.read(name);
    return out;
}

describe('audit', () => {
    it('Given 100 beslissingen When de audit-bestanden doorzocht Then staan er geen namen of hosts leesbaar in, en lezen geeft 100 regels', async () => {
        const { audit, store, clock } = await setup();
        for (let i = 0; i < 100; i++) {
            clock.advance(100); // 10 s in totaal: binnen de auto-lock van de fixture (audit-schrijven is geen kluisactiviteit)
            await audit.append({ tool: 'mytool-tool', secret: 'github_token', host: 'https://api.github.com', client: '127.0.0.1', allow: i % 3 !== 0, rule: i % 3 ? 'granted' : 'target-host-not-allowed', status: i % 3 ? 200 : 403, requestId: `r${i}` });
        }
        const files = await allFiles(store);
        const text = Object.values(files).map(b => b.toString('latin1')).join('\n');
        for (const plain of ['mytool-tool', 'github_token', 'api.github.com', 'target-host-not-allowed', '127.0.0.1']) expect(text).not.toContain(plain);
        const lines = await audit.read({ limit: 1000 });
        expect(lines).toHaveLength(100);
        expect(lines[0]).toMatchObject({ requestId: 'r99', tool: 'mytool-tool', secret: 'github_token' }); // laatste eerst
    }, 30_000); // 100 x fsync; onder parallelle journeys trager dan de standaard 5 s

    it('bevat nooit waarden: velden buiten de whitelist (waarde, body, headers) worden niet bewaard', async () => {
        const { audit, store } = await setup();
        const value = fakeSecret('audit');
        await audit.append({ tool: 't', secret: 's', allow: true, rule: 'granted', value, body: `{"k":"${value}"}`, headers: { authorization: value } });
        const [entry] = await audit.read();
        expect(Object.keys(entry).sort()).toEqual(['allow', 'rule', 'secret', 't', 'tool']);
        expect(findLeaks({ ...(await allFiles(store)), read: JSON.stringify(entry) }, [value])).toEqual([]);
    });

    it('schrijven werkt vergrendeld (weigeringen met vault-locked worden ook geaudit), lezen niet', async () => {
        const { audit, vault } = await setup();
        vault.lock();
        await audit.append({ allow: false, rule: 'vault-locked', status: 423, client: '127.0.0.1' });
        await expect(audit.read()).rejects.toMatchObject({ code: VAULT_LOCKED });
        await vault.unlockWithPassphrase('p');
        expect(await audit.read()).toMatchObject([{ rule: 'vault-locked' }]);
    });

    it('filtert op tool, secret, host en beslissing', async () => {
        const { audit } = await setup();
        await audit.append({ tool: 'a', secret: 's1', host: 'https://h1', allow: true, rule: 'granted' });
        await audit.append({ tool: 'b', secret: 's2', host: 'https://h2', allow: false, rule: 'no-grant' });
        await audit.append({ tool: 'a', secret: 's2', host: 'https://h2', allow: false, rule: 'approval-denied' });
        expect((await audit.read({ tool: 'a' })).map(e => e.rule)).toEqual(['approval-denied', 'granted']);
        expect((await audit.read({ decision: 'deny' })).map(e => e.rule)).toEqual(['approval-denied', 'no-grant']);
        expect((await audit.read({ decision: 'allow', secret: 's1', host: 'https://h1' })).map(e => e.rule)).toEqual(['granted']);
    });

    it('since: alleen regels vanaf een tijdstip (de tellers van vandaag); count (aantal vervangingen) blijft bewaard', async () => {
        const { audit, clock } = await setup();
        await audit.append({ tool: 'a', allow: true, rule: 'granted' });
        clock.advance(10_000); // korter dan het auto-vergrendelen van de fixture (60 s)
        const since = clock.now();
        await audit.append({ tool: 'a', allow: false, rule: 'response-scrubbed', count: 2 });
        clock.advance(1000);
        await audit.append({ tool: 'b', allow: false, rule: 'target-host-not-allowed' });
        expect((await audit.read({ since })).map(e => e.rule)).toEqual(['target-host-not-allowed', 'response-scrubbed']);
        expect((await audit.read({ since })).find(e => e.rule === 'response-scrubbed').count).toBe(2);
        expect(await audit.read({ since: clock.now() + 1 })).toEqual([]);
    });

    it('grootte begrensd: rotatie over segmenten, de oudste verdwijnen, ook de nieuwe segmenten zijn versleuteld', async () => {
        const { audit, store } = await setup({ maxSegmentBytes: 2000, maxSegments: 3 });
        for (let i = 0; i < 60; i++) await audit.append({ tool: 'mytool-tool', allow: true, rule: 'granted', requestId: `r${i}` });
        const segments = await store.list('audit/');
        expect(segments.length).toBe(3);
        const lines = await audit.read({ limit: 1000 });
        expect(lines[0].requestId).toBe('r59');
        expect(lines.length).toBeLessThan(60);
        const text = (await Promise.all(segments.map(s => store.read(s)))).map(b => b.toString()).join('');
        expect(text).not.toContain('mytool-tool');
    });

    it('een beschadigde regel wordt overgeslagen en geteld, niet stil verborgen', async () => {
        const { audit, store } = await setup();
        await audit.append({ tool: 'a', allow: true, rule: 'granted' });
        const [segment] = await store.list('audit/');
        await store.append(segment, Buffer.from('kapot\n'));
        await audit.append({ tool: 'b', allow: true, rule: 'granted' });
        expect((await audit.read()).map(e => e.tool)).toEqual(['b', 'a']);
        expect(audit.stats().unreadable).toBe(1);
    });
});

describe('audit: limiet en waardetypes', () => {
    it('read stopt bij de limiet; getallen en booleans blijven hun type, lange tekst wordt afgekapt', async () => {
        const { audit } = await setup();
        for (let i = 0; i < 5; i++) await audit.append({ tool: 'x'.repeat(500), allow: false, status: 403, rule: 'no-grant', requestId: `r${i}` });
        const lines = await audit.read({ limit: 2 });
        expect(lines.map(l => l.requestId)).toEqual(['r4', 'r3']);
        expect(lines[0]).toMatchObject({ allow: false, status: 403 });
        expect(lines[0].tool).toHaveLength(200);
        expect((await audit.read({ rule: 'granted' }))).toEqual([]);
    });
});
