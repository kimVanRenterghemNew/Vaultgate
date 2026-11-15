// Nep-tray voor tests: spreekt hetzelfde protocol als src/tray-link/windows-tray.ps1. Leest { pipe, token } van stdin,
// meldt zich, schrijft elk ontvangen bericht als JSON-regel naar stdout, en gedraagt zich volgens omgevingsvariabelen:
//   FAKE_TRAY_ANSWER   antwoord op elke vraag: once | always | deny | timeout | never (standaard never); een lijst
//                      (`once,deny`) geeft de antwoorden na elkaar, het laatste blijft gelden
//   FAKE_TRAY_TOKEN    stuur dit token in plaats van het echte (om een fout token te testen)
//   FAKE_TRAY_LOCK_ON_UNLOCKED=1  stuur "lock" zodra een toestand "ontgrendeld" binnenkomt
//   FAKE_TRAY_OPEN_PORTAL=1       stuur meteen na hello "open-portal" (menu "Portaal openen")
//   FAKE_TRAY_LOG      schrijf elke vraag en melding ook als JSON-regel naar dit bestand
//   FAKE_TRAY_RELEASE  pad: antwoord op de n-de vraag (vanaf 1) pas zodra het bestand `<pad>.<n>` bestaat
//   FAKE_TRAY_SEND     pad: zodra het bestand `<pad>.lock` of `<pad>.logout` bestaat, stuur dat bericht (menu "Lock now" of
//                      "Log out") en wis het bestand
import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });
const [first] = await new Promise(resolve => { const lines = []; input.on('line', l => { lines.push(l); resolve(lines); }); });
input.close();
const { pipe, token } = JSON.parse(first);

const socket = net.connect(pipe);
const send = msg => socket.write(`${JSON.stringify(msg)}\n`);
socket.on('connect', () => {
    send({ type: 'hello', token: process.env.FAKE_TRAY_TOKEN ?? token });
    if (process.env.FAKE_TRAY_OPEN_PORTAL === '1') send({ type: 'open-portal' });
});
if (process.env.FAKE_TRAY_SEND) {
    setInterval(() => {
        for (const type of ['lock', 'logout']) {
            const file = `${process.env.FAKE_TRAY_SEND}.${type}`;
            if (fs.existsSync(file)) { fs.rmSync(file); send({ type }); }
        }
    }, 20).unref();
}
socket.on('error', () => process.exit(2));
socket.on('close', () => process.exit(0));

let buffer = '';
let asked = 0;
/** Zonder FAKE_TRAY_RELEASE meteen; anders zodra de test het bestand van deze vraag aanmaakt. */
function whenReleased(n, fn) {
    if (!process.env.FAKE_TRAY_RELEASE) return fn();
    const file = `${process.env.FAKE_TRAY_RELEASE}.${n}`;
    const poll = setInterval(() => { if (fs.existsSync(file)) { clearInterval(poll); fn(); } }, 20);
    return undefined;
}
socket.setEncoding('utf8');
socket.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        process.stdout.write(`${JSON.stringify(msg)}\n`);
        if (process.env.FAKE_TRAY_LOG && (msg.type === 'ask' || msg.type === 'notify')) fs.appendFileSync(process.env.FAKE_TRAY_LOG, `${JSON.stringify(msg)}\n`); // vragen en meldingen, voor de test
        if (msg.type === 'ask') {
            const answers = (process.env.FAKE_TRAY_ANSWER ?? 'never').split(',');
            const answer = answers[Math.min(asked++, answers.length - 1)];
            if (answer !== 'never') whenReleased(asked, () => send({ type: 'answer', id: msg.id, answer }));
        }
        if (msg.type === 'state' && msg.locked === false && process.env.FAKE_TRAY_LOCK_ON_UNLOCKED === '1') send({ type: 'lock' });
    }
});
