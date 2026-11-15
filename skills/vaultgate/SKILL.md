---
name: vaultgate
description: Veilige webrequests via de Vaultgate proxy met automatische credential-injectie en secret scrubbing.
---

# Vaultgate Werknemers- en Agent-Gids

Deze skill leert AI-agents hoe zij veilig web- en API-requests uitvoeren via Vaultgate zonder ooit secrets, keys of tokens in hun context, prompts of bestanden te zien.

## Kernregel

Een request die een secret nodig heeft, gaat via de vaultgate-tool `http_request` met `{{secret:naam}}`; vraag de gebruiker nooit om een sleutel en zet er nooit een in een bestand, commando of prompt.

## Werkwijze

1. **Wanneer `http_request` gebruiken?**
   Elke externe HTTP-aanroep naar een API of webdienst die authenticatie, API-sleutels, OAuth-tokens of wachtwoorden vereist.

2. **Hoe werkt `{{secret:naam}}`?**
   Plaats de referentie in de headers of payload, bijvoorbeeld:
   `Authorization: Bearer {{secret:github_token}}`
   of
   `x-api-key: {{secret:anthropic_key}}`
   Vaultgate ontgrendelt het geheim pas op het moment van verzending, injecteert de actuele waarde in de uitgaande request naar de toegestane doelhost, en wist (scrubt) eventuele gelekte sleutels automatisch uit de ontvangen respons voordat de agent deze leest.

3. **Wat betekent een weigering?**
   - `target-host-not-allowed`: De doelhost staat niet op de allowlist van deze agent/tool. De gebruiker kan de host toevoegen in het Vaultgate-beheerportaal of als nieuwe toekenning goedkeuren.
   - `tool-key-revoked`: De sleutel voor deze agent is ingetrokken.
   - `approval-rejected` / `approval-timeout`: De aanvraag vereist een interactieve goedkeuring (pop-up in de taakbalk of hardware FIDO2-aanraking) en werd niet bevestigd.

<!-- tools:start -->
## Beschikbare MCP-Tools

De volgende tools zijn beschikbaar via de Vaultgate MCP-server:

### `http_request`

Execute an HTTP request through Vaultgate with credential injection and secret scrubbing.

| Parameter | Type | Verplicht | Beschrijving |
| :--- | :--- | :--- | :--- |
| `url` | `string` | **Ja** | Target URL (e.g. https://api.github.com/...) |
| `method` | `string` | Nee | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `headers` | `object` | Nee | HTTP headers; supports placeholders like {{secret:name}} |
| `body` | `string` | Nee | Request payload text |

<!-- tools:end -->
