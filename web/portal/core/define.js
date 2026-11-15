import { translate } from './i18n.js';

// Webcomponents: een element krijgt zijn opmaak uit een eigen .html-bestand (statisch, geen gebruikersdata), koppelt zijn
// knoppen (`wire`) en laadt zijn eigen data (`load`). Light DOM, zodat de Tailwind/daisyUI-klassen erop werken.
//
// Uitzondering op "geen class" (docs/architecture.md): customElements.define vraagt een klasse die HTMLElement uitbreidt.
// Dat geldt alleen voor deze ene plek in de browsercode.

/**
 * @param {string} tag
 * @param {{ template?: string, wire?: () => void, load?: () => Promise<void> }} behaviour
 */
export const define = (tag, { template = '', wire, load }) => customElements.define(tag,
  // eslint-disable-next-line no-restricted-syntax -- customElements vraagt een klasse (zie hierboven)
  class extends HTMLElement {
    connectedCallback() {
      if (this.wired) return;
      this.wired = true;
      if (template) { this.innerHTML = template; translate(this); }
      wire?.call(this);
    }

    load() { return load ? load.call(this) : Promise.resolve(); }
  });
