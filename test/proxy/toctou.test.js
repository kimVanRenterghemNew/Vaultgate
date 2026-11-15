// Hercontrole vlak vóór het ophalen van de waarde, in het echte proces: wat er wijzigt terwijl een request op de tray
// wacht (tool ingetrokken, doelhost uit de allowlist, toekenning verwijderd), wint van de goedkeuring die daarna komt.
// Er vertrekt dan niets naar de doelhost. De nep-tray antwoordt pas als de test het vrijgeeft (FAKE_TRAY_RELEASE).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, PASSPHRASE } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { portalClient } from '../helpers/portalClient.js';

describe.each(MODES)('hercontrole vóór het invullen, %s', (_mode, start) => {
    const value = fakeSecret('toctou');
    const other = fakeSecret('toctou-other');
    let upstream;
    let proc;
    let home;
    let ids;
    let session;
    let asked = 0;

    beforeAll(async () => {
        upstream = await startUpstream();
        home = tempHome();
        ids = await seedVault(home, async ({ registry }) => {
            const demo = await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            await registry.addSecret({ name: 'other', value: other, hosts: [upstream.origin], inject: ['header:a-other'] }); // als eerste header gestuurd: eerst beslist
            const tool = await registry.addTool({ name: 'mytool' });
            const grant = await registry.addGrant({ toolId: tool.id, secretName: 'other', host: upstream.origin, origin: 'portal' });
            return { demo, tool, grant };
        });
        proc = await start(home, { tray: 'fake', env: { FAKE_TRAY_ANSWER: 'once', FAKE_TRAY_LOG: path.join(home, 'asks.jsonl'), FAKE_TRAY_RELEASE: path.join(home, 'release') } });
        // Een sessie met de passphrase en een software-passkey: een doelhost erbij of een key heractiveren vraagt een aanraking.
        session = portalClient(proc.portal);
        await session.raw('POST', '/api/unlock', { passphrase: PASSPHRASE });
        await session.addKey();
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    const portal = async (method, p, body = {}) => {
        const res = await session.call(method, p, body);
        expect(res.status, JSON.stringify(res.data)).toBe(200);
    };
    const call = (auth = 'Bearer {{secret:demo}}', extra = {}) => fetch(`${proc.proxy}/forward/${upstream.origin}/x`, { headers: { ...extra, 'x-vault-gate-tool-key': ids.tool.key, authorization: auth } });

    /** Start de request, wacht tot de tray de vraag kreeg, doet `meanwhile` en geeft dan het antwoord vrij. */
    async function whileWaiting(request, meanwhile) {
        const n = ++asked;
        const pending = request();
        const log = path.join(home, 'asks.jsonl');
        const deadline = Date.now() + 10_000;
        while ((!fs.existsSync(log) || fs.readFileSync(log, 'utf8').trim().split('\n').length < n) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        await meanwhile();
        fs.writeFileSync(path.join(home, `release.${n}`), '');
        return pending;
    }

    it('Given een request die op goedkeuring wacht When er intussen niets wijzigt en de tray keurt goed Then gaat ze door', async () => {
        const res = await whileWaiting(call, async () => {});
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([200, 'approved-once']);
        expect(upstream.requests.at(-1).headers.authorization).toBe(`Bearer ${value}`);
    }, 20_000);

    it('Given een request die op goedkeuring wacht When de doelhost intussen uit de allowlist gaat en de tray keurt goed Then target-host-not-allowed en er vertrekt niets', async () => {
        const before = upstream.requests.length;
        try {
            const res = await whileWaiting(call, () => portal('PUT', `/api/secrets/${ids.demo}/hosts`, { hosts: ['https://elders.example'] }));
            expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'target-host-not-allowed']);
            expect(upstream.requests.length).toBe(before);
        } finally {
            await portal('PUT', `/api/secrets/${ids.demo}/hosts`, { hosts: [upstream.origin] });
        }
    }, 20_000);

    it('Given een request voor twee secrets waarvan één toegekend When die toekenning intussen verdwijnt en de tray keurt de andere goed Then needs-approval en er vertrekt niets', async () => {
        const before = upstream.requests.length;
        const res = await whileWaiting(() => call('Bearer {{secret:demo}}', { 'a-other': '{{secret:other}}' }), () => portal('DELETE', `/api/grants/${ids.grant}`));
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([403, 'needs-approval']);
        expect(upstream.requests.length).toBe(before);
    }, 20_000);

    it('Given een request die op goedkeuring wacht When de tool intussen wordt ingetrokken en dan goedgekeurd Then tool-key-revoked en er vertrekt niets', async () => {
        const before = upstream.requests.length;
        const res = await whileWaiting(call, () => portal('POST', `/api/tools/${ids.tool.id}/revoke`));
        expect([res.status, res.headers.get('x-vault-gate-rule')]).toEqual([401, 'tool-key-revoked']);
        const body = await res.text();
        expect(upstream.requests.length).toBe(before);
        expect(findLeaks({ body, output: proc.output() }, [value, other])).toEqual([]);
    }, 20_000);
});
