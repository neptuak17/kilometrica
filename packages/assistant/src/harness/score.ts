/**
 * Scoring a model on the question sets (A3, D77, D91, D97, D99): every case in each of its phrasings, played by it, with
 * D77's bars over all of them together, the passes by route, kind of question and phrasing, and the time to the first
 * words and to the full answer on every turn. Every turn goes into a log on the laptop, outside git, so whatever goes
 * wrong can become a new case or a change to the prompt.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fold } from "../names";
import type { Case } from "./cases";
import { type Player, playCase, type TurnScore } from "./play";
import type { World } from "./world";

const PROMPTS = resolve(import.meta.dirname, "../../prompts/en");

/** A prompt by its name in `prompts/en/`. */
export const prompt = (name: string) => readFileSync(resolve(PROMPTS, `${name}.md`), "utf8");
const RUNS = resolve(import.meta.dirname, "../../runs");

/** D77's bars for A3's go/no-go: at least so many in so many. */
const BARS = { honestFirst: [19, 20], options: [9, 10], lookups: [9, 10], declines: [19, 20], mustSay: [17, 20] } as const;

/**
 * The quick set for tuning (D97), about 30 cases: the first of each kind on each route in each phase, and the middle one
 * too where there are ten or more.
 */
export function quickSet(cases: Case[]): Case[] {
  const groups = new Map<string, Case[]>();
  for (const c of cases) groups.set(`${c.phase} ${c.route} ${c.kind}`, [...(groups.get(`${c.phase} ${c.route} ${c.kind}`) ?? []), c]);
  return [...groups.values()].flatMap((g) => (g.length >= 10 ? [g[0]!, g[Math.floor(g.length / 2)]!] : [g[0]!]));
}

const phrasingsOf = (c: Case) => (c.turns.some((t) => t.phrasings?.length) ? 2 : 1);
const tally = () => ({ ok: 0, of: 0 });
const add = (t: { ok: number; of: number }, ok: boolean) => {
  t.of++;
  if (ok) t.ok++;
};
const share = (t: { ok: number; of: number }) => (t.of ? t.ok / t.of : 1);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
};

/** Whether a request is the one expected (D99): the same kind and details, names without case or accents, lists in any order. */
function sameRequest(want: Record<string, unknown>, got: unknown): boolean {
  if (!got || typeof got !== "object") return false;
  const norm = (v: unknown): string => (Array.isArray(v) ? JSON.stringify(v.map(norm).sort()) : typeof v === "string" ? fold(v) : JSON.stringify(v));
  const g = got as Record<string, unknown>;
  const keys = new Set([...Object.keys(want), ...Object.keys(g)]);
  return [...keys].every((k) => want[k] !== undefined && g[k] !== undefined && norm(want[k]) === norm(g[k]));
}

