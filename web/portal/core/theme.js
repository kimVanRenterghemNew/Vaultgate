// Het thema: standaard volgt het portaal Windows (licht: console-light, donker: dracula, via prefers-color-scheme in
// de CSS). Een eigen keuze ('dracula' of 'console-light') zet data-theme op het documentelement en blijft in deze browser bewaard,
// zoals de taal. Geen geheim, alleen een voorkeur: localStorage mag ontbreken (dan geldt ze alleen nu).

const STORAGE_KEY = 'vaultgate.theme';
const THEMES = new Set(['dracula', 'console-light']);

/** De bewaarde keuze, of '' (zoals Windows). */
export function theme() {
  try { const v = localStorage.getItem(STORAGE_KEY) ?? ''; return THEMES.has(v) ? v : ''; } catch { return ''; }
}

const apply = choice => {
  if (choice) document.documentElement.dataset.theme = choice; else delete document.documentElement.dataset.theme;
};

/** Een keuze bewaren ('' = zoals Windows) en meteen toepassen. */
export function setTheme(choice) {
  const value = THEMES.has(choice) ? choice : '';
  try { if (value) localStorage.setItem(STORAGE_KEY, value); else localStorage.removeItem(STORAGE_KEY); } catch { /* geen opslag: alleen deze keer */ }
  apply(value);
}

apply(theme());
