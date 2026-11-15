/**
 * Een kopie van de geïnstalleerde code (de bestanden die de integriteitscontrole leest) in een eigen map, zodat een test
 * er een bestand in kan aanpassen zonder de werkmap te raken. Voor het echte proces moet de kopie onder de repo liggen
 * (`outputs/`): Node vindt node_modules dan in een bovenliggende map, zonder link naar de echte node_modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CODE_PATHS, INSTALL_ROOT } from '../../src/code-integrity/index.js';

/** Kopieert de code naar `target` en geeft `target` terug. */
export function copyInstall(target) {
    for (const entry of CODE_PATHS) fs.cpSync(path.join(INSTALL_ROOT, entry), path.join(target, entry), { recursive: true });
    return target;
}

let counter = 0;
/** Een kopie onder `outputs/` waaruit `node src/main.js` kan draaien; `remove()` ruimt ze op. */
export function runnableInstall() {
    const dir = copyInstall(path.join(INSTALL_ROOT, 'outputs', 'install-copies', `${process.pid}-${counter++}`));
    return { dir, main: path.join(dir, 'src', 'main.js'), remove: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}