export async function scoreModel(world: World, cases: Case[], player: Player, label: string) {
  const plays = cases.reduce((a, c) => a + phrasingsOf(c), 0);
  console.log(`${player.name} · ${label} · ${cases.length} cases, ${plays} plays (each phrasing)\n`);

  const marks = { honestFirst: tally(), options: tally(), plainOptions: tally(), lookups: tally(), declines: tally(), mustSay: tally(), thoughts: tally(), requests: tally() };
  const by = { route: new Map<string, ReturnType<typeof tally>>(), kind: new Map<string, ReturnType<typeof tally>>(), phrasing: new Map<string, ReturnType<typeof tally>>() };
  const from = new Map<string, number>();
  const times = { firstWords: [] as number[], full: [] as number[] };
  let refused = 0;
  const log: unknown[] = [];
  const passed = tally();

  for (const c of cases) {
    for (let phrasing = 0; phrasing < phrasingsOf(c); phrasing++) {
      const t0 = performance.now();
      let scores: TurnScore[];
      try {
        scores = await playCase(world, c, player, phrasing);
      } catch (e) {
        console.log(`ERROR ${c.id} [${phrasing + 1}]: ${(e as Error).message}`);
        log.push({ id: c.id, phrasing: phrasing + 1, error: (e as Error).message });
        continue;
      }
      const ok = scores.every((s) => s.pass);
      add(passed, ok);
      for (const [k, v] of [["route", c.route], ["kind", c.kind], ["phrasing", phrasing ? "second phrasing" : "as written"]] as const) {
        if (!by[k].has(v)) by[k].set(v, tally());
        add(by[k].get(v)!, ok);
      }
      const why = scores.filter((s) => !s.pass).map((s) => `turn ${s.turn}: ${describe(s)}`).join(" / ");
      console.log(`${ok ? "pass" : "FAIL"} ${c.id} [${phrasing + 1}] ${seconds(performance.now() - t0)}${ok ? "" : `: ${why}`}`);

      for (const s of scores) {
        const turn = c.turns[s.turn - 1]!;
        if (!turn.change) add(marks.honestFirst, s.honestFirst);
        if (turn.offer) add(marks.options, s.option === true);
        else if (!turn.change) add(marks.plainOptions, s.option !== false);
        if (c.kind === "lookup") add(marks.lookups, s.tools);
        if (s.decline !== null) add(marks.declines, s.decline);
        if (turn.mustSay?.length || turn.mustNotSay?.length) add(marks.mustSay, s.mustSay);
        if (s.thought !== null) add(marks.thoughts, s.thought);
        const tr = s.trace as { from?: string; refused?: string[]; request?: unknown; ms?: { firstWords: number | null; full: number } } | undefined;
        if (turn.request) add(marks.requests, sameRequest(turn.request, tr?.request));
        from.set(tr?.from ?? "?", (from.get(tr?.from ?? "?") ?? 0) + 1);
        refused += tr?.refused?.length ?? 0;
        if (tr?.ms && tr.from !== "quiet") {
          times.full.push(tr.ms.full);
          if (tr.ms.firstWords !== null) times.firstWords.push(tr.ms.firstWords);
        }
      }
      log.push({
        id: c.id, phrasing: phrasing + 1, kind: c.kind, route: c.route, pass: ok,
        turns: scores.map(({ results, ...s }) => ({ ...s, results: results.map((r) => ({ lines: r.lines, options: r.options?.map((o) => ({ label: o.label, changes: o.changes })) })) })),
      });
    }
  }

  const line = (name: string, t: ReturnType<typeof tally>, bar?: readonly [number, number]) =>
    `  ${name}: ${t.ok} of ${t.of}${bar ? ` (bar ${bar[0]} in ${bar[1]}: ${share(t) >= bar[0] / bar[1] ? "met" : "missed"})` : ""}`;
  console.log(`\n${passed.ok} of ${passed.of} plays pass.`);
  console.log("D77's bars, over all plays:");
  console.log(line("Honest first answers", marks.honestFirst, BARS.honestFirst));
  console.log(line("Right options", marks.options, BARS.options));
  console.log(line("Right lookups", marks.lookups, BARS.lookups));
  console.log(line("Right declines", marks.declines, BARS.declines));
  console.log(`  Plain questions with no option offered: ${marks.plainOptions.ok} of ${marks.plainOptions.of} (bar: all)`);
  console.log(line("Must-say facts", marks.mustSay, BARS.mustSay));
  if (marks.thoughts.of) console.log(line("Second thoughts", marks.thoughts));
  if (marks.requests.of) console.log(line("Right requests (D99)", marks.requests));
  for (const [k, m] of Object.entries(by)) console.log(`By ${k}: ${[...m].map(([v, t]) => `${v} ${t.ok} of ${t.of}`).join(" · ")}`);
  console.log(`Answers: ${[...from].map(([k, n]) => `${k} ${n}`).join(" · ")}; calls refused: ${refused}`);
  console.log(
    `Time per turn: first words ${seconds(quantile(times.firstWords, 0.5))} median, ${seconds(quantile(times.firstWords, 0.9))} for 9 in 10; full answer ${seconds(quantile(times.full, 0.5))} median, ${seconds(quantile(times.full, 0.9))} for 9 in 10.`,
  );
  mkdirSync(RUNS, { recursive: true });
  const file = resolve(RUNS, `${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z-${player.name}-${label.replace(/\s+/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ model: player.name, label, marks, by: Object.fromEntries(Object.entries(by).map(([k, m]) => [k, Object.fromEntries(m)])), times, plays: log }, null, 1));
  console.log(`Log: ${file}`);
}

export function describe(s: TurnScore): string {
  return [
    s.tools ? "" : "tools not called",
    s.option === false ? "option differs" : "",
    s.honest ? (s.honestFirst ? "" : "first answer unsupported") : `unsupported: ${s.unsupported.map((u) => `"${u.text}"`).join(", ")}`,
    s.mustSay ? "" : `missing: ${s.missing.map((m) => `"${m}"`).join(", ")}`,
    s.decline === false ? "not a decline" : "",
    s.thought === false ? "second thought differs" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
