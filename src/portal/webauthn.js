// Relying party voor het portaal. @simplewebauthn/server in dit proces; RP-id
// `localhost`, origin `http://localhost:<poort>`, user verification vereist, attestation `none`. Challenges zijn eenmalig en
// verlopen na 2 minuten. Per registratie kiest de server een willekeurige PRF-salt (32 byte) voor het ontgrendelen.
import {
    generateRegistrationOptions, verifyRegistrationResponse,
    generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const RP_ID = 'localhost';
const CHALLENGE_MS = 2 * 60_000;

export const WEBAUTHN_FAILED = 'WEBAUTHN_FAILED';
const failed = why => Object.assign(new Error(`webauthn verification failed: ${why}`), { code: WEBAUTHN_FAILED });

/** De soort passkey uit het portaal, naar het type van @simplewebauthn (dat er de hint en de attachment bij zet). */
const PREFERRED = Object.freeze({ 'security-key': 'securityKey', phone: 'remoteDevice', platform: 'localDevice' });

export function createRelyingParty({ crypto, clock }) {
    let origin = null;
    const pending = new Map(); // challenge -> { kind, expires, prfSalt? }

    const remember = (challenge, entry) => {
        for (const [c, e] of pending) if (e.expires < clock.now()) pending.delete(c);
        pending.set(challenge, { ...entry, expires: clock.now() + CHALLENGE_MS });
    };

    function take(response, kind) {
        let challenge;
        try {
            challenge = JSON.parse(Buffer.from(response?.response?.clientDataJSON ?? '', 'base64url').toString('utf8')).challenge;
        } catch {
            throw failed('unreadable client data');
        }
        const entry = pending.get(challenge);
        pending.delete(challenge); // eenmalig, ook als de verificatie faalt
        if (!entry || entry.kind !== kind || entry.expires < clock.now()) throw failed('unknown or expired challenge');
        return { challenge, entry };
    }

    /**
     * attachment: de soort die de gebruiker koos. 'security-key', 'phone' en 'platform' worden een WebAuthn-hint, zodat
     * de browser meteen het juiste vraagt (bij een telefoon de QR-code, niet eerst een hardware-sleutel). Een onbekende
     * soort: geen hint, geen beperking.
     */
    async function registrationOptions({ existing, attachment }) {
        const options = await generateRegistrationOptions({
            rpName: 'Vaultgate', rpID: RP_ID, userName: 'owner', userDisplayName: 'Vaultgate',
            attestationType: 'none',
            excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            preferredAuthenticatorType: PREFERRED[attachment],
        });
        const prfSalt = crypto.randomBytes(32).toString('base64url');
        remember(options.challenge, { kind: 'register', prfSalt });
        return { options, prfSalt };
    }

    async function verifyRegistration(response) {
        const { challenge, entry } = take(response, 'register');
        let result;
        try {
            result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: RP_ID, requireUserVerification: true });
        } catch (error) {
            throw failed(error.message);
        }
        if (!result.verified) throw failed('not verified');
        const { credential } = result.registrationInfo;
        return {
            credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports ?? [] },
            prfSalt: entry.prfSalt,
        };
    }

    async function authenticationOptions({ credentials, prfSalts, kind = 'login' }) {
        const options = await generateAuthenticationOptions({
            rpID: RP_ID, userVerification: 'required',
            allowCredentials: credentials.map(c => ({ id: c.id, transports: c.transports })),
        });
        remember(options.challenge, { kind });
        return { options, prfSalts };
    }

    async function verifyAuthentication(response, credentials, kind = 'login') {
        const { challenge } = take(response, kind);
        const stored = credentials.find(c => c.id === response.id);
        if (!stored) throw failed('unknown credential');
        let result;
        try {
            result = await verifyAuthenticationResponse({
                response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: RP_ID, requireUserVerification: true,
                credential: { id: stored.id, publicKey: Buffer.from(stored.publicKey, 'base64url'), counter: stored.counter, transports: stored.transports },
            });
        } catch (error) {
            throw failed(error.message);
        }
        if (!result.verified) throw failed('not verified');
        return { credentialId: stored.id, newCounter: result.authenticationInfo.newCounter };
    }

    return Object.freeze({
        setOrigin: o => { origin = o; },
        registrationOptions,
        verifyRegistration,
        authenticationOptions,
        verifyAuthentication,
    });
}
