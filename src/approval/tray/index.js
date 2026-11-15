// Notifier via de tray-app (Windows): de vraag gaat over het tray-protocol (src/tray-link). Zonder verbonden
// tray antwoordt het protocol meteen 'unavailable'.
export function createTrayNotifier({ trayLink }) {
    return Object.freeze({ ask: question => trayLink.ask(question) });
}
