// De Windows-tray starten uit de gecontroleerde bytes: PowerShell krijgt een vaste korte opstartregel in argv (geen pad,
// geen geheim) en leest het script en de C#-bron als eerste JSON-regel van stdin. Zo voert het uit wat bij de start
// gelezen en gecontroleerd is (src/code-integrity), niet wat er op dat moment op schijf staat.
// Restrisico: CodeDom schrijft de bron voor csc.exe kort naar een bestand met een willekeurige naam in %TEMP%.

const SCRIPT = 'src/tray-link/windows-tray.ps1';
const SOURCES = Object.freeze(['src/tray-link/Theme.cs', 'src/tray-link/Tray.cs', 'src/tray-link/Popup.cs']);

/** De opstartregel: leest één JSON-regel en voert het script uit met de C#-bron als parameter. */
const BOOTSTRAP = '$b = [Console]::In.ReadLine() | ConvertFrom-Json; & ([scriptblock]::Create($b.script)) -Sources ([string[]]$b.sources)';

/** JSON met alleen ASCII (\uXXXX): de invoercodepagina van de console verminkt anders letters buiten ASCII. */
export const asciiJson = value => JSON.stringify(value).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * @param {{ read(file: string): Buffer }} snapshot de code zoals bij de start gelezen
 * @returns {{ command: string, args: string[], preamble: string }}
 */
export function windowsTray(snapshot) {
    const text = file => snapshot.read(file).toString('utf8');
    return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', BOOTSTRAP],
        preamble: `${asciiJson({ script: text(SCRIPT), sources: SOURCES.map(text) })}\n`,
    };
}
