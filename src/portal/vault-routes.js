// Kluisbeheer vanuit het portaal: definitief verwijderen (vereist aanraking via step-up,
// beëindigt alle sessies, sluit en wist de kluis en records). Deel van het portaal (index.js).

/**
 * @param {{ vault: object, auditAdmin: Function, endSession: Function, endOtherSessions: Function, push: object }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function vaultRoutes({ vault, auditAdmin, endSession, endOtherSessions, push }) {
    const deleteVault = async ({ req, res }) => {
        await auditAdmin('vault-deleted');
        await vault.deleteVault();
        endSession(req, res);
        endOtherSessions(null);
        push.sessionsEnded();
        return { deleted: true };
    };

    return [
        ['POST', /^\/api\/vault\/delete$/, 'unlocked', deleteVault],
        ['DELETE', /^\/api\/vault$/, 'unlocked', deleteVault],
    ];
}
