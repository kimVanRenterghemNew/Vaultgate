// De aanvallen van de aanvalsbank, als data. De nummers zijn die van `docs/threat-model-agent.md`.
// Een aanval met `rule` moet geweigerd worden met die regel, en de doelhost mag niets ontvangen (tenzij `reaches`); een
// aanval met `check` beoordeelt het resultaat zelf; een aanval met `open` is (nog) niet gedicht en zegt waarom.
// `run(ctx)` geeft { status, rule, body } terug; ctx komt uit index.mjs.

const bearer = name => ({ authorization: `Bearer {{secret:${name}}}` });

/** @type {Array<{ id: string, name: string, rule?: string, check?: Function, reaches?: boolean, open?: string, run?: Function }>} */
export const ATTACKS = [
    { id: 'A1', name: 'Tool-key-bestand van een andere tool lezen en die tool nadoen', open: 'DPAPI beschermt alleen tegen andere accounts; een proces van dezelfde gebruiker kan de sleutel lezen (macOS/Linux volgt in 7.2)' },
    { id: 'A1b', name: 'Een verzonnen tool-key', rule: 'no-tool-key',
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/x`, { key: 'ks_verzonnenverzonnenverzonnen12', headers: bearer('api') }) },
    { id: 'A1c', name: 'De key van een ingetrokken tool', rule: 'tool-key-revoked',
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/x`, { key: ctx.revokedKey, headers: bearer('api') }) },
    { id: 'A1d', name: 'Een oude tool-key opnieuw aanbieden na rotatie (gestolen sleutel)', rule: 'key-reuse-detected',
        run: ctx => ctx.raw('proxy', 'POST', '/device/exchange', { 'content-type': 'application/json' }, JSON.stringify({ tool_key: ctx.retiredKey })) },
    { id: 'A2', name: 'Device flow: de naam van een bestaande tool overnemen', check: r => r.status === 409 && /name_taken/.test(r.body),
        run: ctx => ctx.raw('proxy', 'POST', '/device/code', { 'content-type': 'application/json' }, '{"client_name":"mytool"}') },
    // De nep-tray klikt "toestaan" op een koppeling (zoals een programma). Zonder aanraking van de passkey geen key.
    { id: 'A2b', name: 'Device flow: een koppeling laten toestaan door de pop-up aan te klikken', check: r => r.status === 400 && /authorization_pending|slow_down/.test(r.body),
        run: async ctx => {
            const start = await ctx.raw('proxy', 'POST', '/device/code', { 'content-type': 'application/json' }, '{"client_name":"agent-x"}');
            const code = JSON.parse(start.body).device_code;
            let res = start;
            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 250));
                res = await ctx.raw('proxy', 'POST', '/device/token', { 'content-type': 'application/json' }, JSON.stringify({ device_code: code }));
                if (!/authorization_pending|slow_down/.test(res.body)) break;
            }
            return res;
        } },
    // De nep-tray antwoordt eerst "altijd" (zoals een programma dat de knop indrukt), dan "eenmalig". Zonder aanraking van
    // de passkey mag "altijd" geen toekenning geven: de tweede call moet opnieuw gevraagd worden.
    { id: 'A3', name: 'De pop-up laten aanklikken via UI Automation ("altijd" zonder passkey)', reaches: true,
        check: r => r.rule === 'approved-once,approved-once',
        run: async ctx => {
            const first = await ctx.proxy(`/forward/${ctx.upstream}/a3`, { headers: bearer('nogrant') });
            const second = await ctx.proxy(`/forward/${ctx.upstream}/a3`, { headers: bearer('nogrant') });
            return { status: second.status, rule: `${first.rule},${second.rule}`, body: first.body + second.body };
        } },
    { id: 'A4', name: 'Het tray-script of de code van Vaultgate aanpassen', rule: 'code-changed',
        check: r => r.status === 409 && (r.code === 'CODE_CHANGED' || r.rule === 'code-changed'),
        run: ctx => ctx.tamperCode() },
    { id: 'A4b', name: 'Installatiemap zonder schrijfrecht en ondertekende release', open: 'installatie zonder schrijfrecht en ondertekende release hangen af van release-export en deploy' },
    { id: 'A5', name: 'Het geheugen van een ontgrendelde kluis lezen', open: 'de kluis blijft open tot Log out; JS-strings in het geheugen zijn niet te wissen' },
    { id: 'A8', name: 'Prompt-injectie: het secret naar een andere host sturen', rule: 'target-host-not-allowed',
        run: ctx => ctx.proxy(`/forward/${ctx.elsewhere}/steal`, { headers: bearer('api') }) },
    { id: 'A8b', name: 'Pad-encoding om een pad-prefix te omzeilen', rule: 'bad-target',
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/scoped/..%2fother`, { headers: bearer('scoped') }) },
    { id: 'A9', name: 'Prompt-injectie: het secret in de query naar een toegestane host', rule: 'placeholder-location-not-allowed',
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/notes?note={{secret:api}}`, { headers: bearer('api') }) },
    { id: 'A9b', name: 'Prompt-injectie: het secret in een vrije header', rule: 'placeholder-location-not-allowed',
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/notes`, { headers: { 'x-note': '{{secret:api}}' } }) },
    { id: 'A10', name: 'De doelhost kaatst het secret terug (ook base64 en hex)', reaches: true,
        check: (r, ctx) => r.status === 200 && !ctx.containsSecret(r.body),
        run: ctx => ctx.proxy(`/forward/${ctx.upstream}/echo`, { headers: bearer('api') }) },
    { id: 'A11', name: 'Eén klik op "eenmalig" voor drie requests tegelijk', reaches: true,
        check: (r, ctx) => r.passed === 1 && ctx.upstreamDelta === 1,
        run: async ctx => {
            const results = await Promise.all([1, 2, 3].map(() => ctx.proxy(`/forward/${ctx.upstream}/once`, { headers: bearer('nogrant') })));
            return { status: 200, rule: results.map(r => r.rule).join(','), body: '', passed: results.filter(r => r.status === 200).length };
        } },
    { id: 'A13', name: 'Man-in-the-middle: een keten naar een root buiten de lijst van geldige roots, voor een bekende host', rule: 'tls-untrusted',
        run: async ctx => {
            const first = await ctx.proxy(`/forward/${ctx.https}/pin`, { headers: bearer('tls') });
            if (first.status !== 200) return first;
            ctx.swapCertificate();
            return ctx.proxy(`/forward/${ctx.https}/x`, { headers: bearer('tls') });
        } },
    { id: 'A14', name: 'Webpagina: DNS-rebinding naar het portaal', check: r => r.status === 421,
        run: ctx => ctx.raw('portal', 'GET', '/api/state', { host: 'evil.example' }) },
    { id: 'A14b', name: 'Webpagina: DNS-rebinding naar de device flow', check: r => r.status === 421,
        run: ctx => ctx.raw('proxy', 'POST', '/device/code', { host: 'evil.example', 'content-type': 'application/json' }, '{"client_name":"x"}') },
    { id: 'A14c', name: 'Webpagina: een formulier naar de device flow', check: r => r.status === 415,
        run: ctx => ctx.raw('proxy', 'POST', '/device/code', { 'content-type': 'application/x-www-form-urlencoded' }, 'client_name=x') },
    // 9.13: na 5 verzonnen keys antwoordt de proxy niet meer (tarpit); een tool met een geldige key gaat gewoon door.
    { id: 'A15', name: 'Lawaai: verzonnen keys raden (brute force)', reaches: true,
        check: r => r.rule === 'no-answer,granted',
        run: async ctx => {
            for (let i = 0; i < 5; i++) await ctx.proxy(`/forward/${ctx.upstream}/x`, { key: `ks_gok${i}gokgokgokgokgokgokgokgok`, headers: bearer('api') });
            const held = await ctx.proxyWithin(2_000, `/forward/${ctx.upstream}/x`, { key: 'ks_nogeengokgokgokgokgokgokgokgo', headers: bearer('api') });
            const valid = await ctx.proxy(`/forward/${ctx.upstream}/x`, { headers: bearer('api') });
            return { status: valid.status, rule: `${held.rule},${valid.rule}`, body: valid.body };
        } },
    { id: 'A16', name: 'Auto-vergrendelen rekken met onzin-keys', check: r => r.locked === true,
        run: ctx => ctx.testAutoLock() },
    // Deze twee als laatste: daarna is de kluis vergrendeld.
    { id: 'A12', name: 'De audit saboteren (bestand alleen-lezen)', rule: 'audit-unavailable',
        run: ctx => { ctx.sabotageAudit(); return ctx.proxy(`/forward/${ctx.upstream}/x`, { headers: bearer('api') }); } },
    { id: 'A12b', name: 'Na herhaalde auditfouten is de kluis dicht', rule: 'vault-locked', check: r => r.locked === true,
        run: async ctx => {
            for (let i = 0; i < 3; i++) await ctx.proxy(`/forward/${ctx.upstream}/x`, { headers: bearer('api') });
            const response = await ctx.proxy(`/forward/${ctx.upstream}/x`, { headers: bearer('api') });
            // A15 may already have throttled this client IP; inspect the public portal state to prove lockdown itself.
            const state = await ctx.raw('portal', 'GET', '/api/state', { host: `localhost:${ctx.portalPort}` });
            return { ...response, locked: JSON.parse(state.body).unlocked === false };
        } },
];

/** De tabel voor de README: wat geblokkeerd hoort te zijn en wat open is (dezelfde data als de bank). */
export function renderTable(attacks = ATTACKS) {
    const verdict = a => (a.open ? `open: ${a.open}` : `geblokkeerd${a.rule ? `: \`${a.rule}\`` : ''}`);
    return ['| # | aanval | resultaat |', '|---|---|---|', ...attacks.map(a => `| ${a.id} | ${a.name} | ${verdict(a)} |`)].join('\n');
}
