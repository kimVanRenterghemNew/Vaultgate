// Vaste tabel weigerregel -> zin in gewone taal (Engels) voor antwoorden naar tools.
// Beveiligingsregel: noemt alleen tool, secret en host, nooit een geheime waarde of interne toestand.

/**
 * @type {Readonly<Record<string, (ctx: { tool?: string, secret?: string, host?: string, detail?: string }) => string>>}
 */
export const DENY_SENTENCES = Object.freeze({
    'vault-locked': () => 'approval-timeout',
    'approval-timeout': () => 'approval-timeout',
    'no-tool-key': () => 'A valid tool key is required in x-vault-gate-tool-key, Authorization, or Proxy-Authorization.',
    'tool-key-revoked': ctx => (ctx.tool ? `Tool key for "${ctx.tool}" has been revoked; reconnect or create a new key in the portal.` : 'Tool key has been revoked; reconnect or create a new key in the portal.'),
    'token-required': ctx => (ctx.tool ? `A session token is required for "${ctx.tool}"; exchange your key at /device/exchange.` : 'A session token is required for this tool; exchange your key at /device/exchange.'),
    'mcp-tool-required': () => 'This virtual key is configured for MCP only; use it via the MCP server.',
    'web-tool-required': () => 'This virtual key is configured for direct web requests only; use an MCP key for MCP.',
    'client-not-allowed': ctx => (ctx.tool ? `Client IP address is not allowed for "${ctx.tool}"; update allowed clients in the portal.` : 'Client IP address is not allowed for this tool; update allowed clients in the portal.'),
    'no-placeholder': () => 'Request does not contain any {{secret:...}} placeholder.',
    'unknown-secret': ctx => (ctx.secret ? `Secret "${ctx.secret}" is not defined in the vault; add it in the portal (Secrets).` : 'Secret is not defined in the vault; add it in the portal (Secrets).'),
    'bad-target': ctx => (ctx.host ? `Target path for ${ctx.host} contains ambiguous or encoded traversals not permitted for this host.` : 'Target path contains ambiguous or encoded traversals not permitted for this host.'),
    'target-host-not-allowed': ctx => {
        const secret = ctx.secret ?? 'secret';
        const host = ctx.host ?? 'target host';
        return `${secret} is not allowed to be sent to ${host}; add the host to the secret in the portal (Secrets) if intended.`;
    },
    'placeholder-location-not-allowed': ctx => (ctx.secret ? `Secret "${ctx.secret}" is not allowed in this location${ctx.detail ? ` (${ctx.detail})` : ''}; update allowed injection places in the portal.` : 'Secret is not allowed in this location; update allowed injection places in the portal.'),
    'quiet-hours': () => 'Requests are blocked during quiet hours configured in policy.',
    'grant-blocked': ctx => (ctx.secret && ctx.host ? `Access to "${ctx.secret}" on "${ctx.host}" is currently blocked by an active policy rule.` : 'Access is currently blocked by an active policy rule.'),
    'secret-blocked': ctx => (ctx.secret ? `Secret "${ctx.secret}" is currently blocked by an active policy rule.` : 'Secret is currently blocked by an active policy rule.'),
    'tool-blocked': ctx => (ctx.tool ? `Tool "${ctx.tool}" is currently blocked by an active policy rule.` : 'Tool is currently blocked by an active policy rule.'),
    'approval-denied': ctx => (ctx.secret && ctx.host ? `Approval was denied for "${ctx.secret}" to ${ctx.host}.` : 'Approval was denied by the user.'),
    'approval-unavailable': () => 'Approval could not be requested because the approval interface (tray) is not running.',
    'approval-invalid-answer': () => 'Approval request received an invalid response.',
    'touch-denied': () => 'Passkey touch confirmation was denied.',
    'touch-timeout': () => 'Passkey touch confirmation timed out.',
    'touch-unavailable': () => 'Passkey touch confirmation is required but unavailable.',
    'subdomain-denied': ctx => (ctx.host ? `Access to new subdomain ${ctx.host} was denied.` : 'Access to the new subdomain was denied.'),
    'auth-shape-changed': ctx => (ctx.tool ? `Authorization format changed for "${ctx.tool}"; approval is required.` : 'Authorization format changed; approval is required.'),
    'unknown-route': () => 'Route not found for reverse proxy request.',
    'tunnel-not-supported': () => 'CONNECT tunneling is not supported by Vaultgate.',
    'audit-unavailable': () => 'Audit log could not be written; request blocked for security.',
    'upstream-error': () => 'The target host could not be reached.',
    'tls-untrusted': () => 'The TLS certificate of the target host is not trusted; review certificates in the portal.',
    'tls-chain-changed': ctx => (ctx.host ? `The TLS certificate chain for ${ctx.host} has changed; review certificates in the portal.` : 'The TLS certificate chain of the target host has changed; review certificates in the portal.'),
    'unsupported-encoding': ctx => (ctx.detail ? `Cannot scrub response with unsupported content encoding (${ctx.detail}).` : 'Cannot scrub response with unsupported content encoding.'),
    'throttled': () => 'Too many failed requests; caller is temporarily throttled.',
    'ssrf-target-blocked': ctx => (ctx.host ? `Target "${ctx.host}" resolves to a prohibited IP address (cloud metadata or loopback).` : 'Target resolves to a prohibited IP address.'),
    'internal-error': () => 'Internal proxy error occurred.',
    'needs-approval': () => 'Approval is required for this request.',
    'grant-expired': () => 'The grant for this request has expired and requires renewal.',
});

/**
 * Geeft een leesbare foutboodschap in gewone taal (Engels) voor een weigerregel.
 * @param {string} rule
 * @param {{ tool?: string, secret?: string, host?: string, detail?: string }} [ctx]
 * @returns {string}
 */
export function denyMessage(rule, ctx = {}) {
    const fn = DENY_SENTENCES[rule];
    return fn ? fn(ctx) : rule;
}
