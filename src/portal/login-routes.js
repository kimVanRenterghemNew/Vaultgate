// Inloggen in het portaal met een passkey (WebAuthn), en met PRF meteen ontgrendelen. Een teruggezette oudere kopie
// van de kluis (anti-rollback) of gewijzigde eigen code opent dan niet: het antwoord draagt `rule: 'vault-rolled-back'` of
// `rule: 'code-changed'`, en de gebruiker kan het bewust bevestigen met `acceptRollback` / `acceptCodeChange` (in de audit
// als `vault-rollback-accepted` / `code-change-accepted`).

/** De bevestigingen uit een request: alleen een echte `true` telt. */
export const accepts = body => ({ acceptRollback: body.acceptRollback === true, acceptCodeChange: body.acceptCodeChange === true });

/** De regels van een ontgrendeling die een bewuste bevestiging waren (voor de audit). */
export const acceptedRules = rules => rules.filter(rule => rule.endsWith('-accepted'));

const REFUSED = Object.freeze({ VAULT_ROLLED_BACK: 'vault-rolled-back', CODE_CHANGED: 'code-changed' });

/** @param {{ rp, vault, registry, policy, newSession: Function, afterUnlock: Function, auditPortal: Function, log: Function, httpError: Function, prfBuffer: Function, redeemTicket?: Function }} deps */
export function loginRoutes({ rp, vault, registry, policy, newSession, afterUnlock, auditPortal, log, httpError, prfBuffer, redeemTicket }) {
    return [
        // Eenmalige sessie-URL uit de tray (CPS, 9.10): alleen met een al geopende kluis; eenmalig kaartje.
        ['POST', /^\/api\/session\/redeem$/, 'none', async ({ body, res }) => {
            if (!vault.isUnlocked()) throw httpError('UNAUTHENTICATED', 'vault is locked');
            const session = redeemTicket(body.ticket, res);
            if (!session) throw httpError('UNAUTHENTICATED', 'invalid or expired session ticket');
            log({ event: 'portal-session-redeemed' });
            return { loggedIn: true, unlocked: true, csrf: session.csrf };
        }],
        ['POST', /^\/api\/webauthn\/login\/options$/, 'none', async () => {
            const credentials = policy.availableCredentials(vault.listCredentials());
            if (credentials.length === 0) throw httpError('NOT_FOUND', 'no passkey registered yet');
            const allowed = new Set(credentials.map(c => c.id));
            const prfSalts = Object.fromEntries(vault.passkeySalts().filter(p => allowed.has(p.credentialId)).map(p => [p.credentialId, p.prfSalt]));
            return rp.authenticationOptions({ credentials, prfSalts });
        }],
        ['POST', /^\/api\/webauthn\/login\/verify$/, 'none', async ({ body, res }) => {
            const prf = prfBuffer(body.prfOutput);
            const { credentialId, newCounter } = await rp.verifyAuthentication(body.response, policy.availableCredentials(vault.listCredentials()));
            await vault.updateCredentialCounter(credentialId, newCounter);
            const session = newSession(res);
            let unlocked = vault.isUnlocked();
            let refused = null;
            if (prf && !unlocked) {
                try {
                    for (const rule of acceptedRules(await afterUnlock(() => vault.unlockWithPrf({ credentialId, prfOutput: prf, ...accepts(body) })))) auditPortal(rule);
                    unlocked = true;
                } catch (error) {
                    refused = REFUSED[error.code] ?? null;
                    log({ event: 'prf-unlock-failed', code: error.code ?? 'unknown' });
                }
            }
            if (unlocked) await registry.touchPasskey(credentialId); // "laatst gebruikt", versleuteld: alleen met een open kluis
            log({ event: 'portal-login', unlocked });
            return { loggedIn: true, unlocked, ...(refused ? { rule: refused } : {}), csrf: session.csrf };
        }],
    ];
}
