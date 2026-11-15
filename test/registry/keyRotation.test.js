// Tool-keys die vanzelf roteren: de helper wisselt de lange sleutel in voor een token van 10 minuten en een nieuwe lange
// sleutel. Alleen hashes in de kluis, tokens alleen in het geheugen. Hergebruik van een oude sleutel trekt de tool in.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { newVault, fakeClock, crypto } from '../vault/fixtures.js';
import { createRegistry, TOKEN_MS } from '../../src/registry/index.js';

let vault;
let registry;
let clock;
let store;
beforeEach(async () => {
    clock = fakeClock();
    ({ vault, store } = newVault({ clock }));
    await vault.create({ passphrase: 'p' });
    registry = createRegistry({ vault, clock, crypto });
});

/** Alles wat de store bewaart, als tekst. */
const dump = async s => (await Promise.all((await s.list('')).map(async n => `${n}:${(await s.read(n)).toString('latin1')}`))).join(' | ');

const exchange = (key, extra = {}) => registry.exchangeToolKey(key, { client: '127.0.0.1', ...extra });

describe('registry: uitwisselen en roteren', () => {
    it('Given een tool When ze 3 keer uitwisselt Then telkens een nieuw token en een nieuwe sleutel, en het token opent de tool', async () => {
        const { id, key } = await registry.addTool({ name: 'agent' });
        expect((await registry.findToolByKey(key))).toMatchObject({ id, rotating: false, via: 'key' });
        const seen = new Set([key]);
        let current = key;
        for (let i = 1; i <= 3; i++) {
            const r = await exchange(current);
            expect(r).toMatchObject({ allow: true, rule: 'key-exchanged', generation: i, expiresIn: TOKEN_MS / 1000 });
            expect(r.token).toMatch(/^ks_/);
            expect(r.key).toMatch(/^ks_/);
            expect(seen.has(r.token) || seen.has(r.key)).toBe(false);
            seen.add(r.token).add(r.key);
            expect(await registry.findToolByKey(r.token)).toMatchObject({ id, name: 'agent', rotating: true, via: 'token' });
            current = r.key;
        }
        // Een roterende tool: de lange sleutel opent niets meer rechtstreeks (via 'key' -> regel token-required in policy).
        expect(await registry.findToolByKey(current)).toMatchObject({ via: 'key', rotating: true });
    });

    it('MOET weigeren: een oude lange sleutel na twee rotaties: key-reuse-detected, tool ingetrokken, tokens ongeldig', async () => {
        const { id, key: first } = await registry.addTool({ name: 'agent' });
        const a = await exchange(first);
        const b = await exchange(a.key);
        const reused = await exchange(first);
        expect(reused).toMatchObject({ allow: false, rule: 'key-reuse-detected', status: 401, tool: { id, name: 'agent' } });
        expect(reused.token).toBeUndefined();
        expect(reused.key).toBeUndefined();
        expect((await registry.listTools())[0].revoked).toBe(true);
        expect(await registry.findToolByKey(b.token)).toBeNull();
        // Ook de nieuwste sleutel werkt niet meer: de familie is gesloten (heractiveren vraagt Rotate en opnieuw koppelen).
        expect(await exchange(b.key)).toMatchObject({ allow: false, rule: 'tool-key-revoked' });
    });

    it('genadeperiode: crash vóór het bewaren; de vorige sleutel werkt nog één keer, en wie daarna de verloren sleutel gebruikt, valt op', async () => {
        await registry.addTool({ name: 'agent' });
        const { key: c } = await registry.addTool({ name: 'other' });
        const lost = await exchange(c); // het antwoord kwam nooit in het bestand
        const again = await exchange(c);
        expect(again).toMatchObject({ allow: true, rule: 'key-exchanged', grace: true, generation: 2 });
        const next = await exchange(again.key);
        expect(next).toMatchObject({ allow: true, grace: false, generation: 3 });
        // Beide gebruikt: de sleutel uit de eerste uitwisseling is vervangen, en wie ze aanbiedt, heeft een kopie.
        expect(await exchange(lost.key)).toMatchObject({ allow: false, rule: 'key-reuse-detected' });
    });

    it('MOET weigeren: de vorige sleutel nadat de nieuwe gebruikt is (de genade is voorbij)', async () => {
        const { key: c } = await registry.addTool({ name: 'agent' });
        const n = await exchange(c);
        await exchange(n.key);
        expect(await exchange(c)).toMatchObject({ allow: false, rule: 'key-reuse-detected' });
    });

    it('MOET weigeren: een token na 10 minuten (nepklok), en een token als lange sleutel', async () => {
        const { key } = await registry.addTool({ name: 'agent' });
        const r = await exchange(key);
        clock.advance(TOKEN_MS - 1);
        expect(await registry.findToolByKey(r.token)).not.toBeNull();
        clock.advance(1);
        expect(await registry.findToolByKey(r.token)).toBeNull();
        expect(await exchange(r.token)).toMatchObject({ allow: false, rule: 'no-tool-key' });
    });

    it('MOET weigeren: Rotate, Revoke, verwijderen en Log out maken de tokens meteen ongeldig', async () => {
        const make = async name => { const { id, key } = await registry.addTool({ name }); return { id, ...(await exchange(key)) }; };
        const rotated = await make('r');
        await registry.rotateToolKey(rotated.id);
        expect(await registry.findToolByKey(rotated.token)).toBeNull();
        const revoked = await make('v');
        await registry.revokeTool(revoked.id);
        expect(await registry.findToolByKey(revoked.token)).toBeNull();
        const removed = await make('d');
        await registry.removeTool(removed.id);
        expect(await registry.findToolByKey(removed.token)).toBeNull();
        const closed = await make('c');
        vault.lock();
        await vault.unlockWithPassphrase('p');
        expect(await registry.findToolByKey(closed.token)).toBeNull();
        // Na Log out werkt de lange sleutel nog: de helper wisselt opnieuw uit.
        expect(await exchange(closed.key)).toMatchObject({ allow: true });
    });

    it('Rotate begint een nieuwe familie: de oude sleutel is gewoon onbekend (geen intrekking), de nieuwe key is handmatig', async () => {
        const { id, key } = await registry.addTool({ name: 'agent' });
        const r = await exchange(key);
        const { key: fresh } = await registry.rotateToolKey(id);
        expect(await exchange(r.key)).toMatchObject({ allow: false, rule: 'no-tool-key' });
        const [tool] = await registry.listTools();
        expect(tool).toMatchObject({ revoked: false, rotating: false });
        expect(await registry.findToolByKey(fresh)).toMatchObject({ id, via: 'key', rotating: false });
    });

    it('MOET weigeren: een client buiten de allowlist van de tool wisselt niet uit', async () => {
        const { key } = await registry.addTool({ name: 'vm', clients: ['192.168.56.10'] });
        expect(await exchange(key, { client: '10.1.1.1' })).toMatchObject({ allow: false, rule: 'client-not-allowed', status: 403 });
        expect(await exchange(key, { client: '192.168.56.10' })).toMatchObject({ allow: true });
    });

    it('opnieuw vragen elke N uur: na de tijd vraagt de uitwisseling een aanraking; geweigerd = geen nieuwe sleutel, de oude blijft', async () => {
        const { id, key } = await registry.addTool({ name: 'agent' });
        await registry.setToolReask(id, 3_600_000);
        const asked = [];
        const confirm = answer => async tool => { asked.push(tool.name); return answer; };
        const first = await exchange(key, { confirm: confirm('ok') });
        expect(first.allow).toBe(true);
        expect(asked).toEqual(['agent']); // nog nooit aangeraakt sinds de instelling
        const second = await exchange(first.key, { confirm: confirm('denied') });
        expect(second.allow).toBe(true);
        expect(asked).toEqual(['agent']); // binnen het uur geen vraag
        clock.advance(3_600_000);
        expect(await exchange(second.key, { confirm: confirm('denied') })).toMatchObject({ allow: false, rule: 'touch-denied' });
        expect(await exchange(second.key, { confirm: confirm('ok') })).toMatchObject({ allow: true });
        expect((await registry.listTools())[0]).toMatchObject({ reaskMs: 3_600_000 });
        await expect(registry.setToolReask(id, -1)).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    });

    it('twee uitwisselingen tegelijk met dezelfde sleutel: na elkaar, nooit twee keer dezelfde opvolger', async () => {
        const { key } = await registry.addTool({ name: 'agent' });
        const [a, b] = await Promise.all([exchange(key), exchange(key)]);
        expect(a.allow && b.allow).toBe(true);
        expect(a.key).not.toBe(b.key);
        expect([a.generation, b.generation].sort()).toEqual([1, 2]);
    });

    it('property: geen lange sleutel of token in de kluis op schijf of in een lijst, na willekeurige reeksen uitwisselingen', async () => {
        await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom('exchange', 'old', 'rotate', 'revoke'), { minLength: 1, maxLength: 6 }), async ops => {
            const c = fakeClock();
            const { vault: v, store: s } = newVault({ clock: c });
            await v.create({ passphrase: 'p' });
            const r = createRegistry({ vault: v, clock: c, crypto });
            const { id, key } = await r.addTool({ name: 'agent' });
            const keys = [key];
            for (const op of ops) {
                if (op === 'rotate') keys.push((await r.rotateToolKey(id)).key);
                else if (op === 'revoke') await r.revokeTool(id);
                else {
                    const out = await r.exchangeToolKey(op === 'old' ? keys[0] : keys.at(-1), { client: '127.0.0.1' });
                    if (out.key) keys.push(out.key, out.token);
                    expect(JSON.stringify(out.tool ?? {})).not.toMatch(/ks_/);
                }
            }
            const disk = await dump(s) + JSON.stringify(await r.listTools());
            for (const k of keys) expect(disk).not.toContain(k);
        }), { numRuns: 15 });
    }, 60_000);

    it('de kluis bewaart geen sleutel: alleen hashes', async () => {
        const { key } = await registry.addTool({ name: 'agent' });
        const r = await exchange(key);
        const raw = await dump(store);
        expect(raw).not.toContain(r.key);
        expect(raw).not.toContain(r.token);
    });
});
