// De software-passkey voor journeys moet door de echte verificatie komen, en een assertion op een andere challenge
// of origin MOET geweigerd worden (anders bewijst een journey met deze helper niets).
import { describe, it, expect } from 'vitest';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';

const origin = 'http://localhost:8485';
const verify = (auth, response, challenge) => verifyAuthenticationResponse({
    response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: 'localhost', requireUserVerification: true,
    credential: { id: auth.credential.id, publicKey: Buffer.from(auth.credential.publicKey, 'base64url'), counter: 0 },
});

describe('software-passkey (testhulp)', () => {
    it('een assertion slaagt bij @simplewebauthn/server', async () => {
        const auth = createSoftAuthenticator();
        const result = await verify(auth, auth.assert({ challenge: 'abc', origin }), 'abc');
        expect(result.verified).toBe(true);
        expect(result.authenticationInfo.newCounter).toBe(1);
    });

    it('MOET weigeren: een andere challenge of origin', async () => {
        const auth = createSoftAuthenticator();
        await expect(verify(auth, auth.assert({ challenge: 'abc', origin }), 'xyz')).rejects.toThrow();
        await expect(verify(auth, auth.assert({ challenge: 'abc', origin: 'http://evil.example' }), 'abc')).rejects.toThrow();
    });
});
