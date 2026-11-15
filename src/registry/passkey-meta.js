// Wat de gebruiker over een passkey weet: een eigen naam ("YubiKey sleutelbos") en wanneer ze laatst gebruikt werd.
// Versleuteld in de kluis zoals de rest (de kluisheader bevat alleen wat nodig is om in te loggen). Deel van de registry.

const MAX_NAME = 64;

/** @param {{ vault, clock, all: Function, tagged: Function }} deps */
export function createPasskeyMeta({ vault, clock, all, tagged }) {
    const find = async credentialId => (await all('passkey-meta', ['credentialId', 'name', 'lastUsedAt'])).find(m => m.credentialId === credentialId);

    async function put(credentialId, patch) {
        const current = await find(credentialId);
        return vault.put({ kind: 'passkey-meta', credentialId, name: current?.name ?? '', lastUsedAt: current?.lastUsedAt ?? null, ...patch }, current?.id);
    }

    /** Per credential-id: naam (leeg = de standaardnaam) en laatst gebruikt. */
    const listPasskeyMeta = async () => new Map((await all('passkey-meta', ['credentialId', 'name', 'lastUsedAt'])).map(m => [m.credentialId, { name: m.name ?? '', lastUsedAt: m.lastUsedAt ?? null }]));

    /** Een naam van 0 tot 64 tekens, zonder regeleinden; leeg wist de naam. */
    async function setPasskeyName(credentialId, name) {
        const text = typeof name === 'string' ? name.trim() : null;
        if (text === null || text.length > MAX_NAME || /[\r\n]/.test(text)) throw tagged('INVALID_NAME', `a passkey name has at most ${MAX_NAME} characters on one line`);
        return put(credentialId, { name: text });
    }

    const touchPasskey = credentialId => put(credentialId, { lastUsedAt: clock.now() });

    async function removePasskeyMeta(credentialId) {
        const current = await find(credentialId);
        if (current) await vault.remove(current.id);
    }

    return Object.freeze({ listPasskeyMeta, setPasskeyName, touchPasskey, removePasskeyMeta });
}
