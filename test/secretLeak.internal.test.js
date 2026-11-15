// The leak detector must reject what it is there to catch.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fakeSecret, findLeaks, readTree } from './helpers/secretLeak.js';

describe('secret leak detector', () => {
    const secret = fakeSecret('github');

    it('finds a secret in plain text, base64, URL-encoded and hex', () => {
        expect(findLeaks({ log: `token=${secret}` }, [secret])).toHaveLength(1);
        expect(findLeaks({ body: Buffer.from(secret).toString('base64') }, [secret])[0]).toMatch(/base64/);
        expect(findLeaks({ url: `?k=${encodeURIComponent(secret)}` }, [secret])).toHaveLength(1);
        expect(findLeaks({ dump: Buffer.from(secret).toString('hex') }, [secret])[0]).toMatch(/hex/);
    });

    it('reports where, never the full value', () => {
        const [leak] = findLeaks({ 'audit.log': secret }, [secret]);
        expect(leak).toMatch(/^audit\.log: /);
        expect(leak).not.toContain(secret);
    });

    it('is quiet when the value is absent (no false alarm on a redaction)', () => {
        expect(findLeaks({ response: 'Authorization: Bearer ***' }, [secret])).toEqual([]);
    });

    it('test isolation: no credential-like env var and a private VAULTGATE_HOME', () => {
        // VAULTGATE_HOME is the temp path the isolation itself sets; every other credential-like name must be gone.
        expect(Object.keys(process.env).filter(name => name !== 'VAULTGATE_HOME' && /(KEY|TOKEN|SECRET|PASSWORD)/i.test(name))).toEqual([]);
        expect(fs.existsSync(process.env.VAULTGATE_HOME)).toBe(true);
    });
});

// Ubuntu-build in CI (2026-10-10): op Linux ligt het tray-socket (`tray-*.sock`) in de thuismap, en lezen gaf ENXIO.
describe('readTree: alle bestanden op schijf, voor de lekcontrole', () => {
    const secret = fakeSecret('tree');
    it('leest gewone bestanden, ook in submappen', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readtree-'));
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'sub', 'a.bin'), secret);
        expect(findLeaks(readTree(dir), [secret])).toHaveLength(1);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it.skipIf(process.platform === 'win32')('slaat een Unix-socket over in plaats van te falen', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readtree-'));
        const server = net.createServer();
        await new Promise(resolve => server.listen(path.join(dir, 'tray-x.sock'), resolve));
        try {
            expect(Object.keys(readTree(dir))).toEqual([]);
        } finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
