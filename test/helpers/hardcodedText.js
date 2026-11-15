/**
 * Ingebakken zinnen vinden: elke tekst die een gebruiker leest, komt uit i18n/<taal>.json.
 *  - In een .html-sjabloon: een tekstknoop met letters moet binnen een element met translate="no" staan (code, een
 *    merknaam, een taalnaam); placeholder/title/aria-label met een zin moeten via data-i18n-<attribuut>.
 *  - In browsercode: een string-literal met twee woorden (een zin of een lijst klassen) is verboden, behalve als argument
 *    van `new Error(...)` (een programmeerfout, nooit voor de gebruiker).
 */
import { parse } from 'espree';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'use', 'path', 'circle', 'rect']);
const MUTED = new Set(['script', 'style', 'title', 'symbol']);
const PROSE = /\p{L}{2,}\s+\p{L}{2,}/u;
const LETTER = /\p{L}/u;

/** Tekst in een HTML-sjabloon die niet uit een vertaling komt. */
export function hardcodedInHtml(html) {
    const found = [];
    const stack = []; // per open element: { tag, noTranslate }
    const muted = () => stack.some(e => e.noTranslate || MUTED.has(e.tag));
    for (const token of html.replace(/<!--[\s\S]*?-->/g, '').split(/(<[^>]+>)/)) {
        if (token.startsWith('</')) {
            const tag = token.slice(2, -1).trim().toLowerCase();
            const at = stack.map(e => e.tag).lastIndexOf(tag);
            if (at >= 0) stack.length = at;
        } else if (token.startsWith('<!')) {
            continue;
        } else if (token.startsWith('<')) {
            const tag = /^<([a-zA-Z0-9-]+)/.exec(token)?.[1].toLowerCase();
            if (!tag) continue;
            for (const [, attr, value] of token.matchAll(/\s(placeholder|title|aria-label)="([^"]*)"/g)) {
                if (PROSE.test(value)) found.push(`${attr}="${value}"`);
            }
            if (!VOID.has(tag) && !token.endsWith('/>')) stack.push({ tag, noTranslate: /\stranslate="no"/.test(token) });
        } else if (LETTER.test(token) && !muted()) {
            found.push(token.trim());
        }
    }
    return found;
}

/** String-literals met een zin in browsercode (commentaar telt niet). */
export function hardcodedInJs(source) {
    const found = [];
    const walk = (node, inError) => {
        if (!node || typeof node.type !== 'string') return;
        const below = inError || (node.type === 'NewExpression' && node.callee.name === 'Error');
        if (node.type === 'Literal' && typeof node.value === 'string' && PROSE.test(node.value) && !inError) found.push(node.value);
        if (node.type === 'TemplateElement' && PROSE.test(node.value.cooked ?? '') && !inError) found.push(node.value.cooked);
        for (const child of Object.values(node)) {
            if (Array.isArray(child)) child.forEach(c => walk(c, below));
            else if (child && typeof child === 'object') walk(child, below);
        }
    };
    walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), false);
    return found;
}
