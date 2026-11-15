// Anti-rollback: een monotone teller (epoch) staat in de header (onder de manifest-MAC) en in een tweede store buiten de
// kluismap. Elke ondertekende header verhoogt de teller; eerst de header, dan de externe teller (een crash daartussen geeft
// header > extern: geen vals alarm). Bij ontgrendelen: header < extern betekent een teruggezette oudere kopie van de hele
// map, en dan opent de kluis niet tot de gebruiker het bewust bevestigt (`acceptRollback`).
// Een onleesbare externe teller telt als verdacht (standaard dicht): kapotmaken mag de controle niet uitschakelen.
// Ontbreekt de teller helemaal (eerste start, kluis verplaatst of van vóór de teller), dan wordt hij gezet.
import os from 'node:os';
import path from 'node:path';
import { decide } from '../decision/index.js';

export const VAULT_ROLLED_BACK = 'VAULT_ROLLED_BACK';

const suspect = c => c.unreadable || c.headerEpoch < c.known;
const RULES = Object.freeze([
    { name: 'vault-rolled-back', when: c => suspect(c) && !c.acceptRollback, then: { allow: false, rewrite: false } },
    { name: 'vault-rollback-accepted', when: suspect, then: { allow: true, rewrite: true } },
    { name: 'vault-epoch-current', when: () => true, then: { allow: true, rewrite: false } },
]);

const parse = raw => {
    const value = JSON.parse(raw.toString('utf8')).epoch;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('shape');
    return value;
};

/**
 * @param {{ store: import('../store/index.js').Store, name: string } | undefined} epoch waar de externe teller staat;
 *        zonder (alleen tests van andere modules) is er geen externe teller en dus geen controle.
 */
export function createEpochGuard(epoch) {
    let recorded = null; // laatst gelezen of geschreven externe waarde

    async function readExternal() {
        if (!epoch) return { known: 0, unreadable: false };
        try {
            const raw = await epoch.store.read(epoch.name);
            return { known: raw ? parse(raw) : 0, unreadable: false };
        } catch {
            return { known: 0, unreadable: true };
        }
    }

    /** De beslissing bij ontgrendelen: `{ allow, rewrite, rule, known }`. */
    async function check(headerEpoch, acceptRollback = false) {
        const external = await readExternal();
        recorded = external.unreadable ? null : external.known;
        return { ...decide({ ...external, headerEpoch, acceptRollback }, RULES), known: external.known };
    }

    /** Zet de externe teller op de waarde van een net geschreven header (alleen als ze veranderde). */
    async function record(value) {
        if (!epoch || value === recorded) return;
        await epoch.store.write(epoch.name, Buffer.from(JSON.stringify({ epoch: value })));
        recorded = value;
    }

    async function reset() {
        if (!epoch) return;
        try {
            await epoch.store.remove(epoch.name);
        } catch { /* negeer */ }
        recorded = null;
    }

    return Object.freeze({ check, record, reset });
}

/**
 * Waar de externe teller staat: VAULTGATE_EPOCH_DIR, anders buiten de (roaming) Vaultgate-map: op Windows onder
 * %LOCALAPPDATA%, elders onder ~/.local/state. Eén bestand per kluismap, genoemd naar een hash van haar pad.
 */
export function epochLocation({ vaultDir, crypto, env = process.env, platform = process.platform, homedir = os.homedir() }) {
    const local = platform === 'win32' ? path.join(env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local'), 'Vaultgate') : path.join(homedir, '.local', 'state', 'vaultgate');
    return { dir: env.VAULTGATE_EPOCH_DIR ?? path.join(local, 'epoch'), name: `${crypto.keyedHash(undefined, path.resolve(vaultDir))}.json` };
}
