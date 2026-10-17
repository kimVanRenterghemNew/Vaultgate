# Security Policy

## Reporting a Vulnerability

You can report security findings, improvements, or exploit vectors through any of the following channels:
- **GitHub Issues / Tickets:** Open an issue or ticket directly in this repository.
- **Pull Requests (PR):** Submit a PR with a patch or test reproducing the issue.
- **GitHub Private Vulnerability Reporting:** Use GitHub's private vulnerability advisory workflow on this repository.
- **Email:** Send details directly to `kim.van.renterghem@gmail.com`.

Please include (where applicable):
- A description of the vulnerability and attack scenario.
- Steps to reproduce or proof-of-concept code (e.g., an automated test or curl command).
- The affected component (e.g., daemon, proxy, vault storage, tray approval, TLS verification).
- Any potential impact on secret confidentiality or integrity.

We acknowledge receipt of reports within 48 hours and welcome community reviews and contributions.

---

## Security Architecture & Threat Model

Vaultgate is built upon a fail-closed, zero-knowledge architecture designed specifically to guard secrets against compromised AI agents, prompt injection, and untrusted local scripts.

For detailed technical documentation on how Vaultgate ensures maximum security, including the 22-vector attack bench, cryptographic key hierarchy, FIDO2 PRF derivation, and real-time response scrubbing, please refer to:

👉 **[Vaultgate Security Architecture & Technical Threat Model](docs/security-architecture.md)**
