// Gelijktijdig werk op de kluis. Een update schrijft een nieuwe versie en wist de oude; een lezer die de oude versie nog
// opzocht, mag dat niet als manipulatie zien (VAULT_TAMPERED). En opnieuw ontgrendelen terwijl een update loopt, mag het
// pas geschreven record niet als "verouderd" opruimen (dat was dataverlies). Een store die lezen of de header-write
// tegenhoudt tot de test ze vrijgeeft, maakt de volgorde vast; geen timers, want die vuren onder last te laat.
import { describe, it, expect } from 'vitest';
import { createVault } from '../../src/vault/index.js';
import { MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';
import { crypto, fakeClock } from './fixtures.js';

/** Een poort: `wait()` blijft hangen tot `open()`; `entered` lost op zodra iemand wacht. */
function gate() {
    let open, entered;
    const opened = new Promise(r => { open = r; });
    const reached = new Promise(r => { entered = r; });
    return { wait: () => { entered(); return opened; }, open, entered: reached };
}

function heldStore() {
    const store = choose('store', 'memory', {});
    let reads = null;
    let header = null;
    const held = {
        ...store,
        read: async name => { if (reads) await reads.wait(); return store.read(name); },
        write: async (name, data) => { if (name === 'vault.json' && header) await header.wait(); return store.write(name, data); },
    };
    return { store: held, holdReads: () => (reads = gate()), holdHeader: () => (header = gate()) };
}

describe('kluis: lezen tijdens een update', () => {
    it('Given een record When het gelezen wordt terwijl een update de oude versie wist Then geeft lezen de nieuwe inhoud, geen VAULT_TAMPERED', async () => {
        const { store, holdReads } = heldStore();
        const vault = createVault({ store, crypto, clock: fakeClock(), kdf: MIN_KDF });
        await vault.create({ passphrase: 'gelijktijdig' });
        const id = await vault.put({ kind: 'tlspin', n: 0 });
        const reopened = createVault({ store, crypto, clock: fakeClock(), kdf: MIN_KDF }); // lege cache, zoals na een herstart
        await reopened.load();
        await reopened.unlockWithPassphrase('gelijktijdig');
        const reads = holdReads();
        const reading = reopened.get(id, ['n']);
        await reads.entered; // de lezer zocht versie 1 op en wacht op het bestand
        await reopened.put({ kind: 'tlspin', n: 1 }, id); // schrijft versie 2 en wist versie 1
        reads.open();
        expect(await reading).toEqual({ n: 1 });
    });

    it('MOET weigeren: een record waarvan het bestand echt ontbreekt, blijft VAULT_TAMPERED', async () => {
        const { store } = heldStore();
        const vault = createVault({ store, crypto, clock: fakeClock(), kdf: MIN_KDF });
        await vault.create({ passphrase: 'weg' });
        const id = await vault.put({ kind: 'tlspin', n: 0 });
        const reopened = createVault({ store, crypto, clock: fakeClock(), kdf: MIN_KDF });
        await reopened.load();
        await reopened.unlockWithPassphrase('weg');
        await store.remove(`records/${id}.1.json`);
        await expect(reopened.get(id)).rejects.toMatchObject({ code: 'VAULT_TAMPERED' });
    });

    it('Given een update die haar nieuwe versie al schreef When de kluis intussen opnieuw ontgrendeld wordt Then blijft het record leesbaar', async () => {
        const { store, holdHeader } = heldStore();
        const vault = createVault({ store, crypto, clock: fakeClock(), kdf: MIN_KDF });
        await vault.create({ passphrase: 'opnieuw' });
        const id = await vault.put({ kind: 'tlspin', n: 0 });
        const header = holdHeader();
        const updating = vault.put({ kind: 'tlspin', n: 1 }, id);
        await header.entered; // het recordbestand van versie 2 staat er, de header nog niet
        // Pas vrijgeven als het ontgrendelen klaar is en een ongeordende opruiming al had kunnen lopen (de memory-store
        // werkt alleen met microtasks, setImmediate komt daarna).
        vault.onChange(() => setImmediate(header.open));
        await vault.unlockWithPassphrase('opnieuw');
        await updating;
        expect(await vault.get(id, ['n'])).toEqual({ n: 1 });
    });
});
