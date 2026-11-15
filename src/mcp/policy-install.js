// Beheert de installatie van de Vaultgate skill en policy in de agents op de machine.
// Zoals bij lady-lens: een bestand van de gebruiker (de CLAUDE-regels, AGENTS.md, copilot-instructions.md)
// krijgt precies één gemarkeerde regel ('<!-- vaultgate -->'); uninstall verwijdert exact die regel
// en laat elke andere byte ongewijzigd.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARK = '<!-- vaultgate -->';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const POLICY_RULE = 'Een request die een secret nodig heeft, gaat via de vaultgate-tool `http_request` met `{{secret:naam}}`; vraag de gebruiker nooit om een sleutel en zet er nooit een in een bestand, commando of prompt.';

export function policyTargets({ home = os.homedir(), platform = process.platform, appData = process.env.APPDATA, vaultHome = null } = {}) {
    const vscodeUser = platform === 'win32'
        ? path.join(appData || path.join(home, 'AppData', 'Roaming'), 'Code', 'User')
        : platform === 'darwin'
            ? path.join(home, 'Library', 'Application Support', 'Code', 'User')
            : path.join(home, '.config', 'Code', 'User');

    const instructionsFile = path.join(vaultHome || path.join(home, '.vaultgate'), 'vaultgate-instructions.md');
    const instructionsPath = instructionsFile.split(path.sep).join('/');

    const link = (target) => ({
        ...target,
        general: instructionsFile,
        line: target.id === 'claude'
            ? `@${instructionsPath} ${MARK}`
            : `Vaultgate: ${POLICY_RULE} Instructies: [vaultgate-instructions](${instructionsPath}). ${MARK}`,
    });

    return [
        link({ id: 'claude', label: 'Claude policy', marker: path.join(home, '.claude'), file: path.join(home, '.claude', 'CLAUDE' + '.md') }),
        link({ id: 'copilot', label: 'Copilot policy', marker: path.join(home, '.copilot'), file: path.join(home, '.copilot', 'copilot-instructions.md') }),
        link({ id: 'codex', label: 'Codex policy', marker: path.join(home, '.codex'), file: path.join(home, '.codex', 'AGENTS.md') }),
        link({ id: 'vibe', label: 'Mistral Vibe policy', marker: path.join(home, '.vibe'), file: path.join(home, '.vibe', 'AGENTS.md') }),
        { id: 'vscode', label: 'VS Code policy', marker: vscodeUser, file: path.join(vscodeUser, 'prompts', 'vaultgate.instructions.md'), general: instructionsFile, header: "---\napplyTo: '**'\n---\n\n" },
        { id: 'antigravity', label: 'Antigravity policy', marker: path.join(home, '.gemini', 'config'), file: path.join(home, '.gemini', 'config', 'rules', 'vaultgate.md'), general: instructionsFile, header: '---\ntrigger: always_on\n---\n\n' },
    ];
}

export function skillTargets({ home = os.homedir() } = {}) {
    return [
        { id: 'claude', label: 'Claude skill', marker: path.join(home, '.claude'), file: path.join(home, '.claude', 'skills', 'vaultgate', 'SKILL.md') },
        { id: 'copilot', label: 'Copilot skill', marker: path.join(home, '.copilot'), file: path.join(home, '.copilot', 'skills', 'vaultgate', 'SKILL.md') },
        { id: 'agents', label: 'Agents skill', marker: path.join(home, '.agents'), file: path.join(home, '.agents', 'skills', 'vaultgate', 'SKILL.md') },
    ];
}

export function skillSource() {
    return path.join(ROOT, 'skills', 'vaultgate', 'SKILL.md');
}

export function instructionsSource() {
    return path.join(ROOT, 'skills', 'vaultgate', 'vaultgate-instructions.md');
}

/** Verwijdert de regels met MARK en eventuele voorafgaande witregel die withLink heeft geplaatst; elke andere byte blijft gelijk. */
export function withoutLink(text, mark = MARK) {
    const kept = [];
    for (const line of text.split(/(?<=\n)/)) {
        if (!line.includes(mark)) {
            kept.push(line);
        } else if (/^\r?\n$/.test(kept[kept.length - 1] ?? '')) {
            kept.pop();
        }
    }
    return kept.join('');
}

