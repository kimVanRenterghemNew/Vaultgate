# Code-integriteit en distributie zonder certificaatbudget

Dit document beschrijft hoe Vaultgate beschermd kan worden tegen lokale manipulatie (*tampering*) van JavaScript-bestanden, rekening houdend met de randvoorwaarden van een **hobbyproject zonder budget voor dure commerciële code-signing certificaten**.

---

## 1. Het probleem: Lokale manipulatie door AI-agents of malware

Vaultgate fungeert als veiligheidssluis tussen AI-agents (zoals Claude Code, Roo Code, Cursor) en gevoelige API-sleutels. 
Een voor de hand liggende aanvalsvector voor een malafide of gecompromitteerde agent met lokale schrijfpermissies is:
- De JavaScript-broncode van Vaultgate opzoeken op schijf (bijv. in `node_modules/vaultgate/src/...` of `%APPDATA%\npm\node_modules\vaultgate\...`);
- De code patchen (bijv. de controle in `policy/index.js` of `vault/index.js` uitschakelen);
- Zo alsnog geheimen uitlezen of de beveiligingsregels omzeilen.

---

## 2. Waarom encryptie (bijv. versleutelde ZIP) conceptueel niet werkt

Het idee om JavaScript-bestanden te versleutelen in een ZIP of binary stuit op het fundamentele probleem van **Digital Rights Management (DRM) op een client**:
1. De Node.js runtime moet uiteindelijk platte JavaScript-code kunnen interpreteren en uitvoeren in het computergeheugen.
2. Als de code versleuteld is, moet de ontcijfersleutel óók lokaal aanwezig zijn (in code, geheugen of via een hardcoded geheim).
3. Elk proces of elke gebruiker met debuggers (of een agent met leesrechten) kan die sleutel achterhalen en de broncode alsnog inzien of ontcijferen.
4. Versleuteling kost veel runtime-overhead en biedt **geen enkele cryptografische garantie tegen manipulatie**, omdat de aanvaller gewoon de runtime of het geheugen kan manipuleren.

---

## 3. De realiteit van executables (`.exe`) en Code Signing Certificaten

Het bouwen van een losse executable (`vaultgate.exe` via bijv. Node.js Single Executable Application / SEA, `pkg` of `bun compile`) lost het "losse bestanden op schijf"-probleem op, maar brengt een groot distributieprobleem met zich mee:
- **Windows Defender SmartScreen**: Een niet-ondertekende `.exe` die van internet wordt gedownload krijgt direct een felblauwe waarschuwing (*"Windows heeft uw pc beschermd - Onbekende uitgever"*) en veel virusscanners blokkeren de executable preventief (valse positieven op heuristiek).
- **Kosten van een certificaat**: Een geldig Authenticode-certificaat (laat staan een Extended Validation / EV-certificaat) kost al snel **€300 tot €600+ per jaar**, en vereist vaak een officiële bedrijfsregistratie (KVK/D-U-N-S). Voor een open-source hobbyproject is dit niet realistisch.

---

## 4. De pragmatische oplossing via `npm` (0 euro)

Door Vaultgate via **npm** te distribueren (bijv. `npm install -g vaultgate` of `npx vaultgate`), omzeilen we het SmartScreen-probleem: Node.js is al een vertrouwd proces op de machine van de ontwikkelaar. 

Om te voorkomen dat de JavaScript-bestanden eenvoudig aangepast worden, passen we de volgende lagen toe:

```
┌────────────────────────────────────────────────────────┐
│ 1. npm Provenance (Sigstore / OIDC via GitHub Actions) │ ──▶ Verifieert herkomst uit publieke repo
├────────────────────────────────────────────────────────┤
│ 2. Single-file Bundling & Minificatie (esbuild/rollup) │ ──▶ Geen losse modulaire bestanden
├────────────────────────────────────────────────────────┤
│ 3. Runtime Hash-integriteitscontrole (SHA-256)        │ ──▶ Proces weigert te starten bij patch
├────────────────────────────────────────────────────────┤
│ 4. Beperkte OS-schrijfrechten (Installatieadvies)      │ ──▶ Agent kan bestand niet overschrijven
└────────────────────────────────────────────────────────┘
```

### Laag 1: npm Provenance & OpenID Connect (Gratis)
Sinds 2023 ondersteunt npm **Provenance** via Sigstore (Linux Foundation):
- In de GitHub Actions release-workflow publiceren we met:
  ```bash
  npm publish --provenance --access public
  ```
- npm genereert een cryptografisch bewijs dat het pakket rechtstreeks is gebouwd vanuit de specifieke commit en GitHub Actions workflow in de officiële repository.
- Gebruikers en security-tools kunnen met `npm audit` of `npm view vaultgate --json` direct zien dat het pakket authentiek is en niet onderweg gemanipuleerd is.

