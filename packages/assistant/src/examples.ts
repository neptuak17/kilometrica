/**
 * The closest examples (D101): rider messages we wrote, with the request each is understood as. For each message our
 * code picks the few closest by their words (BM25, with numbers, months and towns read alike) and puts them before it,
 * so a small model sees how messages like this one are read, with no training. They are data, not riders' words.
 */
import { fold } from "./names";
import type { Request } from "./understand";

export interface Example {
  rider: string;
  request: Request;
}

/** An examples file: messages by their kind ("decline/<reason>" for a decline), each with its details. */
export interface ExamplesFile {
  about: string;
  examples: Record<string, ([string] | [string, Record<string, unknown>])[]>;
}

export function examplesOf(file: ExamplesFile): Example[] {
  return Object.entries(file.examples).flatMap(([key, rows]) => {
    const [kind, reason] = key.split("/");
    return rows.map(([rider, details]) => ({ rider, request: { kind: kind!, ...(reason ? { reason } : {}), ...details } }));
  });
}

/** The details that name places and countries, read as "town" so any one matches any other. */
const PLACES = ["town", "to_town", "instead_of", "through", "place", "only_country", "avoid_country"];
const MONTH_WORDS = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);

/** A message's words, folded: numbers as "#", months as "month", and the given places as "town". */
export function wordsOf(text: string, places: string[] = []): string[] {
  const names = [...new Set(places.map((p) => fold(p).trim()).filter(Boolean))].sort((x, y) => y.length - x.length);
  const whole = names.length ? new RegExp(`(?<![a-z0-9])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z0-9])`, "g") : null;
  return (whole ? fold(text).replace(whole, " town ") : fold(text))
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? "#" : MONTH_WORDS.has(w) ? "month" : w.replace(/'s$/, "")));
}

/** The places an example's request names. */
export const placesOf = (r: Request) => PLACES.flatMap((k) => (typeof r[k] === "string" ? [r[k] as string] : [])).concat(Array.isArray(r.towns) ? (r.towns as string[]) : []);

export interface ExampleIndex {
  examples: Example[];
  docs: string[][];
  idf: Map<string, number>;
  avg: number;
}

export function indexExamples(examples: Example[]): ExampleIndex {
  const docs = examples.map((e) => wordsOf(e.rider, placesOf(e.request)));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map([...df].map(([w, k]) => [w, Math.log(1 + (n - k + 0.5) / (k + 0.5))]));
  return { examples, docs, idf, avg: docs.reduce((a, d) => a + d.length, 0) / Math.max(1, n) };
}

/** The closest examples to a message, best last, at most `perKind` of any one kind (a decline's reason counts as its kind). */
export function closest(index: ExampleIndex, message: string, places: string[], k = 8, perKind = 3): Example[] {
  const q = wordsOf(message, places);
  const scored = index.docs.map((d, i) => {
    let s = 0;
    for (const w of new Set(q)) {
      const f = d.filter((x) => x === w).length;
      if (f) s += (index.idf.get(w) ?? 0) * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / index.avg)));
    }
    return { i, s };
  });
  const picked: Example[] = [];
  const kinds = new Map<string, number>();
  for (const { i, s } of scored.sort((a, b) => b.s - a.s)) {
    if (picked.length >= k || s <= 0) break;
    const e = index.examples[i]!;
    const key = `${e.request.kind}/${e.request.reason ?? ""}`;
    if ((kinds.get(key) ?? 0) >= perKind) continue;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
    picked.push(e);
  }
  return picked.reverse();
}

/** The examples as the model reads them, before the rider's message. */
export const examplesText = (picked: Example[]) =>
  picked.length ? `Messages like this one, and their requests:\n${picked.map((e) => `- "${e.rider}" → ${JSON.stringify(e.request)}`).join("\n")}\n\n` : "";
