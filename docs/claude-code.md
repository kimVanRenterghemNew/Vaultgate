# Claude Code (en andere tools) via Vaultgate

Stand 2026-10-10: gebouwd en getest. Vraag van de product owner via de review-sessie agenticteam-dd: Claude Code (deze en andere sessies op deze pc) moet voor **alle** secrets via Vaultgate werken.

## Uitgangspunt: geen sleutel in Claude Code

Claude Code heeft geen provider-sleutel en geen token. Het heeft alleen zijn eigen **tool-key** (`ks_…`), en die opent niets zonder een toekenning tool × secret × host (en de doelhost-allowlist van het secret). De echte waarden bestaan alleen in het proxy-proces, alleen tijdens het invullen van één request; antwoorden worden gescrubd (ook base64 en hex). Zo komt een waarde niet in de context van het model, niet in het transcript en niet in logs.

## 1. Koppelen: een key zonder login en zonder kopiëren (5.3, gebouwd)

```text
node src/main.js login --name claude-code
```

De CLI toont een code (bv. `K7QD-M2XP`); de tray vraagt "Een tool vraagt een key: koppelen?" met tool, code en client ([screenshot](screenshots/tray-popup-koppelen.png)), of je keurt goed in het portaal onder **Koppelen** ([screenshot](screenshots/portaal-12-koppelen.png)). Daarna staat de key in `%APPDATA%\vaultgate\clients\claude-code.key` (alleen leesbaar voor jou); hij verschijnt niet op het scherm. Opnieuw koppelen met dezelfde naam wordt geweigerd (`name_taken`): zo kan geen ander proces de identiteit en toekenningen van een tool overnemen. Een nieuwe key voor een bestaande tool maak je in het portaal (Tools, "Nieuwe key"). Een agent op de VM die koppelt, krijgt automatisch zijn eigen adres als client-allowlist.

## 2. De Anthropic-API (reverse route, gebouwd in 2.3)

In de instellingen van Claude Code (`settings.json`); `apiKeyHelper` print alleen de tool-key (`node src/main.js key`):

```json
{
  "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8484/anthropic" },
  "apiKeyHelper": "node <repo>/src/main.js key --name claude-code"
}
```

Claude Code stuurt wat de helper print waar het anders zijn API-sleutel zet; de proxy vervangt het door het echte secret `anthropic` (in `x-api-key`) en stuurt door naar `api.anthropic.com`. Sinds de keys vanzelf roteren ([security-model §3.1](security-model.md)) print `key --name` een token van 10 minuten en vervangt het de opgeslagen key; Claude Code vraagt de helper opnieuw bij een 401 en na zijn eigen TTL (niet geverifieerd tegen de broncode van Claude Code; `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` kan het korter zetten). Het adres van de proxy staat sinds `login` in het key-bestand; `--proxy URL` wint daarvan. Streaming (SSE) loopt ongebufferd door. De eerste call van deze tool naar dit secret vraagt goedkeuring in de tray; met "altijd" daarna niet meer.

## 3. Andere API's en commando's met een token

- **HTTP-API's** (curl, scripts, tools van Claude Code): forward via de proxy met een plaatshouder, bv. `curl http://127.0.0.1:8484/forward/https://api.github.com/user -H "x-vault-gate-tool-key: $(cat …)" -H "Authorization: Bearer {{secret:github_token}}"`. Het model ziet alleen de plaatshouder.
- **git over HTTPS** (idee review-sessie agenticteam-dd; gebouwd en getest met een echte `git ls-remote`): de remote-URL in de repo blijft de echte, git kent alleen de tool-key, de proxy zet het echte token in Basic-auth. In de instellingen van Vaultgate een route `{ "name": "github", "base": "https://github.com", "secret": "github_token", "header": "basic" }`, en in de git-configuratie:

  ```ini
  [url "http://127.0.0.1:8484/github/"]
  	insteadOf = https://github.com/
  [credential "http://127.0.0.1:8484"]
  	helper = !node <repo>/src/main.js git-credential --name claude-code
  ```

  De eerste request zonder sleutel krijgt `401` met `WWW-Authenticate: Basic`; git vraagt de helper (die bij `get` de key inwisselt en alleen een token van 10 minuten geeft, en `store`/`erase` negeert: git bewaart nooit een echt token). `<repo>` is de map waar Vaultgate staat. Let op paden met spaties: in een gitconfig-waarde moeten aanhalingstekens als `\"` staan.
- **gh** (GitHub CLI): niet gebouwd; `gh` laat zich niet eenvoudig naar een andere host voor github.com sturen. Gebruik voorlopig de API via de forward-proxy (zie hierboven) of git.

## 4. Goedkeuring

Elke nieuwe combinatie tool × secret × host geeft een pop-up in de tray (eenmalig / altijd / weigeren; knoppen pas na 1,5 s actief, focus op Weigeren). Geen antwoord binnen 30 s: 401 `approval-timeout`; weigeren: 403 `approval-denied`; geen tray: 503. Claude Code ziet alleen de regelnaam (`x-vault-gate-rule`), nooit een waarde. Toekenningen zijn zichtbaar en intrekbaar in het portaal.

## 5. Waarom (nog) geen MCP-server

Alles wat Claude Code nodig heeft, is een gewone HTTP-request via de proxy; een MCP-server zou dezelfde beslissingen nog eens moeten nemen en een tweede toegangsweg openen. Een MCP-server blijft een optie voor tools die geen base-URL of proxy kunnen instellen; dan krijgt ze dezelfde tool-key en dezelfde beslisregels (geen eigen pad naar de kluis).
