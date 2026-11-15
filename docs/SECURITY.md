# Vaultgate security overview

The full explanation, with every technique in the design and what is not covered, is on the website: **[How Vaultgate is secured](https://vaultgate.github.io/Vaultgate/security.html)**. The longer technical reference is [Security Architecture & Threat Model](./security-architecture.md).

## In short

- **The agent never holds the key.** It sends a placeholder (`{{secret:github_token}}`) and a virtual key of its own. Vaultgate fills in the real value for one request, on a domain you allowed.
- **Closed by default.** One decision table, first rule wins; every refusal carries the name of its rule and happens before the secret is decrypted.
- **Nothing readable on disk.** libsodium (XChaCha20-Poly1305), a key per record, each field bound to its record; passkeys with the PRF extension open the vault.
- **The log comes first.** A decision is written to the encrypted log before anything is decrypted; if the log cannot be written, nothing goes out.
- **A touch, not a click.** Anything that lasts longer than one request needs a touch of your passkey.
- **The real site.** The TLS chain is checked during the handshake; a new root you do not trust stops the request.

## Check it yourself

```bash
npm test          # every rule has a test with a request it must refuse
npm run attack    # the real process, fake secrets, every attack in the bench
```

Today the bench has **24 attacks: 21 blocked by a named rule, 3 open**, each with its reason, and no secret in any output:

- Reading another tool's key file and posing as that tool: on Windows the file is protected against other accounts, not against a program running as you. macOS and Linux follow.
- Changing the installed files: the vault notices when it opens; a signed release and an install folder you cannot write to come with the release.
- Reading the memory of an open vault: not covered. Auto-lock and wiped buffers keep the window small.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md) at the root of this repository.
