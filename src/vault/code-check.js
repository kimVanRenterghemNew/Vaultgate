// De eigen code bij ontgrendelen: de hashes van de geïnstalleerde bestanden (bij de start gelezen, src/code-integrity)
// tegen de lijst die de kluis de vorige keer vastlegde. Die lijst staat in de header als `code`, versleuteld met de vault
// key (AEAD, ook de bestandsnamen zijn dus niet leesbaar) en onder de manifest-MAC: weghalen, vervangen of uit een andere
// kluis halen geeft VAULT_TAMPERED, en dus geen stille nieuwe vastlegging van gepatchte code.
// Een afwijking: de kluis opent niet tot de gebruiker bevestigt (`acceptCodeChange`); dan geldt de nieuwe code.
// Een kluis zonder lijst (van vóór deze controle) krijgt er een bij het eerste ontgrendelen: dan valt er niets te vergelijken.
import { decide } from '../decision/index.js';
import { changedFiles } from '../code-integrity/index.js';

export const CODE_CHANGED = 'CODE_CHANGED';

const AAD = 'code|files|v1';

const RULES = Object.freeze([
    { name: 'code-unchecked', when: c => !c.current, then: { allow: true, rewrite: false } },
    { name: 'code-first-seen', when: c => !c.recorded, then: { allow: true, rewrite: true } },
    { name: 'code-changed', when: c => c.changed.length > 0 && !c.accept, then: { allow: false, rewrite: false } },
    { name: 'code-change-accepted', when: c => c.changed.length > 0, then: { allow: true, rewrite: true } },
    { name: 'code-unchanged', when: () => true, then: { allow: true, rewrite: false } },
]);

/** De lijst versleuteld voor de header. */
export const sealCode = (key, current, crypto) => crypto.encrypt(key, JSON.stringify(current), AAD);

/**
 * De beslissing: `{ allow, rewrite, rule, changed }`. `current` ontbreekt alleen in tests van andere modules.
 * @param {{ key: Buffer, sealed?: string, current?: Record<string, string>, accept: boolean, crypto: object, tampered: (what: string) => Error }} c
 */
export function checkCode({ key, sealed, current, accept, crypto, tampered }) {
    let recorded = null;
    if (sealed !== undefined) {
        try { recorded = JSON.parse(crypto.decrypt(key, sealed, AAD).toString('utf8')); } catch { throw tampered('code'); }
    }
    const changed = recorded && current ? changedFiles(recorded, current) : [];
    return { ...decide({ current, recorded, changed, accept }, RULES), changed };
}

/** De fout bij een afwijking: noemt de bestanden (paden van de installatie, geen geheim). */
export const codeChangedError = files => Object.assign(
    new Error(`Vaultgate's own files changed since the vault was last opened here: ${files.join(', ')}; confirm to accept`),
    { code: CODE_CHANGED, rule: 'code-changed', files },
);
