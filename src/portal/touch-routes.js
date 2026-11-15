// Een aanraking van de passkey bevestigen. Deel van het portaal (index.js). Geen sessie nodig (auth
// 'touch'): alleen een geldige WebAuthn-assertie op de challenge van dit id bevestigt; het id is willekeurig en eenmalig.

const ID = '([A-Za-z0-9_-]{16,64})';

/**
 * @param {{ touch: object|null, rp: object, vault: object, touchCredentials: () => object[], log: Function, httpError: Function }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function touchRoutes({ touch, rp, vault, touchCredentials, log, httpError }) {
    function view(id) {
        const found = touch?.view(id);
        if (!found) throw httpError('NOT_FOUND', 'no such confirmation (expired or answered)');
        return found;
    }

    return [
        ['GET', new RegExp(`^/api/touch/${ID}$`), 'touch', ({ match }) => view(match[1])],
        ['POST', new RegExp(`^/api/touch/${ID}/options$`), 'touch', async ({ match }) => {
            view(match[1]);
            return rp.authenticationOptions({ credentials: touchCredentials(), prfSalts: {}, kind: `touch:${match[1]}` });
        }],
        ['POST', new RegExp(`^/api/touch/${ID}/verify$`), 'touch', async ({ match, body }) => {
            view(match[1]);
            const { credentialId, newCounter } = await rp.verifyAuthentication(body.response, touchCredentials(), `touch:${match[1]}`);
            await vault.updateCredentialCounter(credentialId, newCounter);
            if (!touch.complete(match[1], 'ok')) throw httpError('NOT_FOUND', 'no such confirmation');
            log({ event: 'touch-confirmed' });
            return { confirmed: true };
        }],
        ['POST', new RegExp(`^/api/touch/${ID}/deny$`), 'touch', ({ match }) => {
            if (!touch?.complete(match[1], 'denied')) throw httpError('NOT_FOUND', 'no such confirmation');
            log({ event: 'touch-denied' });
            return { denied: true };
        }],
    ];
}
