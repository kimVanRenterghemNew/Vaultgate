// Contract van de `store`-poort: dezelfde eisen over elke implementatie die
// src/composition.js registreert. Een store bewaart bytes onder een naam; ze beslist nooit iets (geen toegang, geen sleutels).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IMPLEMENTATIONS } from '../../src/composition.js';
import { INVALID_NAME } from '../../src/store/index.js';

const PORT_METHODS = ['append', 'list', 'quarantine', 'read', 'remove', 'write'];
let counter = 0;
const freshDir = () => path.join(process.env.VAULTGATE_HOME, `store-${process.pid}-${counter++}`);

describe.each(Object.entries(IMPLEMENTATIONS.store))('store: %s', (name, create) => {
    let store;
    beforeEach(() => { store = create({ dir: freshDir() }); });

    it('heeft precies de methodes van de poort (een store kan niet "toestaan" of sleutels geven)', () => {
        expect(Object.keys(store).sort()).toEqual(PORT_METHODS);
    });

    it('een onbekende naam leest als null', async () => {
        expect(await store.read('records/nope.json')).toBeNull();
    });

    it('schrijven en lezen geeft dezelfde bytes; overschrijven vervangt', async () => {
        await store.write('vault.json', Buffer.from('een'));
        await store.write('vault.json', Buffer.from('twee'));
        expect((await store.read('vault.json')).toString()).toBe('twee');
    });

    it('append voegt toe aan het einde', async () => {
        await store.append('audit/0001.log', Buffer.from('a\n'));
        await store.append('audit/0001.log', Buffer.from('b\n'));
        expect((await store.read('audit/0001.log')).toString()).toBe('a\nb\n');
    });

    it('list geeft de namen onder een voorvoegsel, gesorteerd; remove verwijdert', async () => {
        await store.write('records/b.json', Buffer.from('1'));
        await store.write('records/a.json', Buffer.from('2'));
        await store.write('vault.json', Buffer.from('3'));
        expect(await store.list('records/')).toEqual(['records/a.json', 'records/b.json']);
        await store.remove('records/a.json');
        expect(await store.list('records/')).toEqual(['records/b.json']);
        await store.remove('records/does-not-exist.json'); // geen fout
    });

    it('quarantaine verplaatst een bestand weg van zijn naam, zonder het te verwijderen of te overschrijven', async () => {
        await store.write('records/x.json', Buffer.from('kapot'));
        const moved = await store.quarantine('records/x.json');
        expect(moved).toMatch(/^quarantine\//);
        expect(await store.read('records/x.json')).toBeNull();
        expect((await store.read(moved)).toString()).toBe('kapot');
        expect(await store.list('records/')).toEqual([]);
    });

    it('MOET weigeren: namen die buiten de kluis wijzen of vreemde tekens hebben', async () => {
        for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\\b', '', 'a//b', 'records/']) {
            await expect(store.write(bad, Buffer.from('x')), bad).rejects.toMatchObject({ code: INVALID_NAME });
            await expect(store.read(bad), bad).rejects.toMatchObject({ code: INVALID_NAME });
        }
    });
});

describe('store: local (specifiek voor bestanden)', () => {
    it('schrijft atomisch: geen tijdelijke bestanden achter, en een bestaande versie blijft heel tot de rename', async () => {
        const dir = freshDir();
        const store = IMPLEMENTATIONS.store.local({ dir });
        await store.write('vault.json', Buffer.from('v1'));
        await Promise.all(Array.from({ length: 20 }, (_, i) => store.write('vault.json', Buffer.from(`v${i + 2}`))));
        expect((await store.read('vault.json')).toString()).toMatch(/^v\d+$/);
        expect(fs.readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([]);
    });

    it('een fout die geen "bestaat niet" is, komt luid terug (lezen van een map, lijst onder een bestand, rename op een map)', async () => {
        const dir = freshDir();
        const store = IMPLEMENTATIONS.store.local({ dir });
        await store.write('records/a.json', Buffer.from('x'));
        await expect(store.read('records')).rejects.toMatchObject({ code: expect.stringMatching(/EISDIR|EPERM|EACCES/) });
        fs.mkdirSync(path.join(dir, 'blocked.json'));
        await expect(store.write('blocked.json', Buffer.from('x'))).rejects.toHaveProperty('code');
        await expect(store.list('records/a.json/')).resolves.toEqual([]);
        fs.writeFileSync(path.join(dir, 'file'), 'x');
        await expect(store.append('file/x', Buffer.from('x'))).rejects.toHaveProperty('code');
    }, 15_000);
});
