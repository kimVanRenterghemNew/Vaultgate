// De aanvalsbank. Draait elke aanval tegen het echte proces: alles wat geblokkeerd hoort te zijn, is
// geblokkeerd, zonder lek; open aanvallen zeggen waarom. De beoordelaar MOET een doorgekomen aanval afwijzen. De tabel in
// docs/aanvalsbank.md komt uit dezelfde data, en elke aanval hoort bij een pad uit de aanvalsanalyse.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench, judge } from '../../scripts/attack/index.mjs';
import { renderTable } from '../../scripts/attack/attacks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('aanvalsbank', () => {
    it('Given de bank When ze tegen het echte proces draait Then is elke niet-open aanval geblokkeerd en lekt er niets', async () => {
        const { results, leaks } = await runBench();
        expect(results.filter(r => r.verdict === 'FAIL')).toEqual([]);
        expect(leaks).toEqual([]);
        expect(results.filter(r => r.verdict === 'blocked').length).toBeGreaterThanOrEqual(12);
    }, 120_000);

    it('MOET afwijzen: een aanval die geblokkeerd hoort te zijn maar doorkomt, of die de doelhost bereikt, of een secret teruggeeft', () => {
        const attack = { id: 'X', name: 'test', rule: 'target-host-not-allowed' };
        expect(judge(attack, { status: 200, rule: 'granted', body: '' }).verdict).toBe('FAIL');
        expect(judge(attack, { status: 403, rule: 'target-host-not-allowed', body: '' }, { upstreamDelta: 1 }).verdict).toBe('FAIL');
        expect(judge(attack, { status: 403, rule: 'target-host-not-allowed', body: 'GEHEIM' }, { containsSecret: t => t.includes('GEHEIM') }).verdict).toBe('FAIL');
        expect(judge(attack, { status: 403, rule: 'target-host-not-allowed', body: '' }).verdict).toBe('blocked');
        expect(judge({ id: 'Y', name: 'open', open: '9.3' }, {}).verdict).toBe('open');
    });

    it('de tabel in docs/aanvalsbank.md komt uit dezelfde data', () => {
        const readme = fs.readFileSync(path.join(ROOT, 'docs', 'aanvalsbank.md'), 'utf8');
        const block = /<!-- aanvalsbank:start -->\n([\s\S]*?)\n<!-- aanvalsbank:einde -->/.exec(readme)?.[1];
        expect(block).toBe(renderTable());
    });
});
