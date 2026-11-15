// De MAC's van de kluisheader: methodes (publieke sleutels), audit-sleutel, manifest en de lijst van portaal-credentials.
// De MAC-sleutel is een subsleutel van de vault key; een teruggezet record of een onderschoven publieke sleutel valt op.
// De teller (epoch, anti-rollback) zit in de manifest-MAC; een header van vóór de teller heeft er geen en blijft geldig.

const methodMacInput = m => `method|${m.id}|${m.type}|${m.credentialId ?? ''}|${m.publicKey}`;
// De versleutelde lijst van de eigen code (./code-check.js) zit er ook onder: weghalen of vervangen valt op.
const manifestMacInput = (records, epoch, code) => `manifest|${Object.keys(records).sort().map(id => `${id}:${records[id]}`).join(',')}${epoch === undefined ? '' : `|epoch:${epoch}`}${code === undefined ? '' : `|code:${code}`}`;
const auditMacInput = a => `audit|${a.publicKey}`;
const credentialsMacInput = list => `credentials|${[...list].sort((x, y) => x.id.localeCompare(y.id)).map(c => `${c.id}:${c.publicKey}`).join(',')}`;

/** De header met alle MAC's herberekend. */
export function signHeader(h, mac, crypto) {
    return {
        ...h,
        methods: h.methods.map(m => ({ ...m, publicKeyMac: crypto.keyedHash(mac, methodMacInput(m)) })),
        audit: { ...h.audit, publicKeyMac: crypto.keyedHash(mac, auditMacInput(h.audit)) },
        manifest: { records: h.manifest.records, mac: crypto.keyedHash(mac, manifestMacInput(h.manifest.records, h.epoch, h.code)) },
        credentialsMac: crypto.keyedHash(mac, credentialsMacInput(h.credentials)),
    };
}

/** Gooit `tampered(wat)` als een MAC niet klopt. */
export function verifyHeader(h, mac, crypto, tampered) {
    const ok = (input, expected) => typeof expected === 'string' && crypto.equal(Buffer.from(crypto.keyedHash(mac, input)), Buffer.from(expected));
    for (const m of h.methods) if (!ok(methodMacInput(m), m.publicKeyMac)) throw tampered(`method ${m.id}`);
    if (!ok(auditMacInput(h.audit), h.audit.publicKeyMac)) throw tampered('audit key');
    if (h.epoch !== undefined && (!Number.isSafeInteger(h.epoch) || h.epoch < 0)) throw tampered('epoch');
    if (h.code !== undefined && typeof h.code !== 'string') throw tampered('code');
    if (!ok(manifestMacInput(h.manifest.records, h.epoch, h.code), h.manifest.mac)) throw tampered('manifest');
    if (!ok(credentialsMacInput(h.credentials), h.credentialsMac)) throw tampered('credentials');
}
