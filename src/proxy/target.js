function parseUrl(text) {
    const fixed = text.replace(/^(https?):\/(?!\/)/i, '$1://');
    try {
        const url = new URL(fixed);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

export async function parseTarget(req, routes) {
    if (/^https?:\/\//i.test(req.url)) {
        const target = parseUrl(req.url);
        return target ? { mode: 'forward', target } : { rule: 'bad-target' };
    }
    if (req.url.startsWith('/forward/')) {
        const target = parseUrl(req.url.slice('/forward/'.length));
        return target ? { mode: 'forward', target } : { rule: 'bad-target' };
    }
    const match = /^\/([a-z0-9-]+)(\/.*)?$/.exec(req.url.split('?')[0]);
    const route = match && (await routes()).find(r => r.name === match[1]);
    if (!route) return { rule: 'unknown-route' };
    const rest = req.url.slice(route.name.length + 1) || '/';
    const target = new URL(route.base.replace(/\/$/, '') + rest);
    return { mode: 'reverse', target, route };
}
