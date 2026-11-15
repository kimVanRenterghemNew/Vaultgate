/**
 * Nep-doelserver (de "nep-API" uit de journey-tests): onthoudt elke request (methode, url, headers, body) en antwoordt
 * met wat de test opgeeft. Luistert op 127.0.0.1 met een willekeurige poort.
 */
import http from 'node:http';

export async function startUpstream(handler = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
            requests.push(record);
            handler(req, res, record);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        origin: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
    };
}
