// De `Location` van een redirect, herschreven zodat de client terug via de proxy gaat.

/**
 * Redirects volgt de proxy nooit. Hij herschrijft `Location` zodat een client die de redirect volgt, terug
 * via de proxy gaat: daar beslist de allowlist opnieuw, en de tool-key gaat niet rechtstreeks naar een vreemde host.
 */
export function throughProxy(location, target, route, req) {
    let resolved;
    try { resolved = new URL(location, target); } catch { return location; }
    const self = `http://${req.headers.host ?? 'localhost'}`;
    if (route && resolved.href.startsWith(route.base.replace(/\/$/, '') + '/')) return `${self}/${route.name}${resolved.href.slice(route.base.replace(/\/$/, '').length)}`;
    return `${self}/forward/${resolved.href}`;
}
