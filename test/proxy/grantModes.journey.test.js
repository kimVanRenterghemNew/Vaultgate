// Een toekenning met de soort "melding" laat de call door en meldt dat (hoogstens één keer per
// minuut per toekenning, geen spam); een toekenning waarvan het einde voorbij is, vraagt opnieuw (`grant-expired`).
// In-process met de nep-tray; het echte HTTP-pad van de proxy.
import { describe, it, expect, afterAll } from 'vitest';
import { tempHome, seedVault, startInProcess } from '../helpers/journey.js';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';

const value = fakeSecret('modes');
const cleanup = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

async function scenario(grant, trayAnswer = 'deny') {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const home = tempHome();
    const key = await seedVault(home, async ({ registry }) => {
        await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
        const tool = await registry.addTool({ name: 'mytool' });
        await registry.addGrant({ toolId: tool.id, secretName: 'demo', host: upstream.origin, origin: 'portal', ...grant });
        return tool.key;
    });
    const proc = await startInProcess(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: trayAnswer } });
    cleanup.push(() => proc.stop());
    const call = (headers = {}) => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}', ...headers } });
    return { proc, call, upstream, key };
}

describe('toekenningen: melding en looptijd', () => {
    it('Given een toekenning "melding" When twee calls Then beide door, en één melding (niet twee)', async () => {
        const { proc, call } = await scenario({ mode: 'notify' });
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
        expect(proc.events.filter(e => e.event === 'grant-notified')).toEqual([expect.objectContaining({ tool: 'mytool', secret: 'demo' })]);
        expect(findLeaks({ out: proc.output() }, [value])).toEqual([]);
    });

    it('Given een stille toekenning When een call Then geen melding', async () => {
        const { proc, call } = await scenario({});
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
        expect(proc.events.some(e => e.event === 'grant-notified')).toBe(false);
    });

    it('Given een toekenning "elke keer vragen" When twee calls Then vraagt ze twee keer opnieuw (hier: twee keer eenmalig)', async () => {
        const { call, upstream } = await scenario({ mode: 'confirm' }, 'once');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('approved-once');
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('approved-once');
        expect(upstream.requests).toHaveLength(2);
    });

    it('Given een getimede toekenning When granted Then staat de resterende looptijd in de audit', async () => {
        const { proc, call } = await scenario({ expiresAt: Date.now() + 30_000 });
        expect((await call()).headers.get('x-vault-gate-rule')).toBe('granted');
        const [entry] = await proc.app.audit.read({ limit: 1 });
        expect(entry).toMatchObject({ rule: 'granted', allow: true });
        expect(entry.grantRemainingMs).toBeGreaterThan(0);
        expect(entry.grantRemainingMs).toBeLessThanOrEqual(30_000);
    });

    it('MOET weigeren: een verlopen toekenning laat niets meer stil door; de tray wordt opnieuw gevraagd (hier: weigeren)', async () => {
        const { proc, call, upstream } = await scenario({ expiresAt: Date.now() - 1000 });
        const res = await call();
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'approval-denied']);
        expect(upstream.requests).toHaveLength(0);
        expect(proc.events).toContainEqual(expect.objectContaining({ event: 'grant-expired', tool: 'mytool', secret: 'demo' }));
    });

    it('Given een bestaande toekenning voor Bearer auth When de tool opeens Basic auth stuurt Then vraagt de proxy opnieuw goedkeuring (auth-shape-changed)', async () => {
        const { proc, call, upstream } = await scenario({ authShape: 'header:authorization:bearer' }, 'deny');
        // Eerste call met Bearer auth: matcht de toekenning, gaat stil door
        const res1 = await call();
        expect(res1.status).toBe(200);
        expect(res1.headers.get('x-vault-gate-rule')).toBe('granted');
        expect(upstream.requests).toHaveLength(1);

        // Tweede call met Basic auth: afwijkende verkeersvorm, triggert goedkeuring (tray antwoordt deny -> 403)
        const res2 = await call({ authorization: 'Basic {{basic:demo}}' });
        expect(res2.status).toBe(403);
        expect(res2.headers.get('x-vault-gate-rule')).toBe('approval-denied');
        expect(upstream.requests).toHaveLength(1); // geblokkeerd voor upstream
        expect(findLeaks({ out: proc.output() }, [value])).toEqual([]);
    });

    it('Given een bestaande toekenning voor Bearer auth When de tool Basic auth stuurt en tray keurt goed (always) Then slaagt de call', async () => {
        const { proc, call, upstream } = await scenario({ authShape: 'header:authorization:bearer' }, 'always');
        const res1 = await call();
        expect(res1.status).toBe(200);

        // Tweede call met Basic auth: tray antwoordt always -> zonder passkey approved-once
        const res2 = await call({ authorization: 'Basic {{basic:demo}}' });
        expect(res2.status).toBe(200);
        expect(res2.headers.get('x-vault-gate-rule')).toBe('approved-once');
        expect(upstream.requests).toHaveLength(2);
        expect(findLeaks({ out: proc.output() }, [value])).toEqual([]);
    });
});
