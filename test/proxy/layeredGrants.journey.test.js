// Een tijdelijke regel boven een vaste: met een vaste toekenning "elke keer vragen" en een tijdelijke "stil" gaan de
// calls stil door zolang de tijdelijke loopt; daarna vraagt de tray weer, en de vaste toekenning veranderde niet.
// In-process met de nep-tray (die hier weigert, zodat een vraag zichtbaar is als approval-denied).
import { describe, it, expect, afterAll } from 'vitest';
import { tempHome, seedVault, startInProcess } from '../helpers/journey.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('layered');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

describe('een tijdelijke regel boven een vaste', () => {
    it('Given een vaste "elke keer vragen" en een tijdelijke "stil, 4 s" When calls binnen de 4 s Then stil door; When daarna Then vraagt de tray weer', async () => {
        const upstream = await startUpstream();
        cleanup.push(() => upstream.close());
        const home = tempHome();
        const key = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            const tool = await registry.addTool({ name: 'mytool' });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal', mode: 'confirm', expiresAt: null });
            await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'tray', mode: 'silent', expiresAt: Date.now() + 4_000 });
            return tool.key;
        });
        const proc = await startInProcess(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: 'deny' } });
        cleanup.push(() => proc.stop());
        const call = () => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } });

        for (let i = 0; i < 2; i++) {
            const res = await call();
            expect(res.status).toBe(200);
            expect(res.headers.get('x-vault-gate-rule')).toBe('granted');
        }
        const [entry] = await proc.app.audit.read({ limit: 1 });
        expect(entry).toMatchObject({ rule: 'granted', detail: 'temporary' }); // de audit zegt dat de tijdelijke regel besliste
        await new Promise(r => setTimeout(r, 4_500));
        const after = await call();
        expect(after.headers.get('x-vault-gate-rule')).toBe('approval-denied'); // de vaste regel vraagt weer; de nep-tray weigert
        expect(findLeaks({ out: proc.output() }, [value, key])).toEqual([]); // nergens in de uitvoer van het proces
    }, 30_000);
});