/** Voegt de gemarkeerde regel toe na een witregel in het juiste regeleinde. */
export function withLink(text, lines, mark = MARK) {
    const rest = withoutLink(text, mark);
    const eol = rest.includes('\r\n') ? '\r\n' : '\n';
    return `${rest}${rest && !rest.endsWith('\n') ? eol : ''}${rest ? eol : ''}${[lines].flat().join(eol)}${eol}`;
}

function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, `${file}.vaultgate.bak`);
    }
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
}

const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

export function installPolicy(target, policyText, dryRun = false) {
    const before = read(target.file);
    const after = target.header !== undefined
        ? `${target.header}${policyText.trim()}\n`
        : withLink(before ?? '', target.line);

    if (!dryRun && target.general && read(target.general) !== policyText) {
        write(target.general, policyText);
    }

    if (after === before) return { status: 'unchanged' };
    if (!dryRun) write(target.file, after);
    return { status: before !== null && (target.header !== undefined || before.includes(MARK)) ? 'updated' : 'installed' };
}

export function uninstallPolicy(target, dryRun = false) {
    const before = read(target.file);
    if (before === null || (target.header === undefined && !before.includes(MARK))) {
        return { status: 'absent' };
    }
    if (!dryRun) {
        if (target.header !== undefined) {
            fs.rmSync(target.file, { force: true });
        } else {
            const cleaned = withoutLink(before);
            if (cleaned.trim()) {
                write(target.file, cleaned);
            } else {
                fs.rmSync(target.file, { force: true });
            }
        }
    }
    return { status: 'removed' };
}

export function installSkill(target, dryRun = false) {
    const source = skillSource();
    if (!fs.existsSync(source)) return { status: 'error', reason: 'skill source missing' };
    const existed = fs.existsSync(target.file);
    if (existed && fs.readFileSync(target.file).equals(fs.readFileSync(source))) return { status: 'unchanged' };
    if (!dryRun) {
        fs.mkdirSync(path.dirname(target.file), { recursive: true });
        if (existed) fs.copyFileSync(target.file, `${target.file}.vaultgate.bak`);
        fs.copyFileSync(source, target.file);
    }
    return { status: existed ? 'updated' : 'installed' };
}

export function uninstallSkill(target, dryRun = false) {
    if (!fs.existsSync(target.file)) return { status: 'absent' };
    if (!dryRun) {
        fs.rmSync(target.file, { force: true });
    }
    return { status: 'removed' };
}

/** Voert skill en/of policy installatie/de-installatie uit voor alle aanwezige agents. */
export function runSkillAndPolicyInstall({
    action = 'install',
    env = {},
    vaultHome = null,
    dryRun = false,
} = {}) {
    const pTargets = policyTargets({ ...env, vaultHome });
    const sTargets = skillTargets(env);

    const activePolicyTargets = pTargets.filter(t => fs.existsSync(t.marker));
    const activeSkillTargets = sTargets.filter(t => fs.existsSync(t.marker));

    const instructionsBody = fs.existsSync(instructionsSource())
        ? fs.readFileSync(instructionsSource(), 'utf8')
        : `# Vaultgate Policy\n\n${POLICY_RULE}\n`;

    const results = [];
    const general = pTargets[0]?.general;
    const generalBefore = general ? read(general) : null;

    // 1. Policy
    for (const target of activePolicyTargets) {
        const res = action === 'uninstall'
            ? uninstallPolicy(target, dryRun)
            : installPolicy(target, instructionsBody, dryRun);
        results.push({ type: 'policy', id: target.id, label: target.label, file: target.file, ...res });
    }

    if (general && action !== 'uninstall' && !dryRun && read(general) !== generalBefore) {
        results.push({ type: 'policy', id: 'instructions', label: 'Vaultgate instructions', file: general, status: generalBefore === null ? 'installed' : 'updated' });
    }

    // 2. Skill
    for (const target of activeSkillTargets) {
        const res = action === 'uninstall'
            ? uninstallSkill(target, dryRun)
            : installSkill(target, dryRun);
        results.push({ type: 'skill', id: target.id, label: target.label, file: target.file, ...res });
    }

    return results;
}
