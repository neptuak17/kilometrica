/**
 * The examples and their checks (D101): every example is a request our code takes, every kind has enough of them, and
 * none is so close to a case's message that the cases stop being a test. `--check-examples` prints the report.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Example, examplesOf, type ExamplesFile, placesOf, wordsOf } from "../examples";
import { testRoute } from "../testdata";
import { clockOf, kindsOf, type PhaseName, type Request } from "../understand";
import { EMPTY } from "@dpg/dream";
import type { Case } from "./cases";

const DIR = resolve(import.meta.dirname, "../../examples/en");
const read = (name: string) => examplesOf(JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as ExamplesFile);

/** A phase's examples: its own, and the declines both phases share. */
export const loadExamples = (phase: PhaseName): Example[] => [...read(phase), ...read("declines")];

/** At least so many examples of each kind, and of each decline's reason. */
const MIN = { kind: 5, reason: 4 };
/** Word overlap with a case's message (shared words over all words) at or above which an example is too close. */
export const TOO_CLOSE = 0.6;
/** Details whose values are the route's own (countries, scenery): any value will do in an example. */
const ROUTE_OWN = new Set(["only_country", "avoid_country", "themes"]);
const FLAGS = new Set(["smoke", "no_rest"]);

interface Detail {
  type?: string;
  enum?: unknown[];
  items?: { type?: string; enum?: unknown[] };
  minimum?: number;
  maximum?: number;
}

/** What's wrong with a request for a phase, or null: its kind, its details and their values, as the schema forces them. */
export function problemWith(phase: PhaseName, r: Request): string | null {
  const kinds = kindsOf(phase, phase === "dream" ? { route: testRoute(), ask: EMPTY } : (null as never));
  const k = kinds.find((x) => x.kind === r.kind);
  if (!k) return `no kind "${r.kind}"`;
  for (const req of k.required ?? []) if (r[req] === undefined) return `${r.kind} needs ${req}`;
  for (const [key, v] of Object.entries(r)) {
    if (key === "kind") continue;
    const d = k.details?.[key] as Detail | undefined;
    if (!d) return `${r.kind} takes no "${key}"`;
    if (d.type === "array" && !Array.isArray(v)) return `${key} should be a list`;
    const one = d.type === "array" ? d.items ?? {} : d;
    for (const x of Array.isArray(v) ? v : [v]) {
      const type = one.type === "integer" ? Number.isInteger(x) : one.type ? typeof x === one.type : true;
      if (!type) return `${key} should be ${one.type}`;
      if (one.enum && !ROUTE_OWN.has(key) && !one.enum.includes(x)) return `${key} "${String(x)}" isn't one of ${one.enum.join(", ")}`;
      if (typeof x === "number" && ((d.minimum !== undefined && x < d.minimum) || (d.maximum !== undefined && x > d.maximum))) return `${key} ${x} is out of range`;
    }
  }
  if (r.kind === "be_in_by" && clockOf(String(r.time)) !== r.time) return `time "${String(r.time)}" isn't HH:MM`;
  return null;
}

const overlap = (a: string[], b: string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared || 1);
};

/** The checks over both phases' examples: problems that fail them, and the report. */
export function checkExamples(cases: Case[]): { problems: string[]; report: string[] } {
  const problems: string[] = [];
  const report: string[] = [];
  const messages = cases.flatMap((c) => c.turns.flatMap((t) => [t.rider, ...(t.phrasings ?? [])].filter((m): m is string => !!m).map((m) => ({ id: c.id, m, words: wordsOf(m, t.request ? placesOf(t.request) : []) }))));
  const closest: { score: number; line: string }[] = [];

  for (const phase of ["plan", "dream"] as const) {
    const all = loadExamples(phase);
    const own = all;
    // Valid: each one a request our code takes.
    for (const e of own) {
      const p = problemWith(phase, e.request);
      if (p) problems.push(`${phase}: "${e.rider}": ${p}`);
    }
    // Coverage: every kind, every decline's reason, every value a detail can take.
    const kinds = kindsOf(phase, phase === "dream" ? { route: testRoute(), ask: EMPTY } : (null as never));
    const count = (f: (r: Request) => boolean) => own.filter((e) => f(e.request)).length;
    const thin: string[] = [];
    for (const k of kinds) {
      if (k.kind === "decline") continue;
      const n = count((r) => r.kind === k.kind);
      if (n < MIN.kind) thin.push(`${k.kind} ${n}`);
      for (const [key, d] of Object.entries(k.details ?? {}) as [string, Detail][]) {
        // Months and the route's own values can be any; a flag only ever says it's on.
        const values = d.type === "boolean" ? (FLAGS.has(key) ? [true] : [true, false]) : ROUTE_OWN.has(key) || key.includes("month") ? [] : (d.enum ?? d.items?.enum ?? []);
        for (const v of values) if (!count((r) => r.kind === k.kind && (Array.isArray(r[key]) ? (r[key] as unknown[]).includes(v) : r[key] === v))) thin.push(`${k.kind} ${key} ${String(v)} 0`);
      }
    }
    const reasons = (kinds.find((k) => k.kind === "decline")!.details!.reason as Detail).enum as string[];
    for (const reason of reasons) {
      const n = count((r) => r.kind === "decline" && r.reason === reason);
      if (n < MIN.reason) thin.push(`decline ${reason} ${n}`);
    }
    if (thin.length) problems.push(`${phase}: too few examples: ${thin.join(", ")}`);
    // Spread: how they're written.
    const words = own.map((e) => e.rider.split(/\s+/).length);
    report.push(
      `${phase}: ${own.length} examples over ${new Set(own.map((e) => `${e.request.kind}/${e.request.reason ?? ""}`)).size} kinds and reasons; ` +
        `${own.filter((e) => e.rider === e.rider.toLowerCase()).length} all lower case, ${own.filter((e) => !/[.?!]$/.test(e.rider.trim())).length} with no end mark; ` +
        `${words.filter((n) => n <= 4).length} of up to 4 words, ${words.filter((n) => n > 4 && n <= 12).length} of 5 to 12, ${words.filter((n) => n > 12).length} longer.`,
    );
    // Not too close to any case's message, nor to each other.
    const docs = own.map((e) => ({ e, words: wordsOf(e.rider, placesOf(e.request)) }));
    for (const { e, words: w } of docs) {
      const best = messages.map((m) => ({ m, s: overlap(w, m.words) })).sort((a, b) => b.s - a.s)[0];
      if (best) closest.push({ score: best.s, line: `${best.s.toFixed(2)} "${e.rider}" ~ ${best.m.id}: "${best.m.m}"` });
      if (best && best.s >= TOO_CLOSE) problems.push(`${phase}: too close to a case: "${e.rider}" ~ ${best.m.id} "${best.m.m}" (${best.s.toFixed(2)})`);
    }
    for (let i = 0; i < docs.length; i++)
      for (let j = i + 1; j < docs.length; j++) if (overlap(docs[i]!.words, docs[j]!.words) >= 0.9) report.push(`${phase}: near twins: "${docs[i]!.e.rider}" / "${docs[j]!.e.rider}"`);
  }
  const top = [...new Map(closest.map((c) => [c.line, c])).values()].sort((a, b) => b.score - a.score).slice(0, 12);
  report.push(`Closest to the cases (too close at ${TOO_CLOSE}):`, ...top.map((c) => `  ${c.line}`));
  return { problems, report };
}
