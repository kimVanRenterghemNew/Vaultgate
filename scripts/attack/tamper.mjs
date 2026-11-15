// Test voor aanval A4 in de aanvalsbank: code aanpassen in een installatiekopie.
// Start een proces uit een kopie, legt de code vast, past een bestand aan en start opnieuw.
// De kluis weigert te ontgrendelen met CODE_CHANGED (status 409).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function tamperCode() {
    const copyDir = path.join(ROOT, 'outputs', 'install-copies', `attack-${process.pid}-${Date.now()}`);
    const tempH = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultgate-tamper-'));
    for (const entry of ['package.json', 'i18n', 'src', 'web']) {
        fs.cpSync(path.join(ROOT, entry), path.join(copyDir, entry), { recursive: true });
    }
    const trayFile = path.join(copyDir, 'src', 'tray-link', 'windows-tray.ps1');
    let p1 = null;
    let p2 = null;
    try {
        p1 = spawn(process.execPath, [path.join(copyDir, 'src', 'main.js'), '--home', tempH, '--proxy-port', '0', '--portal-port', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out1 = '';
        p1.stdout.on('data', d => { out1 += d; });
        const r1 = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout start 1')), 15000);
            p1.stdout.on('data', () => {
                const ready = out1.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.event === 'ready');
                if (ready) { clearTimeout(t); resolve(ready); }
            });
            p1.on('exit', code => reject(new Error(`exit ${code}`)));
        });
        await fetch(`http://localhost:${r1.portalPort}/api/setup`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ passphrase: 'testpassphrase123' }),
        });
        p1.kill();
        await new Promise(r => p1.once('exit', r));
        p1 = null;

        fs.appendFileSync(trayFile, '\n# tampered by attack bench\n');

        p2 = spawn(process.execPath, [path.join(copyDir, 'src', 'main.js'), '--home', tempH, '--proxy-port', '0', '--portal-port', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out2 = '';
        p2.stdout.on('data', d => { out2 += d; });
        const r2 = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout start 2')), 15000);
            p2.stdout.on('data', () => {
                const ready = out2.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.event === 'ready');
                if (ready) { clearTimeout(t); resolve(ready); }
            });
            p2.on('exit', code => reject(new Error(`exit ${code}`)));
        });
        const unlockRes = await fetch(`http://localhost:${r2.portalPort}/api/unlock`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: `http://localhost:${r2.portalPort}` },
            body: JSON.stringify({ passphrase: 'testpassphrase123' }),
        });
        p2.kill();
        await new Promise(r => p2.once('exit', r));
        p2 = null;
        const body = await unlockRes.json();
        return { status: unlockRes.status, rule: body.error?.rule ?? '', code: body.error?.code ?? '' };
    } finally {
        if (p1 && p1.exitCode === null) { p1.kill(); await new Promise(r => p1.once('exit', r)); }
        if (p2 && p2.exitCode === null) { p2.kill(); await new Promise(r => p2.once('exit', r)); }
        try { fs.rmSync(copyDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows */ }
        try { fs.rmSync(tempH, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows */ }
    }
}
