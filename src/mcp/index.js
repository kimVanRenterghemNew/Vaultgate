// MCP-server over stdio: agents voeren webrequests uit via Vaultgate.
// De server ontvangt JSON-RPC 2.0 op stdin en antwoordt op stdout.
// Requests worden doorgestuurd naar de Vaultgate-proxy (/forward/<url>),
// waardoor de volledige proxy-pijplijn (tool-key, allowlists, injectie, scrubbing) wordt hergebruikt.
import readline from 'node:readline';
import fs from 'node:fs';
import { readSavedKey, keyProtector } from '../device/index.js';
import { describeResponse } from './response.js';
import { SERVER_INFO, MCP_PROTOCOL_VERSION } from './server-info.js';
import { TOOLS } from './tools.js';
import { createMcpHttpHandler } from './http-handler.js';

export { agentTargets, mcpEntry, runAgentInstall, renameMcpTool, packageVersion, SERVER_NAME } from './install.js';
export { refreshMcpInstallations } from './refresh.js';
export { createMcpRegistry, checkGitExclude } from './registry.js';
export {
    policyTargets,
    skillTargets,
    runSkillAndPolicyInstall,
    installPolicy,
    uninstallPolicy,
    installSkill,
    uninstallSkill,
    withoutLink,
    withLink,
    MARK,
    POLICY_RULE,
} from './policy-install.js';
export { createMcpStatusHtml } from './status-page.js';
export { SERVER_INFO, MCP_PROTOCOL_VERSION } from './server-info.js';
export { HTTP_REQUEST_TOOL, TOOLS, validateToolSchema, schemaProblems } from './tools.js';
export { MCP_PATHS, isMcpPath } from './http-handler.js';

/** Voert de HTTP-aanroep uit via de Vaultgate forward-proxy. */
async function callProxy({ proxyUrl, toolKey, args = {}, fetchFn = fetch }) {
    const { url, method = 'GET', headers = {}, body } = args;
    if (!url || typeof url !== 'string') {
        return { content: [{ type: 'text', text: 'Missing required argument: url' }], isError: true };
    }
    const forwardUrl = `${proxyUrl.replace(/\/$/, '')}/forward/${url}`;
    const reqHeaders = { ...headers, 'x-vault-gate-tool-key': toolKey, 'x-vault-gate-protocol': 'mcp' };
    const upperMethod = method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(upperMethod) && body !== undefined;

    try {
        const res = await fetchFn(forwardUrl, {
            method: upperMethod,
            headers: reqHeaders,
            body: hasBody ? String(body) : undefined,
            redirect: 'manual',
        });
        const text = await res.text();
        const rule = res.headers?.get?.('x-vault-gate-rule');
        const isError = res.status >= 400;
        const contentText = isError && !text && rule ? `Request failed: ${rule} (status ${res.status})` : text;
        return { content: [{ type: 'text', text: contentText }, { type: 'text', text: describeResponse(res) }], isError };
    } catch (error) {
        return { content: [{ type: 'text', text: `Proxy connection error: ${error.message}` }], isError: true };
    }
}

/** Verwerkt een enkel JSON-RPC 2.0 verzoek. */
export async function handleRpcRequest(msg, { proxyUrl, toolKey, fetchFn = fetch }) {
    if (!msg || typeof msg !== 'object') {
        return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { id, method, params } = msg;

    if (method === 'initialize') {
        const clientVersion = params?.protocolVersion || MCP_PROTOCOL_VERSION;
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: clientVersion,
                capabilities: { tools: {} },
                serverInfo: SERVER_INFO,
            },
        };
    }
    if (method === 'notifications/initialized') {
        return null; // Geen antwoord op notificaties
    }
    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }
    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }
    if (method === 'tools/call') {
        if (params?.name !== 'http_request') {
            return {
                jsonrpc: '2.0',
                id,
                result: { content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }], isError: true },
            };
        }
        const outcome = await callProxy({ proxyUrl, toolKey, args: params.arguments, fetchFn });
        return { jsonrpc: '2.0', id, result: outcome };
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

/** Start de MCP JSON-RPC loop over stdio. */
export function runMcpStdio({ toolKey, proxyUrl, input = process.stdin, output = process.stdout, fetchFn = fetch }) {
    const rl = readline.createInterface({ input, terminal: false });
    return new Promise(resolve => {
        let pending = Promise.resolve();
        rl.on('line', line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            pending = pending.then(async () => {
                let msg;
                try {
                    msg = JSON.parse(trimmed);
                } catch {
                    output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
                    return;
                }
                const response = await handleRpcRequest(msg, { proxyUrl, toolKey, fetchFn });
                if (response !== null) {
                    output.write(`${JSON.stringify(response)}\n`);
                }
            });
        });
        rl.on('close', () => {
            pending.then(resolve);
        });
    });
}

/** CLI entrypoint voor `node src/main.js mcp`. */
export async function runMcpCli({ opts, home, env = process.env, t = k => k, input = process.stdin, output = process.stdout, stderr = process.stderr, fetchFn = fetch }) {
    let toolKey = env.VAULTGATE_TOOL_KEY || opts.key || null;
    if (!toolKey && opts.name) {
        try {
            toolKey = readSavedKey({ home, name: opts.name, readFile: f => fs.readFileSync(f, 'utf8'), protector: keyProtector(), t });
        } catch (error) {
            stderr.write(`${error.message}\n`);
            process.exit(1);
        }
    }
    if (!toolKey) {
        stderr.write('Vaultgate MCP: no tool key provided. Set VAULTGATE_TOOL_KEY or pass --name <tool> or --key <key>.\n');
        process.exit(1);
    }
    await runMcpStdio({ toolKey, proxyUrl: opts.proxy || 'http://127.0.0.1:8484', input, output, fetchFn });
}

export function createMcpHttpHandlerWrapped(options = {}) {
    return createMcpHttpHandler({ handleRpcRequest, ...options });
}
export { createMcpHttpHandlerWrapped as createMcpHttpHandler };
