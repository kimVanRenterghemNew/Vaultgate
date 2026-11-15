// Opslagpoort. Een store bewaart bytes onder een naam en beslist niets: geen toegang,
// geen sleutels, geen ontsleuteling. De kluis versleutelt alles vóór het de store bereikt (zero-knowledge, ook voor een
// latere externe backend). Implementaties: ./local (map op schijf), ./memory (tests). Alleen src/composition.js kiest.
//
// @typedef {{ read(name): Promise<Buffer|null>, write(name, data: Buffer): Promise<void>, append(name, data: Buffer): Promise<void>,
//             list(prefix): Promise<string[]>, remove(name): Promise<void>, quarantine(name): Promise<string> }} Store

export const INVALID_NAME = 'INVALID_NAME';

const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

/** Gedeelde naamregel van de poort: relatief, geen `..`, geen backslash, geen lege segmenten. */
export function checkName(name) {
    if (typeof name !== 'string' || !NAME.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
        throw Object.assign(new Error(`invalid store name: ${JSON.stringify(name)}`), { code: INVALID_NAME });
    }
    return name;
}

export const quarantineName = (name, now) => `quarantine/${name.replace(/\//g, '_')}.${now}`;
