// De helper aan de kant van de tool (`key --name`, git credential helper): de opgeslagen lange sleutel inwisselen voor een
// token, de nieuwe sleutel bewaren (atomair, versleuteld als er een beschermer is) en alleen het token teruggeven. Twee
// helpers tegelijk (twee sessies van dezelfde tool) wisselen na elkaar uit, anders zou de ene de sleutel van de andere
// overschrijven en zou dat als hergebruik opvallen.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { saveKey, readSavedKey, rotateSavedKey, savedKeyPath } from '../../src/device/index.js';

let n = 0;
const home = () => { const dir = path.join(process.env.VAULTGATE_HOME, `exchange-${process.pid}-${n++}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
const OLD = 'ks_00000000000000000000000000000000_oudoudoudoudoudoudoudoud';
const read = (h, name = 'mytool') => readSavedKey({ home: h, name, readFile: f => fs.readFileSync(f, 'utf8') });

/** Een nep-proxy: geeft telkens een nieuwe sleutel en een token; onthoudt welke sleutel aangeboden werd. */
function fakeProxy({ delayMs = 0, answer } = {}) {
    const seen = [];
    let i = 0;
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        seen.push({ url, key: body.tool_key });
        await new Promise(r => setTimeout(r, delayMs));
        i += 1;
        const out = answer?.(i) ?? { status: 200, body: { rule: 'key-exchanged', tool_name: 'mytool', token: `ks_token${i}token${i}token${i}token${i}`, key: `ks_00000000000000000000000000000000_nieuw${i}nieuw${i}nieuw${i}`, expires_in: 600 } };
        return { status: out.status, json: async () => out.body };
    };
    return { fetchImpl, seen };
}

describe('helper: sleutel inwisselen voor een token', () => {
    it('Given een opgeslagen sleutel When key --name Then het token komt terug en de nieuwe sleutel staat in het bestand, met het proxy-adres van login', async () => {
        const h = home();
        saveKey({ home: h, name: 'mytool', key: OLD, protector: null, proxy: 'http://127.0.0.1:9999' });
        const proxy = fakeProxy();
        const token = await rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl });
        expect(token).toBe('ks_token1token1token1token1');
        expect(proxy.seen).toEqual([{ url: 'http://127.0.0.1:9999/device/exchange', key: OLD }]);
        expect(read(h)).toBe('ks_00000000000000000000000000000000_nieuw1nieuw1nieuw1');
        expect(fs.readFileSync(savedKeyPath(h, 'mytool'), 'utf8')).toContain('proxy http://127.0.0.1:9999');
        expect(fs.existsSync(`${savedKeyPath(h, 'mytool')}.lock`)).toBe(false);
    });

    it('een oud bestand zonder proxy-adres: de standaard 127.0.0.1:8484; --proxy wint van het bestand', async () => {
        const h = home();
        fs.mkdirSync(path.join(h, 'clients'), { recursive: true });
        fs.writeFileSync(savedKeyPath(h, 'mytool'), `${OLD}\n`);
        const proxy = fakeProxy();
        await rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl });
        await rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl, proxy: 'http://127.0.0.1:7777/' });
        expect(proxy.seen.map(s => s.url)).toEqual(['http://127.0.0.1:8484/device/exchange', 'http://127.0.0.1:7777/device/exchange']);
    });

    it('MOET weigeren: Vaultgate weigert (hergebruik): een fout met de regel, het bestand blijft zoals het was', async () => {
        const h = home();
        saveKey({ home: h, name: 'mytool', key: OLD, protector: null });
        const before = fs.readFileSync(savedKeyPath(h, 'mytool'), 'utf8');
        const proxy = fakeProxy({ answer: () => ({ status: 401, body: { error: 'key-reuse-detected', rule: 'key-reuse-detected' } }) });
        await expect(rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl })).rejects.toMatchObject({ code: 'KEY_EXCHANGE_FAILED', message: expect.stringContaining('key-reuse-detected') });
        expect(fs.readFileSync(savedKeyPath(h, 'mytool'), 'utf8')).toBe(before);
    });

    it('MOET weigeren: een antwoord zonder geldige sleutel of token wordt niet bewaard', async () => {
        const h = home();
        saveKey({ home: h, name: 'mytool', key: OLD, protector: null });
        const proxy = fakeProxy({ answer: () => ({ status: 200, body: { token: 'geen-key', key: '../../x' } }) });
        await expect(rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl })).rejects.toMatchObject({ code: 'KEY_EXCHANGE_FAILED' });
        expect(read(h)).toBe(OLD);
    });

    it('twee helpers tegelijk: na elkaar, de tweede biedt de sleutel van de eerste aan', async () => {
        const h = home();
        saveKey({ home: h, name: 'mytool', key: OLD, protector: null });
        const proxy = fakeProxy({ delayMs: 50 });
        const tokens = await Promise.all([1, 2].map(() => rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl })));
        expect(new Set(tokens).size).toBe(2);
        expect(proxy.seen.map(s => s.key)).toEqual([OLD, 'ks_00000000000000000000000000000000_nieuw1nieuw1nieuw1']);
    });

    it('een achtergebleven slot van een gestopt proces houdt niets tegen', async () => {
        const h = home();
        saveKey({ home: h, name: 'mytool', key: OLD, protector: null });
        fs.writeFileSync(`${savedKeyPath(h, 'mytool')}.lock`, '999999999'); // geen levend proces
        const proxy = fakeProxy();
        await expect(rotateSavedKey({ home: h, name: 'mytool', protector: null, fetchImpl: proxy.fetchImpl })).resolves.toMatch(/^ks_token1/);
    });
});
