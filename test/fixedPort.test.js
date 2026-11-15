import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { fixedPort } from './helpers/fixedPort.js';

const listen = (port, host) => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, host, () => resolve(s)); });

describe('fixedPort', () => {
    it('Given listen(0) ports from the ephemeral range When a fixed port is picked Then it lies below that range and can be bound', async () => {
        const ephemeral = await listen(0, '127.0.0.1');
        const port = await fixedPort();
        expect(port).toBeGreaterThanOrEqual(20_000);
        expect(port).toBeLessThan(32_000);
        expect(port).toBeLessThan(ephemeral.address().port);
        const s = await listen(port, '127.0.0.1');
        await new Promise(r => s.close(r));
        await new Promise(r => ephemeral.close(r));
    });

    it('never returns a port that is taken', async () => {
        const taken = await Promise.all(Array.from({ length: 5 }, () => fixedPort()).map(async p => listen(await p, '127.0.0.1')));
        const ports = new Set(taken.map(s => s.address().port));
        for (let i = 0; i < 20; i++) expect(ports.has(await fixedPort())).toBe(false);
        await Promise.all(taken.map(s => new Promise(r => s.close(r))));
    });
});
