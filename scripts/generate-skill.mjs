#!/usr/bin/env node
// Genereert de toollijst in skills/vaultgate/SKILL.md uit TOOLS (src/mcp/tools.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/mcp/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_FILE = path.join(ROOT, 'skills', 'vaultgate', 'SKILL.md');

export function renderToolsMarkdown(tools = TOOLS) {
    const lines = [
        '<!-- tools:start -->',
        '## Beschikbare MCP-Tools',
        '',
        'De volgende tools zijn beschikbaar via de Vaultgate MCP-server:',
        '',
    ];

    for (const tool of tools) {
        lines.push(`### \`${tool.name}\``);
        lines.push('');
        lines.push(tool.description);
        lines.push('');
        const schema = tool.inputSchema || tool.parameters || {};
        const props = Object.entries(schema.properties || {});
        if (props.length > 0) {
            lines.push('| Parameter | Type | Verplicht | Beschrijving |');
            lines.push('| :--- | :--- | :--- | :--- |');
            const required = new Set(schema.required || []);
            for (const [name, p] of props) {
                const reqStr = required.has(name) ? '**Ja**' : 'Nee';
                const typeStr = p.type || 'any';
                const descStr = (p.description || '').replace(/\|/g, '\\|');
                lines.push(`| \`${name}\` | \`${typeStr}\` | ${reqStr} | ${descStr} |`);
            }
            lines.push('');
        }
    }

    lines.push('<!-- tools:end -->');
    return lines.join('\n');
}

export function updateSkillFile(file = SKILL_FILE, { check = false } = {}) {
    if (!fs.existsSync(file)) {
        throw new Error(`Skill file niet gevonden: ${file}`);
    }
    const content = fs.readFileSync(file, 'utf8');
    const startTag = '<!-- tools:start -->';
    const endTag = '<!-- tools:end -->';

    const startIndex = content.indexOf(startTag);
    const endIndex = content.indexOf(endTag);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        throw new Error(`Markers ${startTag} en/of ${endTag} ontbreken in ${file}`);
    }

    const rendered = renderToolsMarkdown();
    const updated = content.slice(0, startIndex) + rendered + content.slice(endIndex + endTag.length);

    if (check) {
        return updated === content;
    }

    if (updated !== content) {
        fs.writeFileSync(file, updated, 'utf8');
    }
    return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const checkOnly = process.argv.includes('--check');
    const isUpToDate = updateSkillFile(SKILL_FILE, { check: checkOnly });
    if (checkOnly && !isUpToDate) {
        console.error('SKILL.md loopt achter op TOOLS! Draai: npm run skill');
        process.exit(1);
    }
}
