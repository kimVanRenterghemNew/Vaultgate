// Een kleinere portaalbundel (Lighthouse - minify & tree-shaking).
// De bundel is geminificeerd, kleiner dan de ongeminificeerde versie, en bevat geen secrets of tool-keys.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTAL_BUNDLE = path.join(ROOT, 'web', 'portal', 'portal.generated.js');
const TOUCH_BUNDLE = path.join(ROOT, 'web', 'portal', 'touch.generated.js');

const TOOL_KEY = /\bks_[A-Za-z0-9_-]{20,}/;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9]{20,}|fake-secret-[A-Za-z0-9]+)\b/;

function findSecretsOrKeys(text) {
    const hits = [];
    const keyMatch = TOOL_KEY.exec(text);
    if (keyMatch) hits.push(`tool-key: ${keyMatch[0]}`);
    const secMatch = SECRET_PATTERN.exec(text);
    if (secMatch) hits.push(`secret: ${secMatch[0]}`);
    return hits;
}

describe('portaalbundel (4.56, Lighthouse)', () => {
    it('Given npm run build When bundels gemaakt Then geminificeerd en kleiner dan 280 KB', () => {
        expect(fs.existsSync(PORTAL_BUNDLE)).toBe(true);
        expect(fs.existsSync(TOUCH_BUNDLE)).toBe(true);

        const portalStat = fs.statSync(PORTAL_BUNDLE);
        const touchStat = fs.statSync(TOUCH_BUNDLE);

        // Oorspronkelijk was portal > 300 KiB, touch > 105 KiB
        expect(portalStat.size).toBeLessThan(280 * 1024);
        expect(touchStat.size).toBeLessThan(95 * 1024);

        // Geminificeerd: geen ontwikkelcommentaar zoals "// Secrets als inspector"
        const portalText = fs.readFileSync(PORTAL_BUNDLE, 'utf8');
        expect(portalText).not.toContain('// Secrets als inspector');
        expect(portalText).not.toContain('/* Edit: de naam');
    });

    it('Given de bundel When gecontroleerd Then staan er geen secret-waarden of tool-keys in', () => {
        for (const file of [PORTAL_BUNDLE, TOUCH_BUNDLE]) {
            const content = fs.readFileSync(file, 'utf8');
            expect(findSecretsOrKeys(content)).toEqual([]);
        }
    });

    it('MOET weigeren: een geplant nep-secret of tool-key in een bundel faalt de controle', () => {
        const dummyWithSecret = 'const a = "sk-1234567890abcdef1234567890";';
        const dummyWithKey = 'const k = "ks_abcdefghijklmnopqrstuvwx12345";';
        expect(findSecretsOrKeys(dummyWithSecret)).toHaveLength(1);
        expect(findSecretsOrKeys(dummyWithKey)).toHaveLength(1);
    });
});
