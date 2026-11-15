// Wat de agent naast de inhoud van een HTTP-antwoord ziet: de status en de headers (door de proxy al gescrubd).

const THROUGH_PROXY = /^https?:\/\/[^/]+\/forward\//;

/**
 * `HTTP <status>` en één regel per header. Een `Location` wijst naar de proxy (`<proxy>/forward/<url>`); de agent ziet
 * de echte URL, en vraagt die opnieuw via `http_request`.
 * @param {{ status: number, headers?: { forEach?: (fn: (value: string, name: string) => void) => void } }} res
 */
export function describeResponse(res) {
    const lines = [`HTTP ${res.status}`];
    res.headers?.forEach?.((value, name) => lines.push(`${name}: ${name === 'location' ? value.replace(THROUGH_PROXY, '') : value}`));
    return lines.join('\n');
}
