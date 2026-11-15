/**
 * Werkt bestaande vaultgate-installaties bij na een update: entries, skill en policy, alleen waar ze al staan.
 * Schrijft niets als een bestand al actueel is, en geeft per aangepast bestand pad en `.vaultgate.bak` terug.
 *
 * @module mcp/refresh
 */
import fs from 'node:fs';
import { agentTargets, mcpEntry, SERVER_NAME } from './install.js';
import { projectAgentTarget } from './install-scope.js';
import { skillTargets, policyTargets, installSkill, installPolicy, instructionsSource } from './policy-install.js';

function write(file, text) {
    fs.copyFileSync(file, `${file}.vaultgate.bak`);
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
}

const argAfter = (args, flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] ?? null : null;
};

/** De verse entry voor een bestaande; een handgemaakte `url: .../sse` wordt stdio met dezelfde poort. */
function freshEntry(entry, typed, nodeExec) {
    const args = Array.isArray(entry?.args) ? entry.args : [];
    const port = !args.length && typeof entry?.url === 'string' ? entry.url.match(/127\.0\.0\.1:(\d+)/)?.[1] : null;
    const fresh = mcpEntry({
        name: argAfter(args, '--name') || 'agent',
        vaultHome: argAfter(args, '--home'),
        proxy: argAfter(args, '--proxy') || (port ? `http://127.0.0.1:${port}` : null),
        typed,
    });
    if (nodeExec) fresh.command = nodeExec;
    return fresh;
}

/** @returns {number} het aantal bijgewerkte entries in `file` (0: niets geschreven) */
function refreshJsonFile(file, key, typed, nodeExec) {
    if (!fs.existsSync(file)) return 0;
    let data;
    try {
        const text = fs.readFileSync(file, 'utf8').trim();
        if (!text) return 0;
        data = JSON.parse(text);
    } catch {
        return 0; // een config die we niet kunnen lezen, laten we staan
    }
    const servers = data[key];
    if (!servers || typeof servers !== 'object') return 0;
    let changes = 0;
    for (const [serverKey, entry] of Object.entries(servers)) {
        if (!serverKey.startsWith(SERVER_NAME)) continue;
        const fresh = freshEntry(entry, typed, nodeExec);
        if (JSON.stringify(fresh) === JSON.stringify(entry)) continue;
        servers[serverKey] = fresh;
        changes++;
    }
    if (changes) write(file, `${JSON.stringify(data, null, 2)}\n`);
    return changes;
}

/**
 * @param {{ env?: object, projectDirs?: string[], nodeExec?: string|null, vaultHome?: string|null }} [options]
 * @returns {Promise<{ updatedCount: number, files: { file: string, status: 'updated', backup: string }[] }>}
 */
export async function refreshMcpInstallations({ env = {}, projectDirs = [], nodeExec = null, vaultHome = null } = {}) {
    const changed = [];
    const touched = file => changed.push(file);

    const targets = agentTargets(env).filter(t => !t.toml);
    const configs = [
        ...targets,
        ...projectDirs.flatMap(dir => targets.map(t => projectAgentTarget(t.id, dir)).filter(Boolean)),
    ];
    let entryCount = 0;
    for (const t of configs) {
        const count = refreshJsonFile(t.file, t.key, t.typed, nodeExec);
        if (count) { entryCount += count; touched(t.file); }
    }
    const configFiles = changed.length; // updatedCount telt entries, niet configbestanden

    for (const st of skillTargets(env).filter(s => fs.existsSync(s.file))) {
        if (installSkill(st).status === 'updated') touched(st.file);
    }

    // Policy: de algemene instructies en de gemarkeerde regels/bestanden, alleen waar ze al staan.
    const pTargets = policyTargets({ ...env, vaultHome });
    const general = pTargets[0]?.general;
    const policyText = fs.existsSync(instructionsSource()) ? fs.readFileSync(instructionsSource(), 'utf8') : null;
    if (policyText && general && fs.existsSync(general) && fs.readFileSync(general, 'utf8') !== policyText) {
        write(general, policyText);
        touched(general);
    }
    // Een eigen regelbestand (Claude, AGENTS.md) (alleen de verwijsregel) blijft ongemoeid; alleen volledige policy-bestanden.
    for (const pt of pTargets.filter(p => p.header !== undefined && fs.existsSync(p.file))) {
        if (policyText && installPolicy(pt, policyText).status === 'updated') touched(pt.file);
    }

    const files = changed.map(file => ({ file, status: 'updated', backup: `${file}.vaultgate.bak` }));
    return { updatedCount: entryCount + files.length - configFiles, files };
}
