/**
 * Finding a place by the name the rider gives it (D77): the model passes the rider's words; a tool, never the model,
 * decides which town they mean. Accents, case, punctuation and "St"/"Saint" don't matter.
 */

export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .trim();
}

/** How well a name matches: 3 the same, 2 one starts the other (word by word), 1 the query is a word in it, 0 not. */
function score(query: string, name: string): number {
  if (!query || !name) return 0;
  if (query === name) return 3;
  if (`${name} `.startsWith(`${query} `) || `${query} `.startsWith(`${name} `)) return 2;
  return ` ${name} `.includes(` ${query} `) ? 1 : 0;
}

/** The items whose name best matches the query, in their own order; none when nothing matches. */
export function matchNames<T>(query: string, items: T[], name: (t: T) => string | null | undefined): T[] {
  const q = fold(query);
  const scored = items.map((t) => ({ t, s: score(q, fold(name(t) ?? "")) }));
  const best = Math.max(0, ...scored.map((x) => x.s));
  return best ? scored.filter((x) => x.s === best).map((x) => x.t) : [];
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** For a name that matched nothing: the few nearest in spelling, so the rider can say which they meant. */
export function closeNames(query: string, names: string[], n = 3): string[] {
  const q = fold(query);
  return [...new Set(names)]
    .map((name) => ({ name, d: distance(q, fold(name)) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.name);
}
