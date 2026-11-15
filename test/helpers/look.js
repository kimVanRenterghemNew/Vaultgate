/**
 * Een scherm nakijken zoals `npm run look` het doet: wat een gebruiker als fout zou zien. Een i18n-sleutel als tekst
 * (een ontbrekende vertaling), een JS-fout, en een scrollbalk (in het welkom en de vaste schermen een fout, in een lange
 * lijst gewoon; daarom alleen gemeld).
 */
const KEY = /\b(?:portal|cli|errors|tray)\.[a-z]\w*(?:\.\w+)+\b/g;

/** @returns {Promise<string[]>} de problemen, leeg als het scherm in orde is */
export async function inspect(page, { errors = [] } = {}) {
    const { text, scrolls } = await page.evaluate(() => {
        const root = globalThis.document.documentElement;
        return { text: globalThis.document.body?.innerText ?? '', scrolls: root.scrollHeight > root.clientHeight };
    });
    return [
        ...[...new Set(text.match(KEY) ?? [])].map(key => `untranslated key: ${key}`),
        ...(scrolls ? ['scrolls (page is taller than the window)'] : []),
        ...errors.map(message => `js error: ${message}`),
    ];
}
