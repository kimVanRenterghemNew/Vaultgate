// Statuspagina voor de MCP-server over HTTP (/mcp).
// Toont serverstatus, protocolversie, endpoints, installatiecommando's en alle beschikbare tools uit TOOLS.
import fs from 'node:fs';

const PAGE_TEMPLATE = fs.readFileSync(new URL('./status-page.html', import.meta.url), 'utf8');
const PAGE_CSS = fs.readFileSync(new URL('./status-page.css', import.meta.url), 'utf8');
const ROW_TEMPLATE = fs.readFileSync(new URL('./status-row.html', import.meta.url), 'utf8');
const PARAM_TEMPLATE = fs.readFileSync(new URL('./status-param.html', import.meta.url), 'utf8');

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Genereert een HTML statuspagina in Dracula-stijl (Tailwind/daisyUI palette).
 * Bevat GEEN gevoelige kluisdata (geen secret-namen, waarden, keys of toekenningen).
 *
 * @param {{ serverInfo: { name: string, version: string }, protocolVersion: string, tools: Array<object>, proxyUrl: string }} params
 * @returns {string} HTML document
 */
export function createMcpStatusHtml({ serverInfo, protocolVersion, tools = [], proxyUrl = 'http://127.0.0.1:8484' }) {
    const cleanProxy = proxyUrl.replace(/\/$/, '');

    const toolRows = tools.map(t => {
        const props = t.inputSchema?.properties || {};
        const required = new Set(t.inputSchema?.required || []);
        const paramsList = Object.entries(props).map(([propName, propDef]) => {
            const isReq = required.has(propName);
            const type = propDef.type || 'any';
            const desc = propDef.description ? ` — ${escapeHtml(propDef.description)}` : '';
            return PARAM_TEMPLATE
                .replaceAll('{{name}}', escapeHtml(propName))
                .replaceAll('{{type}}', escapeHtml(type))
                .replaceAll('{{required}}', isReq ? ', required' : '')
                .replaceAll('{{desc}}', desc);
        }).join('') || 'None';

        return ROW_TEMPLATE
            .replaceAll('{{name}}', escapeHtml(t.name))
            .replaceAll('{{description}}', escapeHtml(t.description))
            .replaceAll('{{params}}', paramsList);
    }).join('\n');

    return PAGE_TEMPLATE
        .replaceAll('{{css}}', PAGE_CSS)
        .replaceAll('{{serverName}}', escapeHtml(serverInfo.name))
        .replaceAll('{{serverVersion}}', escapeHtml(serverInfo.version))
        .replaceAll('{{protocolVersion}}', escapeHtml(protocolVersion))
        .replaceAll('{{cleanProxy}}', escapeHtml(cleanProxy))
        .replaceAll('{{toolsCount}}', String(tools.length))
        .replaceAll('{{toolRows}}', toolRows);
}
