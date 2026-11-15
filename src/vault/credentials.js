// WebAuthn-credentials van het portaal in de kluisheader: open (de login gebeurt vóór het ontgrendelen), maar de lijst van
// id's en publieke sleutels zit onder de MAC: een onderschoven credential laat het ontgrendelen falen (bitwarden-model.md §3).

/**
 * @param {{ current: () => object, requireKey: () => Buffer, serialized: Function, writeHeader: Function, sign: Function,
 *           clock: { now(): number }, lastMethod: () => Error }} deps  current: de laatst gelezen of geschreven header
 */
export function createCredentials({ current, requireKey, serialized, writeHeader, sign, clock, lastMethod }) {
    const listCredentials = () => (current()?.credentials ?? []).map(c => ({ ...c }));

    async function addCredential(credential) {
        requireKey();
        return serialized(async () => {
            const header = current();
            const credentials = [...header.credentials.filter(c => c.id !== credential.id), { ...credential, createdAt: clock.now() }];
            await writeHeader(sign({ ...header, credentials }));
        });
    }

    async function removeCredential(id) {
        requireKey();
        const remaining = current().credentials.filter(c => c.id !== id);
        if (remaining.length === 0 && current().credentials.length > 0) throw lastMethod();
        return serialized(async () => {
            const header = current();
            await writeHeader(sign({ ...header, credentials: header.credentials.filter(c => c.id !== id) }));
        });
    }

    /** De sign-counter mag ook vergrendeld bijgewerkt worden; hij valt buiten de MAC (alleen id + publieke sleutel). */
    async function updateCredentialCounter(id, counter) {
        return serialized(async () => {
            const header = current();
            await writeHeader({ ...header, credentials: header.credentials.map(c => (c.id === id ? { ...c, counter } : c)) });
        });
    }

    return Object.freeze({ listCredentials, addCredential, removeCredential, updateCredentialCounter });
}
