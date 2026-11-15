/**
 * Een passkey in software, voor journeys zonder browser: een P-256-sleutelpaar, de publieke sleutel als
 * COSE-sleutel (zoals de kluis hem van een registratie bewaart), en assertions zoals een authenticator ze maakt (user
 * present + user verified). Alleen voor tests en de aanvalsbank (die er de kluis mee inricht, een gevoelige wijziging
 * vraagt een aanraking): de private sleutel staat gewoon in het geheugen.
 */
import crypto from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');

/** Minimale CBOR voor een COSE EC2-sleutel: map met kleine gehele sleutels en byte-strings van 32 byte. */
function coseKey(x, y) {
    const int = n => (n >= 0 ? Buffer.from([n]) : Buffer.from([0x20 + (-1 - n)]));
    const bytes32 = b => Buffer.concat([Buffer.from([0x58, 0x20]), b]);
    return Buffer.concat([
        Buffer.from([0xa5]), // map met 5 paren
        int(1), int(2), // kty: EC2
        int(3), int(-7), // alg: ES256
        int(-1), int(1), // crv: P-256
        int(-2), bytes32(x),
        int(-3), bytes32(y),
    ]);
}

export function createSoftAuthenticator({ rpId = 'localhost' } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = b64u(crypto.randomBytes(16));
    let counter = 0;

    /** Het record zoals `vault.addCredential` het verwacht (zie src/portal/webauthn.js verifyRegistration). */
    const credential = Object.freeze({
        id, counter: 0, transports: ['internal'],
        publicKey: b64u(coseKey(Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'))),
    });

    /** Een assertion op `challenge` voor `origin` (de JSON-vorm die de browser met `toJSON()` geeft). */
    function assert({ challenge, origin }) {
        counter += 1;
        const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
        const count = Buffer.alloc(4);
        count.writeUInt32BE(counter);
        const authenticatorData = Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([0x05]), count]); // UP | UV
        const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]), privateKey);
        return {
            id, rawId: id, type: 'public-key', clientExtensionResults: {},
            response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) },
        };
    }

    /** Een registratie op `challenge` (attestation `none`), de JSON-vorm van `navigator.credentials.create(...).toJSON()`. */
    function register({ challenge, origin }) {
        const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
        const rawId = Buffer.from(id, 'base64url');
        const idLength = Buffer.alloc(2);
        idLength.writeUInt16BE(rawId.length);
        const authData = Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLength, rawId, Buffer.from(credential.publicKey, 'base64url')]); // UP | UV | AT
        const text = s => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);
        const bytes = b => Buffer.concat([b.length < 256 ? Buffer.from([0x58, b.length]) : Buffer.from([0x59, b.length >> 8, b.length & 0xff]), b]);
        const attestationObject = Buffer.concat([Buffer.from([0xa3]), text('fmt'), text('none'), text('attStmt'), Buffer.from([0xa0]), text('authData'), bytes(authData)]);
        return {
            id, rawId: id, type: 'public-key', clientExtensionResults: {},
            response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
        };
    }

    return Object.freeze({ credential, assert, register });
}
