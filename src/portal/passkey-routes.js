// De passkeys van de kluis in het portaal: de lijst (soort, PRF, naam, laatst gebruikt), een naam geven, verwijderen.
// De naam en "laatst gebruikt" staan versleuteld in de kluis (registry); de credentials zelf in de kluisheader.

/** @param {{ vault, registry, policy, endOtherSessions: Function, httpError: Function }} deps */
export function passkeyRoutes({ vault, registry, policy, endOtherSessions, httpError }) {
    const known = id => {
        if (!vault.listCredentials().some(c => c.id === id)) throw httpError('NOT_FOUND', 'no such passkey');
        return id;
    };
    return [
        ['GET', /^\/api\/passkeys$/, 'unlocked', async () => {
            const withPrf = new Set(vault.passkeySalts().map(p => p.credentialId));
            const meta = await registry.listPasskeyMeta();
            return vault.listCredentials().map(c => ({
                id: c.id, createdAt: c.createdAt, transports: c.transports ?? [], prf: withPrf.has(c.id), blockedUntil: policy.blockedUntilFor(c.id),
                name: meta.get(c.id)?.name ?? '', lastUsedAt: meta.get(c.id)?.lastUsedAt ?? null,
            }));
        }],
        ['PUT', /^\/api\/passkeys\/([A-Za-z0-9_-]+)\/name$/, 'unlocked', async ({ body, match }) => {
            await registry.setPasskeyName(known(match[1]), body.name);
            return { updated: true };
        }],
        ['DELETE', /^\/api\/passkeys\/([A-Za-z0-9_-]+)$/, 'unlocked', async ({ match, session }) => {
            await vault.removeCredential(match[1]);
            await vault.removePasskey(match[1]);
            await registry.removePasskeyMeta(match[1]);
            endOtherSessions(session.id);
            return { removed: true };
        }],
    ];
}
