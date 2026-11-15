// Device flow in het portaal: wachtende koppelingen zien en beslissen (beslissen alleen met een ontgrendelde kluis).
// Goedkeuren vraagt een aanraking; het portaal krijgt het id terug en vraagt de passkey zelf (geen tweede venster).
// Deel van het portaal (index.js).

/**
 * @param {{ device: object|null, log: Function }} deps
 * @returns {Array} routes in de vorm van het portaal: [methode, pad-regex, auth, handler]
 */
export function deviceRoutes({ device, log }) {
    return [
        ['GET', /^\/api\/device$/, 'session', () => (device ? device.pending() : [])],
        ['POST', /^\/api\/device\/([0-9a-f]+)\/verify$/, 'unlocked', ({ body, match }) => device.verifyCode(match[1], body.code)],
        ['POST', /^\/api\/device\/([0-9a-f]+)\/approve$/, 'unlocked', async ({ match }) => {
            let opened;
            const touchId = new Promise(resolve => { opened = resolve; });
            const result = device.approve(match[1], { openTouch: opened, requireCode: true });
            const first = await Promise.race([result.then(r => ({ result: r })), touchId.then(id => ({ touch: id }))]);
            if (first.touch) {
                result.then(r => log({ event: 'device-approve-result', ...('approved' in r ? { approved: true } : { denied: r.denied ?? 'pending' }) }), () => {});
                return { touch: first.touch };
            }
            return first.result;
        }],
        ['POST', /^\/api\/device\/([0-9a-f]+)\/deny$/, 'session', async ({ match }) => { await device.deny(match[1]); return { denied: true }; }],
    ];
}
