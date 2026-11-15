// MCP-tools en hun JSON Schema specificaties.
// Strikte clients (VS Code, Copilot) weigeren tools met ongeldige of te complexe schema's
// (zoals ontbrekende items bij array, ontbrekende types, of oneOf/anyOf/allOf/$ref combinators).

const COMBINATORS = ['oneOf', 'anyOf', 'allOf', 'not', '$ref'];

export const HTTP_REQUEST_TOOL = Object.freeze({
    name: 'http_request',
    description: 'Execute an HTTP request through Vaultgate with credential injection and secret scrubbing.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL (e.g. https://api.github.com/...)' },
            method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE, etc.)', default: 'GET' },
            headers: { type: 'object', description: 'HTTP headers; supports placeholders like {{secret:name}}', additionalProperties: { type: 'string' } },
            body: { type: 'string', description: 'Request payload text' },
        },
        required: ['url'],
    },
});

export const TOOLS = Object.freeze([HTTP_REQUEST_TOOL]);

/** Vindt alle schemadefecten in een schema node conform strikte MCP client eisen. */
export function schemaProblems(node, where = 'root') {
    if (node === null || typeof node !== 'object') return [];
    const found = [];
    for (const key of COMBINATORS) {
        if (key in node) found.push(`${where}: '${key}' is not accepted by every client`);
    }
    if (!node.type && !COMBINATORS.some(key => key in node)) {
        found.push(`${where}: no type`);
    }
    if (node.type === 'array') {
        if (!node.items || typeof node.items !== 'object') {
            found.push(`${where}: array without items`);
        } else if (!node.items.type) {
            found.push(`${where}.items: no type`);
        }
    }
    if (node.type === 'object' && node.properties) {
        for (const [name, child] of Object.entries(node.properties)) {
            found.push(...schemaProblems(child, `${where}.${name}`));
        }
    }
    if (node.items) {
        found.push(...schemaProblems(node.items, `${where}.items`));
    }
    if (node.required && !Array.isArray(node.required)) {
        found.push(`${where}: required must be a list`);
    }
    for (const name of node.required || []) {
        if (!node.properties || !(name in node.properties)) {
            found.push(`${where}: required '${name}' is not a property`);
        }
    }
    return found;
}

/** Valideert een MCP-tool definitie. Geeft een lijst van problemen terug (leeg = geldig). */
export function validateToolSchema(tool) {
    if (!tool || typeof tool !== 'object') return ['tool must be an object'];
    if (!tool.name || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) return [`${tool.name || 'unnamed'}: invalid tool name`];
    if (!tool.description) return [`${tool.name}: missing description`];
    const schema = tool.inputSchema || tool.parameters;
    if (!schema || schema.type !== 'object') return [`${tool.name}: inputSchema must be an object schema`];
    return schemaProblems(schema, tool.name);
}
