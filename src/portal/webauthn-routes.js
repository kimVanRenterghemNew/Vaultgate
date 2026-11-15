// FIDO2 in het portaal: een passkey registreren (sessie + open kluis, en een aanraking van een bestaande passkey via
// step-up) en PRF later inschrijven; inloggen staat in login-routes.js. Deel van het portaal (index.js). Na een registratie
// volgen meteen een melding in de tray en `new-passkey-added` in de audit (beheer): een passkey die je zelf niet toevoegde, valt op.

/**
 * @param {{ rp, vault, auditAdmin: Function, notify: Function, translate: Function, log: Function, httpError: Function, prfBuffer: Function }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function webauthnRoutes({ rp, vault, auditAdmin, notify, translate, log, httpError, prfBuffer }) {
    return [
        ['POST', /^\/api\/webauthn\/register\/options$/, 'unlocked', async ({ body }) => {
            const { options, prfSalt } = await rp.registrationOptions({ existing: vault.listCredentials(), attachment: body.attachment });
            return { options, prfSalt };
        }],
        ['POST', /^\/api\/webauthn\/register\/verify$/, 'unlocked', async ({ body }) => {
            const prf = prfBuffer(body.prfOutput);
            const { credential, prfSalt } = await rp.verifyRegistration(body.response);
            await vault.addCredential(credential);
            if (prf) await vault.addPasskey({ credentialId: credential.id, prfOutput: prf, prfSalt });
            log({ event: 'passkey-registered', prf: Boolean(prf) });
            await auditAdmin('new-passkey-added', { detail: `prf: ${Boolean(prf)}` });
            notify({ title: translate('tray.notify.passkeyAdded.title'), text: translate('tray.notify.passkeyAdded.text') });
            return { registered: true, prf: Boolean(prf), credentialId: credential.id, prfSalt: prf ? null : prfSalt };
        }],
        ['POST', /^\/api\/webauthn\/prf-enroll\/options$/, 'unlocked', async ({ body }) => {
            const credential = vault.listCredentials().find(c => c.id === body.credentialId);
            if (!credential) throw httpError('NOT_FOUND', 'unknown passkey');
            return rp.authenticationOptions({ credentials: [credential], prfSalts: { [credential.id]: body.prfSalt }, kind: 'prf-enroll' });
        }],
        ['POST', /^\/api\/webauthn\/prf-enroll\/verify$/, 'unlocked', async ({ body }) => {
            const prf = prfBuffer(body.prfOutput);
            const { credentialId, newCounter } = await rp.verifyAuthentication(body.response, vault.listCredentials(), 'prf-enroll');
            await vault.updateCredentialCounter(credentialId, newCounter);
            if (!prf) return { prf: false };
            await vault.addPasskey({ credentialId, prfOutput: prf, prfSalt: body.prfSalt });
            await auditAdmin('passkey-prf-enrolled');
            return { prf: true };
        }],
    ];
}
