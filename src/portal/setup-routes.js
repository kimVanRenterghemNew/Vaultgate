// De eerste opzet met een passkey: zolang er geen kluis is, maakt de eerste passkey met PRF de kluis aan (geen passphrase,
// geen herstelcode). Deel van het portaal (index.js). Zonder kluis is er niets te beschermen, dus geen sessie nodig; zodra
// de kluis bestaat, weigeren deze routes (VAULT_EXISTS).
//
// Sommige authenticators geven de PRF-uitvoer niet bij het aanmaken: dan houdt de server de nieuwe passkey kort vast en
// vraagt één assertie op precies die passkey. Zonder PRF komt er geen kluis (PRF_REQUIRED).

/**
 * @param {{ vault: object, rp: object, newSession: Function, afterUnlock: Function, log: Function, httpError: Function, prfBuffer: Function }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function setupRoutes({ vault, rp, newSession, afterUnlock, log, httpError, prfBuffer }) {
    let waiting = null; // { credential, prfSalt }: geregistreerd, wacht op de PRF-uitvoer

    const noVault = () => { if (vault.status().exists) throw httpError('VAULT_EXISTS', 'a vault already exists'); };
    const noPrf = () => httpError('PRF_REQUIRED', 'this passkey has no PRF output, so it cannot open the vault');

    async function create(res, credential, prf, prfSalt) {
        await afterUnlock(() => vault.createWithPasskey({ credential, prfOutput: prf, prfSalt }));
        const session = newSession(res);
        log({ event: 'portal-setup', method: 'passkey' });
        return { created: true, prf: true, csrf: session.csrf };
    }

    return [
        ['POST', /^\/api\/setup\/passkey\/options$/, 'none', async ({ body }) => {
            noVault();
            return rp.registrationOptions({ existing: [], attachment: body.attachment });
        }],
        ['POST', /^\/api\/setup\/passkey\/verify$/, 'none', async ({ body, res }) => {
            noVault();
            const prf = prfBuffer(body.prfOutput);
            const { credential, prfSalt } = await rp.verifyRegistration(body.response);
            if (prf) return create(res, credential, prf, prfSalt);
            waiting = { credential, prfSalt };
            const { options } = await rp.authenticationOptions({ credentials: [credential], prfSalts: {}, kind: 'setup-prf' });
            return { needsPrf: true, options, prfSalt };
        }],
        ['POST', /^\/api\/setup\/passkey\/prf$/, 'none', async ({ body, res }) => {
            noVault();
            if (!waiting) throw httpError('NOT_FOUND', 'no passkey is waiting for its PRF output');
            const { credential, prfSalt } = waiting;
            waiting = null; // eenmalig, ook als het misgaat
            const { newCounter } = await rp.verifyAuthentication(body.response, [credential], 'setup-prf');
            const prf = prfBuffer(body.prfOutput);
            if (!prf) throw noPrf();
            return create(res, { ...credential, counter: newCounter }, prf, prfSalt);
        }],
    ];
}
