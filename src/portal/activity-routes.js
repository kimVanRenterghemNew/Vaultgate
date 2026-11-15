// Activiteit: het logboek (de audit, te filteren) en de tellers voor het dashboard. Deel van het portaal (index.js);
// beide vragen een sessie en een open kluis. Filter `decision`: allow, deny of admin (beheer). Alleen namen, regels en aantallen; nooit een waarde.

/** Tellers over audit-regels: doorgelaten, tegengehouden, vervangen in antwoorden, en hoeveel tools en secrets. Beheer telt niet mee. */
export function summarize(all) {
    const entries = all.filter(e => e.mode !== 'admin');
    const allowed = entries.filter(e => e.allow);
    const scrubbed = entries.filter(e => e.rule === 'response-scrubbed');
    const names = (list, field) => new Set(list.flatMap(e => String(e[field] ?? '').split(',')).filter(Boolean)).size;
    return {
        allowed: allowed.length,
        stopped: entries.filter(e => !e.allow && e.rule !== 'response-scrubbed').length,
        scrubbed: scrubbed.reduce((sum, e) => sum + (Number(e.count) || 1), 0),
        tools: names(allowed, 'tool'),
        secrets: names(allowed, 'secret'),
    };
}

/**
 * @param {{ audit: object }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function activityRoutes({ audit }) {
    return [
        ['GET', /^\/api\/audit$/, 'unlocked', ({ query }) => audit.read({
            tool: query.get('tool') || undefined, secret: query.get('secret') || undefined, host: query.get('host') || undefined,
            decision: ['allow', 'deny', 'admin'].includes(query.get('decision')) ? query.get('decision') : undefined,
            limit: Math.min(Number(query.get('limit')) || 200, 1000),
        })],
        // `since`: het begin van "vandaag" volgens de browser (die kent de tijdzone van de gebruiker).
        ['GET', /^\/api\/stats$/, 'unlocked', async ({ query }) => summarize(await audit.read({ since: Number(query.get('since')) || 0, limit: 100_000 }))],
    ];
}
