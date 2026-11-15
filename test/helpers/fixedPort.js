/**
 * A port for a listener that the product binds by number (an extra listen address), picked BELOW the ephemeral range
 * (Windows 49152+, Linux 32768+). A port picked with listen(0) and closed again can be handed to another process's
 * listen(0) before the product binds it; and a proxy holding 127.0.0.1:X does not stop another process binding
 * <lan>:X. Both made journeys flaky. No listen(0) anywhere hands out a port from this range.
 */
import net from 'node:net';
import crypto from 'node:crypto';

const LOW = 20_000;
const HIGH = 32_000;

const canBind = (port, host) => new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
});

/** A port in [20000, 32000) that is free right now on every host in `hosts`. */
export async function fixedPort(hosts = ['127.0.0.1']) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const port = crypto.randomInt(LOW, HIGH);
        if ((await Promise.all(hosts.map(h => canBind(port, h)))).every(Boolean)) return port;
    }
    throw new Error(`no free port in [${LOW}, ${HIGH}) on ${hosts.join(', ')}`);
}
