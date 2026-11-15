// Test voor de gegenereerde toollijst in skills/vaultgate/SKILL.md.
// Faalt als SKILL.md achterloopt op TOOLS (src/mcp/tools.js).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../../src/mcp/index.js';
import { renderToolsMarkdown, updateSkillFile } from '../../scripts/generate-skill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_FILE = path.join(ROOT, 'skills', 'vaultgate', 'SKILL.md');
const INSTRUCTIONS_FILE = path.join(ROOT, 'skills', 'vaultgate', 'vaultgate-instructions.md');

describe('vaultgate-skill en policy instructies', () => {
    it('SKILL.md is up-to-date met TOOLS (npm run skill)', () => {
        const isUpToDate = updateSkillFile(SKILL_FILE, { check: true });
        expect(isUpToDate, 'SKILL.md loopt achter op TOOLS! Voer uit: npm run skill').toBe(true);
    });

    it('updateSkillFile meldt out-of-date bij een achterhaalde inhoud', () => {
        const tmpFile = path.join(ROOT, 'node_modules', '.tmp-skill-test.md');
        fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
        fs.writeFileSync(tmpFile, '# Test\n<!-- tools:start -->\noud\n<!-- tools:end -->\n');
        try {
            const upToDate = updateSkillFile(tmpFile, { check: true });
            expect(upToDate).toBe(false);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    });

    it('bevat de kernregel en geen echte sleutels of secret-waarden', () => {
        const skill = fs.readFileSync(SKILL_FILE, 'utf8');
        const instructions = fs.readFileSync(INSTRUCTIONS_FILE, 'utf8');

        expect(skill).toContain('Een request die een secret nodig heeft, gaat via de vaultgate-tool');
        expect(instructions).toContain('Een request die een secret nodig heeft, gaat via de vaultgate-tool');
        expect(skill).toContain('{{secret:naam}}');

        // Geen hardcoded test-keys of nep-tokens
        expect(skill).not.toMatch(/\bks_[A-Za-z0-9_-]{20,}/);
        expect(instructions).not.toMatch(/\bks_[A-Za-z0-9_-]{20,}/);
    });

    it('bevat elke tool uit TOOLS met parameters', () => {
        const rendered = renderToolsMarkdown(TOOLS);
        for (const tool of TOOLS) {
            expect(rendered).toContain(`### \`${tool.name}\``);
            expect(rendered).toContain(tool.description);
        }
    });
});
