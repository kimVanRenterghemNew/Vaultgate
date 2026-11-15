# Vaultgate MCP Server: Zero-Config HTTP & Stdio

Vaultgate biedt een Model Context Protocol (MCP) server waarmee AI-agents (zoals Antigravity, Claude Code, Cursor en VS Code) veilige webrequests kunnen uitvoeren via Vaultgate (`http_request`).

Geheimen worden veilig geïnjecteerd via plaatshouders (zoals `{{secret:api_key}}`) en gevoelige waarden worden automatisch gescrubd uit het antwoord vóórdat de agent het resultaat te zien krijgt.

---

## 1. Installeren via het Beheerportaal (Aanbevolen)

De eenvoudigste manier om Vaultgate in je AI-agents in te stellen is via het beheerportaal:

1. Ga in het portaal naar **Virtual keys** en klik op **Create key**.
2. Kies **MCP server** en geef je tool een herkenbare naam (bijv. `claude` of `agent`).
3. In stap 3 kies je **Waar**: *Alle mappen* (de gebruikersconfig van de agent) of *Eén map* (bv. `<map>/.mcp.json` voor Claude Code).
4. Onder **Agents op deze pc** staat één rij per gevonden agent. Klik op **Installeren**. Vaultgate zet de entry met `--name <tool>`; de tool-key blijft beschermd in je kluis en komt nooit in een configbestand. Onder de rij zie je waar deze tool al staat.
5. **Skill installeren** zet `SKILL.md` en de policy-regel in je agents.
6. Na elke actie toont het portaal **"Vaultgate paste deze bestanden aan"**: elk aangepast bestand met het pad, en waar de vorige versie staat (`<bestand>.vaultgate.bak`). Veranderde er niets, dan verschijnt er geen melding.
7. Herstart je agent.

### Na een update van Vaultgate

Een entry bevat het pad naar Node, naar `bin/vaultgate.js` en de versie (`VAULTGATE_MCP_VERSION`). Na een update:

- ververst het portaal bij de eerste ontgrendeling na een versiewissel vanzelf alle bestaande vaultgate-entries, de skill en de policy, **alleen waar ze al staan** (er komt nooit iets bij), en toont welke bestanden het aanpaste;
- kan je dat ook zelf doen met **Bijwerken** in de MCP-installatie;
- wordt een handgemaakte entry met `url: .../sse` omgezet naar een stdio-entry;
- blijft een eigen regelbestand van je agent (Claude, `AGENTS.md`) ongemoeid (daar staat alleen de verwijsregel naar de instructies in de kluismap).

Een kluis die nog nooit een versie bewaarde, onthoudt bij de eerste ontgrendeling alleen de versie.

---

## 2. Koppelen via Directe MCP Link (Streamable HTTP & SSE)

Wanneer de Vaultgate-server draait (standaard op poort **8484**), is het MCP-endpoint direct bereikbaar:

```text
http://127.0.0.1:8484/mcp
```

Of gekoppeld aan een specifieke geregistreerde tool:
```text
http://127.0.0.1:8484/mcp?name=agent
```

In je browser toont `http://127.0.0.1:8484/mcp` een interactieve statuspagina met actieve protocollen en geregistreerde tools.

**Zonder `?name=` is er geen tool-key**: elke request krijgt dan `401` met `rule: no-tool-key` (tenzij `VAULTGATE_TOOL_KEY` gezet is voor het proces). `?name=<tool>` werkt alleen als de key van die tool bewaard is in `clients/<tool>.key` van de kluismap waarmee de proxy draait (dat doet het portaal bij **Installeren** of **JSON kopiëren**). Een key van een andere kluis (bv. een demo-kluis met `--home`) kent de proxy niet: ook `401`.

### Handmatige JSON-configuratie (voor agents zonder automatisch installatiedoel)
```json
{
  "mcpServers": {
    "vaultgate-agent": {
      "url": "http://127.0.0.1:8484/mcp?name=agent"
    }
  }
}
```
Liever stdio: **JSON kopiëren** in het portaal geeft de entry die ook **Installeren** schrijft.

---

## 3. Koppelen via Stdio (Zonder HTTP-daemon)

Als je agent Vaultgate direct als subproces opstart (het commando `vaultgate` bestaat na `npm link` of een globale installatie; anders `node <repo>/bin/vaultgate.js`). Zonder `--home` gebruikt het de standaard kluismap; die moet dezelfde zijn als die van de draaiende proxy:

```json
{
  "mcpServers": {
    "vaultgate": {
      "command": "vaultgate",
      "args": [
        "mcp",
        "--name",
        "agent"
      ]
    }
  }
}
```

---

## 4. Endpoints & Ondersteunde Protocollen

| Route | Methode | Protocol | Doel |
| :--- | :--- | :--- | :--- |
| `/mcp` | `POST` | Streamable HTTP | JSON-RPC interactie voor moderne agents (Antigravity 2.0). Ondersteunt zowel `application/json` als `text/event-stream`. |
| `/mcp` | `GET` | Discovery / Status | Toont een overzichtelijke statuspagina in de browser (`text/html`) of JSON metadata. Bij `Accept: text/event-stream` start een SSE-stroom. |
| `/sse` | `GET` | Legacy SSE | Start een SSE-sessie voor clients volgens spec 2024-11-05 en retourneert de postback URL. |
| `/mcp/messages` | `POST` | SSE Postback | Verwerkt inkomende JSON-RPC berichten voor een actieve SSE-sessie. |
