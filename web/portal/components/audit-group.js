// Herhaalde beslissingen bundelen: opeenvolgende regels met dezelfde tool, secret, domein, regel en uitkomst worden
// één rij met een aantal, zodat honderd calls naar dezelfde host de andere beslissingen niet uit beeld duwen.

// Beheer nooit bundelen: elke wijziging is een eigen rij, met haar eigen oud → nieuw.
const same = (a, b) => a.mode !== 'admin' && b.mode !== 'admin' && a.tool === b.tool && a.secret === b.secret && a.host === b.host && a.rule === b.rule && a.allow === b.allow;

/**
 * @param {object[]} entries auditregels, laatste eerst (`count`: een regel die al herhalingen samenvat)
 * @returns {{entry: object, count: number, since: number}[]} de nieuwste regel per groep, het aantal en de oudste tijd
 */
export function groupEntries(entries) {
  const groups = [];
  for (const e of entries) {
    const last = groups.at(-1);
    const n = e.count ?? 1; // de proxy voegt herhaalde weigeringen al samen tot één regel met een aantal
    if (last && same(last.entry, e)) { last.count += n; last.since = e.t; } else groups.push({ entry: e, count: n, since: e.t });
  }
  return groups;
}
