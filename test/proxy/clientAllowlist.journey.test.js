// Standaard luistert de proxy alleen op 127.0.0.1. Een extra luisteradres (bv. naar de VM) komt uit
// de instellingen in de kluis; een client van een niet-toegevoegd adres krijgt client-not-allowed, een toegevoegd adres
// mag. Als "andere machine" gebruiken we het eigen LAN-adres van deze machine (geen loopback).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { startUpstream } from '../helpers/fakeUpstream.js';
import { tempHome, seedVault, MODES, waitForEvent } from '../helpers/journey.js';
import { fakeSecret, findLeaks } from '../helpers/secretLeak.js';
import { fixedPort } from '../helpers/fixedPort.js';

const lanIp = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const value = fakeSecret('vm');
let upstream;
let proc;
let keys;
let port;

describe.each(MODES)('%s', (mode, start) => {
    beforeAll(async () => {
        if (!lanIp) throw new Error('deze test heeft een niet-loopback IPv4-adres nodig op deze machine');
        upstream = await startUpstream();
        port = await fixedPort([lanIp]);
        const home = tempHome();
        keys = await seedVault(home, async ({ registry }) => {
            await registry.addSecret({ name: 'demo', value, hosts: [upstream.origin] });
            await registry.updateSettings({ listeners: [{ host: lanIp, port }] });
            const local = await registry.addTool({ name: 'lokaal' });
            const vm = await registry.addTool({ name: 'agent-vm', clients: [lanIp] });
            for (const t of [local, vm]) await registry.addGrant({ toolId: t.id, secretName: 'demo', host: upstream.origin, origin: 'portal' });
            return { local: local.key, vm: vm.key };
        });
        proc = await start(home);
        await waitForEvent(proc, 'listening-extra');
    }, 30_000);

    afterAll(async () => {
        await proc?.stop();
        await upstream?.close();
    });

    function callFrom(localAddress, host, key) {
        return new Promise((resolve, reject) => {
            const req = http.request({ host, port: host === lanIp ? port : new URL(proc.proxy).port, localAddress, path: `/forward/${upstream.origin}/x`, headers: { 'x-vault-gate-tool-key': key, authorization: 'Bearer {{secret:demo}}' } }, res => {
                res.resume();
                resolve({ status: res.statusCode, rule: res.headers['x-vault-gate-rule'] });
            });
            req.on('error', reject);
            req.end();
        });
    }

    describe('clients van andere machines alleen expliciet', () => {
        it('de standaardpoort luistert alleen op 127.0.0.1: vanaf het LAN-adres is hij niet bereikbaar', async () => {
            const reachable = await new Promise(resolve => { const s = net.connect({ host: lanIp, port: Number(new URL(proc.proxy).port) }, () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
            expect(reachable).toBe(false);
        });

        it('Given een tool zonder dat adres in haar allowlist When een call van dat adres Then client-not-allowed', async () => {
            expect(await callFrom(lanIp, lanIp, keys.local)).toEqual({ status: 403, rule: 'client-not-allowed' });
        });

        it('een tool met het adres in haar allowlist mag van daaruit', async () => {
            expect(await callFrom(lanIp, lanIp, keys.vm)).toEqual({ status: 200, rule: 'granted' });
        });
    });
});

describe('een extra luisteradres dat niet op deze machine bestaat', () => {
    it('geeft listen-failed en laat de rest van het proces draaien', async () => {
        const home = tempHome();
        await seedVault(home, async ({ registry }) => {
            await registry.updateSettings({ listeners: [{ host: '192.0.2.1', port: 9 }] }); // TEST-NET-1 (RFC 5737): nooit lokaal
        });
        const [, startInProcess] = MODES[1];
        const p = await startInProcess(home);
        try {
            expect(await waitForEvent(p, 'listen-failed')).toMatchObject({ host: '192.0.2.1', port: 9 });
            expect((await fetch(`${p.proxy}/forward/http://127.0.0.1:1/x`)).status).toBe(401); // proxy draait nog
        } finally {
            await p.stop();
        }
    });

    it('geen secret of key in de uitvoer van het proces (stdout, stderr, log)', () => {
        expect(findLeaks({ out: proc.output() }, [value, ...Object.values(keys ?? {})].filter(Boolean))).toEqual([]);
    });
});
