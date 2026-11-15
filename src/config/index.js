// Configuratie van VaultGate via een JSON-bestand (bijv. config.json) in plaats van .env.
// CLI-argumenten overschrijven de waarden uit het configuratiebestand.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
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

const CLI_MAP = Object.freeze({
    home: 'home',
    'proxy-port': 'proxyPort',
    'portal-port': 'portalPort',
    'portal-host': 'portalHost',
    tray: 'tray',
    'tray-command': 'trayCommand',
    window: 'window',
    'device-interval-seconds': 'deviceIntervalSeconds',
    'unlock-stdin': 'unlockStdin',
});

export function parseConfigFile(content) {
    if (!content || typeof content !== 'string') return {};
    try {
        const parsed = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Config must be a JSON object');
        }
        return parsed;
    } catch (err) {
        throw Object.assign(new Error(`Invalid JSON config: ${err.message}`), { code: 'INVALID_CONFIG' });
    }
}

export function loadConfig({ configPath = null, cwd = process.cwd(), fsModule = fs } = {}) {
    let resolved = configPath ? path.resolve(cwd, configPath) : null;
    if (!resolved) {
        const candidate = path.resolve(cwd, 'config.json');
        if (fsModule.existsSync(candidate)) resolved = candidate;
    }
    if (!resolved) return { ...DEFAULT_CONFIG };
    if (!fsModule.existsSync(resolved)) {
        throw Object.assign(new Error(`Config file not found: ${resolved}`), { code: 'CONFIG_NOT_FOUND' });
    }
    const raw = fsModule.readFileSync(resolved, 'utf8');
    const parsed = parseConfigFile(raw);
    const result = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
            const val = parsed[key];
            if (typeof DEFAULT_CONFIG[key] === 'number') result[key] = Number(val);
            else if (typeof DEFAULT_CONFIG[key] === 'boolean') result[key] = Boolean(val);
            else result[key] = String(val);
        }
    }
    return result;
}

export function resolveEffectiveConfig(config, cliArgs = {}) {
    const effective = { ...config };
    for (const [cliKey, configKey] of Object.entries(CLI_MAP)) {
        if (cliArgs[cliKey] !== undefined) {
            const val = cliArgs[cliKey];
            if (typeof DEFAULT_CONFIG[configKey] === 'number') effective[configKey] = Number(val);
            else if (typeof DEFAULT_CONFIG[configKey] === 'boolean') effective[configKey] = Boolean(val);
            else effective[configKey] = val;
        }
    }
    return effective;
}
