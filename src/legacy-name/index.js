// De enige plek met de vorige productnaam: overname van een bestaande installatie onder de nieuwe naam Vaultgate.
// - de standaardmap: bij de start van de server wordt de oude map hernoemd (één rename, de versleutelde bestanden
//   worden nooit gelezen of ontsleuteld); lukt dat niet, dan blijft de server de oude map gebruiken;
// - de omgevingsvariabelen: de oude namen werken nog als terugval (overgangsperiode). De oude headers werken niet
//   meer.
// Einde van de overgang: de oude variabelen werken t/m de 0.1.x-releases en verdwijnen in 0.2.0; de
// mapovername blijft tot een release ze bewust weghaalt. Daarna verdwijnt deze module en de verwijzingen ernaar.
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Nieuwe omgevingsvariabele -> oude naam (terugval). */
export const LEGACY_ENV = Object.freeze({ VAULTGATE_HOME: 'KURA_SECRETS_HOME', VAULTGATE_LANG: 'KURA_LANG' });

/** Leest een omgevingsvariabele, met de oude naam als terugval. */
export const fromEnv = (env, name) => env[name] ?? (LEGACY_ENV[name] ? env[LEGACY_ENV[name]] : undefined);

const appData = ({ env, homedir }) => env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
const inProfile = (p, name) => (p.platform === 'win32' ? path.join(appData(p), name) : path.join(p.homedir, `.${name}`));

/** De standaardmap van een installatie onder de oude naam. */
export const legacyHome = p => inProfile(p, 'kura-secrets');

/**
 * Kiest de map: `--home`, dan VAULTGATE_HOME (met terugval), dan de standaardmap. Alleen de standaardmap migreert:
 * bestaat de nieuwe niet en de oude wel, dan hernoemt `move` (de server) haar; zonder `move` (CLI) wordt de oude
 * gelezen zoals ze is. Geeft `{ home, migrated, from?, error? }`.
 */
export function resolveHome({ arg, env = process.env, platform = process.platform, homedir = os.homedir(), move = false, fs = nodeFs }) {
    const chosen = arg ?? fromEnv(env, 'VAULTGATE_HOME');
    if (chosen) return { home: chosen, migrated: false };
    const p = { env, platform, homedir };
    const home = inProfile(p, 'vaultgate');
    const legacy = legacyHome(p);
    if (fs.existsSync(home) || !fs.existsSync(legacy)) return { home, migrated: false };
    if (!move) return { home: legacy, migrated: false };
    try {
        fs.renameSync(legacy, home);
        return { home, migrated: true, from: legacy };
    } catch (error) {
        return { home: legacy, migrated: false, error: error.code ?? 'unknown' };
    }
}
