// Het portaal draait nooit op een niet-lokaal adres. Met zo'n configuratie weigert het proces te starten, met een
// duidelijke melding (exitcode 2).
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { tempHome, MAIN } from '../helpers/journey.js';
import { assertLocalPortalHost, PORTAL_NOT_LOCAL } from '../../src/portal/index.js';

function run(args) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [MAIN, '--home', tempHome(), '--proxy-port', '0', '--portal-port', '0', '--tray', 'none', ...args]);
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('exit', code => resolve({ code, out }));
    });
}

describe('portaal alleen lokaal', () => {
    it('Given een portaalconfiguratie met een niet-lokaal adres When het portaal start Then weigert het te starten met een duidelijke melding', async () => {
        for (const host of ['0.0.0.0', '192.168.56.1']) {
            const { code, out } = await run(['--portal-host', host]);
            expect(code, host).toBe(2);
            expect(out).toContain('PORTAL_NOT_LOCAL');
            expect(out).toContain('loopback');
        }
    }, 30_000);

    it('loopback-adressen en localhost mogen; al de rest niet', () => {
        for (const ok of ['127.0.0.1', '::1', 'localhost']) expect(assertLocalPortalHost(ok)).toBe(ok);
        for (const bad of ['0.0.0.0', '::', '10.0.0.1', 'example.com', '']) expect(() => assertLocalPortalHost(bad), bad).toThrow(expect.objectContaining({ code: PORTAL_NOT_LOCAL }));
    });
});
