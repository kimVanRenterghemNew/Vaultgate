# Vaultgate MCP server: Streamable HTTP and stdio

Vaultgate includes a Model Context Protocol (MCP) server that lets AI agents (such as Antigravity, Claude Code, Cursor and VS Code) make web requests through Vaultgate with one tool, `http_request`.

Secrets go in as placeholders (such as `{{secret:api_key}}`); Vaultgate fills them in on the way out and scrubs secret values from the response before the agent sees it.

---

## 1. Install from the portal (recommended)

The easiest way to put Vaultgate in your agents is the portal:

1. In the portal, go to **Virtual keys** and click **Create key**.
2. Choose **MCP server** and give the tool a name you will recognise (for example `claude` or `agent`).
3. In step 3, choose **Where**: *All folders* (the agent's user config) or *Specific folder* (for example `<folder>/.mcp.json` for Claude Code).
4. **Agents on this PC** shows one row per agent found on this computer. Click **Install**. Vaultgate writes an entry with `--name <tool>`; the tool key stays protected in your vault and never lands in a config file. Below the row you see where this tool is already installed.
5. **Install skill** adds `SKILL.md` and the policy rule to your agents.
6. After each action the portal shows **"Vaultgate changed these files"**: every file it changed, with its path and where the previous version is (`<file>.vaultgate.bak`). If nothing changed, no message appears.
7. Restart your agent.

### After a Vaultgate update

An entry contains the path to Node, the path to `bin/vaultgate.js` and the version (`VAULTGATE_MCP_VERSION`). After an update:

- the portal refreshes every existing Vaultgate entry, the skill and the policy the first time you unlock after a version change, **only where they already are** (it never adds anything), and shows which files it changed;
- you can do the same yourself with **Update** in the MCP install step;
- a hand-made entry with `url: .../sse` is turned into a stdio entry;
- your agent's own rules file (Claude, `AGENTS.md`) is left alone; it only holds the line that points to the instructions in the vault folder.

A vault that has never stored a version only remembers the current version on its first unlock.

---

## 2. Connect with a direct MCP link (Streamable HTTP and SSE)

While Vaultgate is running (port **8484** by default), the MCP endpoint is here:

```text
http://127.0.0.1:8484/mcp
```

Or tied to a specific registered tool:

```text
http://127.0.0.1:8484/mcp?name=agent
```

In a browser, `http://127.0.0.1:8484/mcp` shows a status page with the active protocols and the registered tools.

**Without `?name=` there is no tool key**: every request then gets `401` with `rule: no-tool-key` (unless `VAULTGATE_TOOL_KEY` is set for the process). `?name=<tool>` only works if that tool's key is stored in `clients/<tool>.key` in the vault folder the proxy runs with (the portal does that on **Install** or **Copy JSON**). The proxy does not know a key from another vault (for example a demo vault started with `--home`): also `401`.

### Manual JSON configuration (for agents the portal cannot install into)

```json
{
  "mcpServers": {
    "vaultgate-agent": {
      "url": "http://127.0.0.1:8484/mcp?name=agent"
    }
  }
}
```

Prefer stdio: **Copy JSON** in the portal gives you the same entry that **Install** writes.

---

## 3. Connect over stdio (no HTTP daemon)

If your agent starts Vaultgate as a subprocess. The `vaultgate` command exists after `npm link` or a global install; otherwise use `node <repo>/bin/vaultgate.js`. Without `--home` it uses the default vault folder, which must be the same one the running proxy uses:

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

## 4. Endpoints and supported protocols

| Route | Method | Protocol | Purpose |
| :--- | :--- | :--- | :--- |
| `/mcp` | `POST` | Streamable HTTP | JSON-RPC for current agents (Antigravity 2.0). Accepts both `application/json` and `text/event-stream`. |
| `/mcp` | `GET` | Discovery / status | Shows a status page in the browser (`text/html`) or JSON metadata. With `Accept: text/event-stream` it starts an SSE stream. |
| `/sse` | `GET` | Legacy SSE | Starts an SSE session for clients that follow the 2024-11-05 spec and returns the postback URL. |
| `/mcp/messages` | `POST` | SSE postback | Handles incoming JSON-RPC messages for an active SSE session. |
