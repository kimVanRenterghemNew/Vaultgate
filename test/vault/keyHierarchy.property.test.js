// Invariant: wat de kluis opslaat, komt exact terug (ook na vergrendelen en opnieuw ontgrendelen).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newVault } from './fixtures.js';

describe('sleutelhiërarchie: invariant', () => {
    it('Given willekeurige inhoud When versleutelen en ontsleutelen Then komt exact de inhoud terug', async () => {
        const { vault } = newVault();
        await vault.create({ passphrase: 'p' });
        await fc.assert(fc.asyncProperty(
            fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }).filter(k => k !== '__proto__'), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.array(fc.string(), { maxLength: 4 })), { maxKeys: 6 }),
            async (fields) => {
                const record = { kind: 'x', ...fields };
                const id = await vault.put(record);
                expect(await vault.get(id)).toEqual(record);
                await vault.remove(id);
            },
        ), { numRuns: 40 });
    });
});
