// Of de proxy een redirect volgt (alleen voor MCP-requests), en met of zonder de ingevulde secrets.
// Binnen de oorspronkelijke origin: met secrets (dezelfde toekenning). Zodra de keten een andere origin raakt: nooit
// meer secrets, ook niet als hij terugkomt (zoals fetch `Authorization` laat vallen na een cross-origin redirect).
import { decide } from '../decision/index.js';
import { isLoopback } from '../policy/index.js';

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const isLoopbackHost = url => url.hostname === 'localhost' || isLoopback(url.hostname.replace(/^\[|\]$/g, ''));

export const REDIRECT_RULES = Object.freeze([
    // Geen redirect, of een die het antwoord gewoon doorgeeft: een body kan niet opnieuw verstuurd worden.
    { name: 'redirect-relay', when: c => !c.follow || !REDIRECT_STATUS.has(c.status) || !c.next || !['GET', 'HEAD'].includes(c.method), then: { follow: false } },
    { name: 'too-many-redirects', when: c => c.hops >= MAX_REDIRECTS, then: { follow: false, deny: true, status: 502 } },
    { name: 'redirect-downgrade', when: c => !['http:', 'https:'].includes(c.next.protocol) || (c.current.protocol === 'https:' && c.next.protocol !== 'https:'), then: { follow: false, deny: true, status: 502 } },
    // Een externe host mag de proxy niet naar een lokale dienst (het portaal, ...) sturen.
    { name: 'ssrf-target-blocked', when: c => isLoopbackHost(c.next) && !isLoopbackHost(c.original), then: { follow: false, deny: true, status: 403 } },
    { name: 'redirect-with-secrets', when: c => c.withSecrets && c.next.origin === c.original.origin, then: { follow: true, secrets: true } },
    { name: 'redirect-without-secrets', when: () => true, then: { follow: true, secrets: false } },
]);

/**
 * @param {{ follow: boolean, status: number, location?: string, method: string, current: URL, original: URL, hops: number, withSecrets: boolean }} ctx
 * @returns {{ follow: boolean, secrets?: boolean, deny?: boolean, status?: number, rule: string, next: URL | null }}
 */
export function redirectStep(ctx) {
    const next = URL.canParse(ctx.location ?? '', ctx.current) && ctx.location ? new URL(ctx.location, ctx.current) : null;
    return { ...decide({ ...ctx, next }, REDIRECT_RULES), next };
}
