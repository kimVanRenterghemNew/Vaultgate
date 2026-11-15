// Een bevestiging die een programma niet kan geven. Een proces van dezelfde gebruiker kan de knoppen van de
// tray-pop-up indrukken (UI Automation), maar geen passkey aanraken. Deze module houdt per bevestiging een id, de vraag
// (zonder waarden) en een time-out bij, en opent het portaalvenster op dat id. Het portaal controleert de WebAuthn-assertie
// (user verification) en meldt dan `complete(id, 'ok')`. Alles in het geheugen; een id is eenmalig.

/** @typedef {'ok'|'denied'|'timeout'|'unavailable'} TouchResult */

const OUTCOMES = new Set(['ok', 'denied']);
const EXTERNAL = new Set(['usb', 'nfc', 'ble', 'hybrid']);

/**
 * Welke passkeys een aanraking mogen geven. `any`: alle; `external`: alleen een sleutel of telefoon (transport
 * usb, nfc, ble of hybrid, zoals de browser het bij registreren meldde), geen authenticator in de pc (Windows Hello-pin).
 * Een onbekende instelling laat niets door.
 */
export function touchCredentials(credentials, mode) {
    if (mode === 'any') return credentials;
    if (mode === 'external') return credentials.filter(c => (c.transports ?? []).some(t => EXTERNAL.has(t)));
    return [];
}

/**
 * @param {{ clock: { now(), setTimeout(fn, ms), clearTimeout(id) }, timeoutMs?: number, newId: () => string,
 *           available: () => boolean, open: (id: string) => void }} deps
 *   available: is er een passkey om aan te raken; open: het portaalvenster op deze bevestiging openen.
 */
export function createTouch({ clock, timeoutMs = 120_000, newId, available, open }) {
    const pending = new Map(); // id -> { question, expiresAt, settle, timer }

    /**
     * @param {{ tool, secret, host, method, path, reason: 'always'|'sensitive'|'device' }} question
     * @param {{ open?: (id: string) => void }} [options] open: in plaats van het venster (bv. het portaal dat zelf vraagt)
     * @returns {Promise<TouchResult>}
     */
    function confirm(question, options = {}) {
        if (!available()) return Promise.resolve('unavailable');
        const id = newId();
        return new Promise(resolve => {
            const entry = { question: Object.freeze({ ...question }), expiresAt: clock.now() + timeoutMs };
            entry.settle = result => { clock.clearTimeout(entry.timer); pending.delete(id); resolve(result); };
            entry.timer = clock.setTimeout(() => entry.settle('timeout'), timeoutMs);
            pending.set(id, entry);
            try {
                (options.open ?? open)(id);
            } catch {
                entry.settle('unavailable');
            }
        });
    }

    /** Wat het venster toont: de vraag en tot wanneer, of null (onbekend, verlopen of al beantwoord). */
    function view(id) {
        const entry = pending.get(id);
        return entry ? Object.freeze({ ...entry.question, expiresAt: entry.expiresAt }) : null;
    }

    /** Het portaal meldt de uitkomst ('ok' alleen na een geldige assertie). Geeft false bij een onbekend id of uitkomst. */
    function complete(id, outcome) {
        const entry = pending.get(id);
        if (!entry || !OUTCOMES.has(outcome)) return false;
        entry.settle(outcome);
        return true;
    }

    return Object.freeze({ confirm, view, complete });
}
