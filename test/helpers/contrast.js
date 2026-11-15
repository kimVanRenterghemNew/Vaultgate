/**
 * Contrast zoals een gebruiker het ziet: de tekstkleur van een element tegen de achtergrond die eronder ligt, alle
 * (half)doorzichtige achtergronden van de voorouders samengevoegd. De browser rekent elke CSS-kleur (oklch, color-mix)
 * om naar sRGB via een canvas; de verhouding volgt WCAG 2.x (AA voor gewone tekst: 4,5:1).
 */

/** WCAG AA voor gewone tekst. */
export const AA = 4.5;

/** @param {import('playwright').Locator} locator @returns {Promise<number>} de contrastverhouding (1 tot 21) */
export function contrast(locator) {
    return locator.evaluate(el => {
        const ctx = globalThis.document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const rgba = css => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b, a / 255];
        };
        const over = (base, [r, g, b, a]) => [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.unshift(n);
        let bg = [255, 255, 255];
        let opacity = 1;
        for (const n of chain) {
            const style = globalThis.getComputedStyle(n);
            bg = over(bg, rgba(style.backgroundColor));
            opacity *= Number(style.opacity);
        }
        // shortcut: de opaciteit van een voorouder dempt hier alleen de tekst, niet ook zijn eigen achtergrond; genoeg
        // voor rijen op een effen paneel, niet voor gestapelde doorzichtige lagen met eigen opaciteit.
        const [r, g, b, a] = rgba(globalThis.getComputedStyle(el).color);
        const fg = over(bg, [r, g, b, a * opacity]);
        const lum = c => {
            const [R, G, B] = c.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    });
}

/** Voor de beide thema's: het systeem in licht en in donker (het portaal volgt prefers-color-scheme). */
export async function inBothThemes(page, measure) {
    const out = {};
    for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme });
        // een themawissel start CSS-overgangen (achtergrond van een gekozen rij): meten na afloop, niet halverwege
        await page.waitForFunction(() => globalThis.document.getAnimations().every(a => !(a instanceof globalThis.CSSTransition)));
        out[colorScheme] = await measure();
    }
    await page.emulateMedia({ colorScheme: process.env.KS_COLOR_SCHEME ?? 'dark' }); // terug naar het thema van openBrowser
    return out;
}
