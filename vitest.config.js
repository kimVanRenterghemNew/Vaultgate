import { defineConfig, configDefaults } from 'vitest/config';

// Twee projecten: unit-tests (time-out 15 s: sommige doen echte schijf-I/O met fsync of Argon2, en onder zware belasting,
// bv. twee runs tegelijk, duurde 5 s te kort; een hangende test valt nog altijd op) en journeys (het echte
// proces, browsers, tray-processen: ruimere time-out). Samen draaien ze met hoogstens 8 workers, zodat journeys met een
// browser of een tijdsmeting (streaming) niet verstikken op een machine met weinig kernen. Vier workers voorkomt dat
// meerdere browser/process-journeys Chrome op Windows tegelijk laten stoppen (waargenomen in de volledige suite).
const shared = {
    // Never the developer's real vault or shell secrets; temp folder removed after each file (test/setup/isolate.js).
    setupFiles: ['test/setup/isolate.js'],
};
const JOURNEYS = 'test/**/*.journey.test.js';

export default defineConfig({
    test: {
        maxWorkers: 4,
        projects: [
            { extends: true, test: { ...shared, name: 'unit', testTimeout: 15_000, include: ['test/**/*.test.js'], exclude: [...configDefaults.exclude, '**/*.integration.test.js', JOURNEYS] } },
            { extends: true, test: { ...shared, name: 'journey', include: [JOURNEYS], testTimeout: 30_000, hookTimeout: 120_000 } },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.js', 'scripts/**/*.mjs'],
            // src/main.js is de dunne CLI: hij draait alleen in een subproces (journey-tests via startProcess), dat vitest
            // niet meet. Alles wat hij aanroept (createApp) wordt in-process gemeten (MODES in test/helpers/journey.js).
            // Startscripts: alleen als echt subproces getest (main.js via de journeys, demo.mjs via test/scripts/demo.test.js).
            exclude: ['src/main.js', 'scripts/demo.mjs', 'scripts/demo-watch.mjs', 'scripts/look.mjs', 'scripts/attack/cli.mjs', 'scripts/*icons.mjs'],
            reportsDirectory: 'outputs/coverage',
            // Ratchet: raise these as code lands, never lower them to get green. Decision core (src/decision) stays at 100%.
            thresholds: { statements: 90, branches: 91, functions: 90, lines: 90 },
        },
    },
});
