import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, parseConfigFile, loadConfig, resolveEffectiveConfig } from '../../src/config/index.js';

describe('config module (config.json ipv .env)', () => {
    it('DEFAULT_CONFIG bevat de standaardinstellingen van VaultGate', () => {
        expect(DEFAULT_CONFIG).toEqual({
            home: null,
            proxyPort: 8484,
            portalPort: 8485,
            portalHost: '127.0.0.1',
            tray: 'auto',
            trayCommand: null,
            window: 'app',
            deviceIntervalSeconds: 5,
            unlockStdin: false,
        });
    });

    it('Given geldige JSON When parseConfigFile Then geeft parsed object', () => {
        const json = JSON.stringify({ proxyPort: 9000, portalPort: 9001, portalHost: '0.0.0.0' });
        expect(parseConfigFile(json)).toEqual({ proxyPort: 9000, portalPort: 9001, portalHost: '0.0.0.0' });
    });

    it('Given ongeldige JSON of niet-object When parseConfigFile Then gooit INVALID_CONFIG', () => {
        expect(() => parseConfigFile('{ ongeldig')).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
        expect(() => parseConfigFile('["array"]')).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
        expect(() => parseConfigFile('null')).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
        expect(parseConfigFile('')).toEqual({});
    });

    it('Given een expliciet niet-bestaand bestand When loadConfig Then gooit CONFIG_NOT_FOUND', () => {
        const fsMock = { existsSync: () => false };
        expect(() => loadConfig({ configPath: 'bestaat-niet.json', fsModule: fsMock }))
            .toThrow(expect.objectContaining({ code: 'CONFIG_NOT_FOUND' }));
    });

    it('Given geen configPath en geen config.json in cwd When loadConfig Then geeft DEFAULT_CONFIG', () => {
        const fsMock = { existsSync: () => false };
        expect(loadConfig({ fsModule: fsMock })).toEqual(DEFAULT_CONFIG);
    });

    it('Given een config.json bestand When loadConfig Then overschrijft de standaardwaarden', () => {
        const custom = {
            home: '/custom/vault',
            proxyPort: 8080,
            portalPort: 8081,
            portalHost: '127.0.0.1',
            tray: 'none',
            trayCommand: 'script.mjs',
            window: 'none',
            deviceIntervalSeconds: 10,
            unlockStdin: true,
        };
        const fsMock = {
            existsSync: p => p.endsWith('config.json'),
            readFileSync: () => JSON.stringify(custom),
        };
        const result = loadConfig({ fsModule: fsMock });
        expect(result).toEqual(custom);
    });

    it('Given config en CLI args When resolveEffectiveConfig Then overschrijven CLI args de config', () => {
        const config = {
            proxyPort: 8080,
            portalPort: 8081,
            portalHost: '127.0.0.1',
            tray: 'none',
            window: 'app',
            home: '/config/home',
            deviceIntervalSeconds: 5,
            unlockStdin: false,
        };
        const cliArgs = {
            'proxy-port': '9999',
            home: '/cli/home',
            window: 'none',
        };
        const effective = resolveEffectiveConfig(config, cliArgs);
        expect(effective.proxyPort).toBe(9999);
        expect(effective.portalPort).toBe(8081); // uit config
        expect(effective.home).toBe('/cli/home'); // overschreven door cli
        expect(effective.window).toBe('none'); // overschreven door cli
        expect(effective.tray).toBe('none'); // uit config
    });

    it('config.example.json bestaat in de projectroot en is een geldige configuratie', () => {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
        const examplePath = path.join(root, 'config.example.json');
        expect(fs.existsSync(examplePath)).toBe(true);
        const parsed = loadConfig({ configPath: examplePath });
        expect(parsed.proxyPort).toBe(8484);
        expect(parsed.portalPort).toBe(8485);
        expect(parsed.portalHost).toBe('127.0.0.1');
    });
});
