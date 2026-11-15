// Contract van de notifier-poort van approval (docs/architecture.md §4): elke implementatie antwoordt alleen met een
// geldig antwoord, en zonder mens (geen tray verbonden) nooit met "once" of "always", en meteen.
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { IMPLEMENTATIONS } from '../../src/composition.js';
import { createTrayLink } from '../../src/tray-link/index.js';
import { createCrypto } from '../../src/crypto/index.js';

const links = [];
afterAll(() => links.forEach(l => l.close()));

const deps = {
    tray: async () => {
        const trayLink = createTrayLink({ command: path.join(process.env.VAULTGATE_HOME, 'geen-tray.exe'), crypto: createCrypto(), socketDir: process.env.VAULTGATE_HOME });
        links.push(trayLink);
        await trayLink.start();
        return { trayLink };
    },
    none: async () => ({}),
};

const VALID = ['once', '30m', '1h', '4h', 'always', 'deny', 'timeout', 'unavailable']; // 30m/1h: 3.4
const question = { id: 'q1', tool: 'mytool', secret: 's', host: 'https://h.example', client: '127.0.0.1', timeoutMs: 30_000 };

describe.each(Object.entries(IMPLEMENTATIONS.approval))('notifier: %s', (name, create) => {
    it('heeft precies de methode ask', async () => {
        const notifier = create(await deps[name]());
        expect(Object.keys(notifier)).toEqual(['ask']);
    });

    it('zonder mens: meteen "unavailable", nooit toestemming', async () => {
        const notifier = create(await deps[name]());
        const t0 = Date.now();
        const answer = await notifier.ask(question);
        expect(VALID).toContain(answer);
        expect(answer).toBe('unavailable');
        expect(Date.now() - t0).toBeLessThan(200);
    });
});
