// Gedeelde opbouw voor kluistests: memory- of lokale store, nepklok, minimale KDF (ops=2, 64 MiB: het afgedwongen minimum).
import path from 'path';
import { createVault } from '../../src/vault/index.js';
import { createCrypto, MIN_KDF } from '../../src/crypto/index.js';
import { choose } from '../../src/composition.js';

export const crypto = createCrypto();

export function fakeClock(start = 1_700_000_000_000) {
    let now = start;
    return { now: () => now, advance: ms => { now += ms; } };
}

let counter = 0;
export function newVault({ store = 'memory', clock = fakeClock(), dir } = {}) {
    const vaultDir = dir ?? path.join(process.env.VAULTGATE_HOME, `vault-${process.pid}-${counter++}`);
    const backend = choose('store', store, { dir: vaultDir });
    const vault = createVault({ store: backend, crypto, clock, kdf: MIN_KDF });
    return { vault, store: backend, clock, dir: vaultDir, reopen: () => createVault({ store: backend, crypto, clock, kdf: MIN_KDF }) };
}