### Laag 2: Single-File Bundling & Minificatie
In plaats van tientallen losse bestanden in `src/` te publiceren:
- Bundel alle code van Vaultgate samen tot één enkel bestand: `dist/vaultgate.cjs` (bijv. met `esbuild` of `@vercel/ncc`).
- Minifieer de code (verwijder comments, mangel lokale functienamen).
- **Effect**: Een AI-agent die bestanden inspecteert kan niet even snel `src/policy/blocks.js` openen om één regeltje `return true` toe te voegen. Het patchen van een geminifieerde bundel vereist aanzienlijk meer moeite en faalt snel door syntaxfouten.

### Laag 3: Asymmetrische handtekeningcontrole (Ed25519 digitale handtekening)

In plaats van alleen een statische hash, gebruiken we **asymmetrische cryptografie (digitale handtekening)**. Dit is exact het principe van *"alleen uitpakken/controleren met een public key"*:

```
[ Build & Release (GitHub Actions) ]
  1. esbuild bundelt src/ ──────────────▶ dist/vaultgate.cjs
  2. Auteur signeert met Private Key ──▶ dist/vaultgate.sig (Ed25519 signature)
  3. npm publish

[ Opstarten bij de gebruiker (lokaal) ]
  1. Bootstrap script (bin/vaultgate.js) leest dist/vaultgate.cjs en dist/vaultgate.sig
  2. Verifieert handtekening met de ingebouwde Public Key (Ed25519)
  ┌────────────────────────────────────────────────────────┐
  │ crypto.verify(null, codeBuffer, publicKey, signature) │
  └────────────────────────────────────────────────────────┘
       │
       ├── Geldig ──▶ Start Vaultgate en laad kluis
       └── Fout   ──▶ STOP! "Code tampered with: signature invalid"
```

#### Waarom dit waterdicht is tegen lokale agents:
- **Eenzijdige controle**: De ontwikkelaar/release-pipeline heeft de **geheime Private Key** (bewaard in GitHub Actions Secrets). Alleen die sleutel kan een geldige handtekening genereren.
- **Alleen de Public Key zit in Vaultgate**: De software heeft alleen de publieke sleutel nodig om de handtekening te controleren (`crypto.verify`).
- **Niet te vervalsen**: Als een lokale AI-agent ook maar 1 byte aanpast in `vaultgate.cjs`, is de handtekening wiskundig ongeldig. Omdat de agent **niet** over de private key beschikt, kan de agent géén nieuwe geldige `.sig` aanmaken.
- **Kosten**: **0 euro**. Gebruikt standaard `node:crypto` (Ed25519) zonder afhankelijkheid van externe commerciële certificeringsinstanties (CA's).

#### Voorbeeld implementatie in Node.js:

**Tijdens de build (`scripts/sign-bundle.mjs`):**
```js
import crypto from 'node:crypto';
import fs from 'node:fs';

const bundle = fs.readFileSync('dist/vaultgate.cjs');
const privateKey = process.env.VAULTGATE_SIGNING_KEY; // Ed25519 private key
const signature = crypto.sign(null, bundle, privateKey);
fs.writeFileSync('dist/vaultgate.sig', signature);
```

**Tijdens de start (`bin/vaultgate.js`):**
```js
import crypto from 'node:crypto';
import fs from 'node:fs';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA... [Hardcoded Ed25519 Public Key van Vaultgate]
-----END PUBLIC KEY-----`;

const bundle = fs.readFileSync(new URL('../dist/vaultgate.cjs', import.meta.url));
const signature = fs.readFileSync(new URL('../dist/vaultgate.sig', import.meta.url));

const isValid = crypto.verify(null, bundle, PUBLIC_KEY, signature);
if (!isValid) {
  console.error('[FATAL] Vaultgate integriteitscontrole mislukt!');
  console.error('De bestanden op schijf zijn aangepast of beschadigd.');
  process.exit(1);
}

// Pas na geldige verificatie wordt de code geladen:
await import('../dist/vaultgate.cjs');
```

### Laag 4: Installatie met beperkte schrijfrechten
In de documentatie adviseren we gebruikers:
- Installeer Vaultgate globaal in een directory waar standaard processen geen schrijfrechten hebben (zoals `Program Files` onder Windows via een beheerder/elevated prompt, of root op Linux/macOS).
- Een AI-agent (die draait onder de normale gebruikerscontext) heeft dan **geen schrijfpermissies** op de programmamap van Vaultgate en kan de bestanden fysiek niet overschrijven.

---

## 5. Roadmap voor latere fasen

| Fase | Maatregel | Kosten | Doel |
|---|---|---|---|
| **Nu (v1)** | `dist/` bundelen met esbuild + Ed25519 handtekeningverificatie | €0 | Voorkomt dat lokale agents losse JS-bestanden manipuleren |
| **Release (v1)** | `npm publish --provenance` via GitHub Actions | €0 | Cryptografisch bewijs van herkomst via Sigstore |
| **v2 (optioneel)** | Distributie via Windows Package Manager (`winget`) | €0 | Microsoft beheert reputatie en distributie |
| **v3 (indien budget)** | Authenticode EV Certificaat | ~€400/jr | Standalone `.exe` zonder SmartScreen-waarschuwing |
