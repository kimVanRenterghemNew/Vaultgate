# Aanvalsbank (`npm run attack`)

Elke aanval die we kennen (uit de security-audits en de aanvalsanalyse), uitgevoerd tegen het echte proces met nep-secrets. Draai ze zelf: `npm run attack`. Wat open staat, staat erbij, met de reden. De tabel komt uit dezelfde data als de bank (`scripts/attack/attacks.mjs`); `test/attack/attack.journey.test.js` houdt ze gelijk.

<!-- aanvalsbank:start -->
| # | aanval | resultaat |
|---|---|---|
| A1 | Tool-key-bestand van een andere tool lezen en die tool nadoen | open: DPAPI beschermt alleen tegen andere accounts; een proces van dezelfde gebruiker kan de sleutel lezen (macOS/Linux volgt in 7.2) |
| A1b | Een verzonnen tool-key | geblokkeerd: `no-tool-key` |
| A1c | De key van een ingetrokken tool | geblokkeerd: `tool-key-revoked` |
| A1d | Een oude tool-key opnieuw aanbieden na rotatie (gestolen sleutel) | geblokkeerd: `key-reuse-detected` |
| A2 | Device flow: de naam van een bestaande tool overnemen | geblokkeerd |
| A2b | Device flow: een koppeling laten toestaan door de pop-up aan te klikken | geblokkeerd |
| A3 | De pop-up laten aanklikken via UI Automation ("altijd" zonder passkey) | geblokkeerd |
| A4 | Het tray-script of de code van Vaultgate aanpassen | geblokkeerd: `code-changed` |
| A4b | Installatiemap zonder schrijfrecht en ondertekende release | open: installatie zonder schrijfrecht en ondertekende release hangen af van release-export en deploy |
| A5 | Het geheugen van een ontgrendelde kluis lezen | open: de kluis blijft open tot Log out; JS-strings in het geheugen zijn niet te wissen |
| A8 | Prompt-injectie: het secret naar een andere host sturen | geblokkeerd: `target-host-not-allowed` |
| A8b | Pad-encoding om een pad-prefix te omzeilen | geblokkeerd: `bad-target` |
| A9 | Prompt-injectie: het secret in de query naar een toegestane host | geblokkeerd: `placeholder-location-not-allowed` |
| A9b | Prompt-injectie: het secret in een vrije header | geblokkeerd: `placeholder-location-not-allowed` |
| A10 | De doelhost kaatst het secret terug (ook base64 en hex) | geblokkeerd |
| A11 | Eén klik op "eenmalig" voor drie requests tegelijk | geblokkeerd |
| A13 | Man-in-the-middle: een keten naar een root buiten de lijst van geldige roots, voor een bekende host | geblokkeerd: `tls-untrusted` |
| A14 | Webpagina: DNS-rebinding naar het portaal | geblokkeerd |
| A14b | Webpagina: DNS-rebinding naar de device flow | geblokkeerd |
| A14c | Webpagina: een formulier naar de device flow | geblokkeerd |
| A15 | Lawaai: verzonnen keys raden (brute force) | geblokkeerd |
| A16 | Auto-vergrendelen rekken met onzin-keys | geblokkeerd |
| A12 | De audit saboteren (bestand alleen-lezen) | geblokkeerd: `audit-unavailable` |
| A12b | Na herhaalde auditfouten is de kluis dicht | geblokkeerd: `vault-locked` |
<!-- aanvalsbank:einde -->
