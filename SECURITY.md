# Security Policy

## Reporting a Vulnerability

You can report security findings, improvements, or exploit vectors through any of the following channels:
- **GitHub Issues / Tickets:** Open an issue or ticket directly in this repository.
- **Pull Requests (PR):** Submit a PR with a patch or test reproducing the issue.
- **GitHub Private Vulnerability Reporting:** Use GitHub's private vulnerability advisory workflow on this repository.
- **Email:** Send details directly to `security@vaultgate.dev` or use GitHub Security Advisories.

Please include (where applicable):
- A description of the vulnerability and attack scenario.
- Steps to reproduce or proof-of-concept code (e.g., an automated test or curl command).
- The affected component (e.g., daemon, proxy, vault storage, tray approval, TLS verification).
- Any potential impact on secret confidentiality or integrity.

We acknowledge receipt of reports within 48 hours and welcome community reviews and contributions.

---

## Security Architecture & Threat Model

Vaultgate is built upon a fail-closed, zero-knowledge architecture designed specifically to guard secrets against compromised AI agents, prompt injection, and untrusted local scripts.

Every technique in the design, the attack bench (24 attacks, 21 blocked, 3 open with their reason) and what is not covered: **[How Vaultgate is secured](https://vaultgate.github.io/Vaultgate/security.html)**.

The longer technical reference: **[Security Architecture & Threat Model](docs/security-architecture.md)**.
