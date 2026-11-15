// De uitwisseling aan de proxy-kant (`POST /device/exchange`, op de proxy-poort, niet het portaal): de helper van een tool
// biedt haar lange sleutel aan en krijgt een token van 10 minuten en een nieuwe lange sleutel (de registry beslist,
// key-rotation.js). Hier: de gesloten kluis (wachten, dan hetzelfde antwoord als een uitgebleven goedkeuring), de audit
// (elke uitwisseling, fail-closed; de tray-melding volgt uit die beheerregel, src/audit/notify.js), de aanraking
// "opnieuw vragen elke N uur" en het alarm bij hergebruik. Deel van de proxy (index.js). Nooit een sleutel of token in
// een log, audit of melding.
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @param {{ vault, registry, audit, touch?: { confirm: Function }, notify: (n: { title, text }) => void, translate: Function,
 *           closedWaitMs: () => number, log: (e: object) => void }} deps
 * @returns {(input: { key: unknown, client: string }) => Promise<{ status: number, rule: string, body: object }>}
 */
export function createKeyExchange({ vault, registry, audit, touch = null, notify = () => {}, translate: t = k => k, closedWaitMs, log = () => {} }) {
    const refuse = (status, rule) => ({ status, rule, body: { error: rule, rule } });

    async function closed() {
        log({ event: 'key-exchange', rule: 'vault-locked' });
        await delay(closedWaitMs());
        return refuse(401, 'approval-timeout');
    }

    const confirm = tool => (touch ? touch.confirm({ tool: tool.name, secret: '', host: '', method: '', path: '', reason: 'reask' }) : 'unavailable');

    return async function exchange({ key, client }) {
        if (!vault.isUnlocked()) return closed();
        let result;
        try {
            result = await registry.exchangeToolKey(typeof key === 'string' ? key : null, { client, confirm });
        } catch (error) {
            if (error.code === 'VAULT_LOCKED') return closed();
            throw error;
        }
        const tool = result.tool?.name;
        log({ event: 'key-exchange', rule: result.rule, ...(tool ? { tool } : {}) });
        if (!result.allow) {
            await audit.append({ mode: 'device', allow: false, rule: result.rule, status: result.status, client, ...(tool ? { tool } : {}) }).catch(error => log({ event: 'audit-failed', code: error.code ?? 'unknown' }));
            // Een kopie in gebruik: altijd melden, ook tijdens sluimeren (een alarm, geen gewone melding).
            if (result.rule === 'key-reuse-detected') notify({ title: t('tray.notify.reuse.title'), text: t('tray.notify.reuse.text', { tool }) });
            return refuse(result.status, result.rule);
        }
        try {
            await audit.append({ mode: 'admin', origin: 'device', allow: true, rule: 'key-rotated', tool, client, detail: `generation ${result.generation}${result.grace ? '; previous key' : ''}` });
        } catch (error) {
            // Fail-closed: geen token zonder auditregel. De nieuwe sleutel vervalt; de helper heeft nog de vorige (genade).
            log({ event: 'audit-failed', code: error.code ?? 'unknown' });
            return refuse(503, 'audit-unavailable');
        }
        return { status: 200, rule: result.rule, body: { rule: result.rule, tool_name: tool, token: result.token, key: result.key, expires_in: result.expiresIn } };
    };
}
