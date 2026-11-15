// Lijst + detail (inspector, mockups v23): links een lijst rijen, rechts één onderdeel groot. Klikken (of Enter/spatie
// op een rij die geen knop is) kiest een rij (`aria-selected`) en zet wat `render` maakt in het detailvak. Na herladen
// blijft dezelfde rij gekozen (zelfde sleutel), anders de eerste; zonder rijen toont het detailvak `empty`.

/** De kiesbare rij: de rij zelf, of de knop erin (een `<li>` rond een knop). */
const target = row => (row.matches('button, [role="option"]') ? row : row.querySelector('button') ?? row);

/**
 * @template T
 * @param {HTMLElement} listEl de lijst; onthoudt de gekozen sleutel in `data-selected`
 * @param {HTMLElement} detailEl het detailvak rechts
 * @param {{ row: HTMLElement, item: T }[]} rows elke rij met haar onderdeel
 * @param {{ keyOf: (item: T) => string, render: (item: T) => Node, empty?: () => Node }} how
 */
export function inspector(listEl, detailEl, rows, { keyOf, render, empty }) {
  const select = ({ row, item }) => {
    listEl.dataset.selected = keyOf(item);
    for (const r of rows) target(r.row).setAttribute('aria-selected', String(r.row === row));
    detailEl.replaceChildren(render(item));
  };
  for (const r of rows) {
    const el = target(r.row);
    el.setAttribute('aria-selected', 'false');
    el.addEventListener('click', () => select(r));
    if (el.matches('button')) continue;
    // Een rij die geen knop is (gedeeld met een lijst zonder detail): zelf een optie die je met het toetsenbord kiest.
    Object.assign(el, { tabIndex: 0 });
    el.setAttribute('role', 'option');
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r); } });
  }
  const prevFirst = listEl.dataset.firstKey;
  const newFirst = rows[0] ? keyOf(rows[0].item) : '';
  listEl.dataset.firstKey = newFirst;
  if (prevFirst && newFirst && prevFirst !== newFirst && rows[0]) {
    target(rows[0].row).classList.add('row-enter');
  }
  listEl.replaceChildren(...rows.map(r => r.row));
  const kept = rows.find(r => keyOf(r.item) === listEl.dataset.selected) ?? rows[0];
  if (kept) select(kept); else detailEl.replaceChildren(...(empty ? [empty()] : []));
}
