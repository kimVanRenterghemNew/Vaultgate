// Test isolation:
// - a test never sees a real secret from the developer's shell: every variable that looks like a credential is dropped;
// - a test never touches the developer's real vault: VAULTGATE_HOME points at a fresh temp folder per test file,
//   which is REMOVED afterwards.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { LEGACY_ENV } from '../../src/legacy-name/index.js';

const LEGACY_ENV_NAMES = new Set(Object.values(LEGACY_ENV));

const CREDENTIAL_LIKE = /(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|AUTH)/i;
for (const name of Object.keys(process.env)) {
    if (CREDENTIAL_LIKE.test(name) || name.startsWith('VAULTGATE_') || LEGACY_ENV_NAMES.has(name) || name.startsWith('GIT_CONFIG_')) delete process.env[name];
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultgate-test-'));
process.env.VAULTGATE_HOME = home;
process.env.VAULTGATE_WINDOW = 'none'; // nooit een echt portaalvenster op het scherm van de ontwikkelaar
process.env.VAULTGATE_EPOCH_DIR = path.join(home, 'epoch'); // de anti-rollback-teller nooit in het echte profiel
process.env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, `[safe]\n\tdirectory = "${repoRoot.replace(/\\/g, '/')}"\n`);
process.env.GIT_CONFIG_NOSYSTEM = '1';

afterAll(() => {
    // Windows houdt een bestand van een net gestopt proces soms nog even vast (ENOTEMPTY/EBUSY): opnieuw proberen.
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows lock */ }
});
