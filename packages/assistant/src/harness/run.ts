/**
 * The question sets' harness (A2, D77): `npm run assistant:test` plays every case through the real tools on the run
 * it's pinned to, and reports each case and the pass marks. In A2 the player is the reference answers, which must all
 * pass, and mistakes planted in them must all be caught; in A3 the model plays, and the same report gives its scores.
 *
 *   --print          each turn's tool calls and what they returned, to write a reference answer from
 *   --case <id>      only cases whose id contains this
 *   --current        replay on each route's current audit run, and list what no longer holds (after a re-audit)
 *   --model <names>  A3: the model plays instead (gemma4-e2b, qwen3.5-2b; several with commas), run by Ollama (D97):
 *                    it understands each message as a request and our code acts on it (D99)
 *   --words          with --model: the model also rewords the tools' lines, through the honesty check (D99)
 *   --loop           with --model: the earlier free tool loop instead (D97, D98)
 *   --gold           each turn's own request through our code, for the cases that have them: all must pass (D99)
 *   --quick          with --model or --gold: the quick set for tuning, about 30 cases covering each kind on each route (D97)
 *   --examples       with --model: the closest examples go before each message (D101)
 *   --outside <name> with --model: a test set from outside (`outside/<name>.json`, kept out of git), scored on the request (D101)
 *   --check-examples the examples' checks: each a request our code takes, enough of each kind, none too close to a case
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDreamFiles } from "@dpg/routes";
import { localFetch } from "@dpg/routes/node";
import { ollamaModel } from "../model";
import { type Case, readCases } from "./cases";
import { checkExamples, loadExamples } from "./examples";
import { modelPlayer } from "./model";
import { scoreOutside } from "./outside";
import { plant, playCase, referencePlayer } from "./play";
import { describe, prompt, quickSet, scoreModel } from "./score";
import { goldPlayer, understandPlayer } from "./understand";
import { World } from "./world";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const SETS = resolve(import.meta.dirname, "../../sets/en");

const cases: Case[] = [];
for (const phase of ["dream", "plan"]) {
  const file = resolve(SETS, `${phase}.json`);
  const { cases: read, problems } = readCases(JSON.parse(readFileSync(file, "utf8")), `${phase}.json`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(2);
  }
  cases.push(...read);
}
const only = value("--case");
const chosen = only ? cases.filter((c) => c.id.includes(only)) : cases;
const fetch = localFetch();
const world = new World(fetch);

if (flag("--check-examples")) {
  const { problems, report } = checkExamples(cases);
  console.log([...report, ...(problems.length ? ["", "Problems:", ...problems] : ["", "No problems."])].join("\n"));
  process.exit(problems.length ? 1 : 0);
}

// A3: the model plays, and the report is its scores.
const models = value("--model");
if (models || flag("--gold")) {
  const set = flag("--quick") ? quickSet(chosen) : chosen;
  const label = flag("--quick") ? "quick set" : only ? `cases with ${only}` : "all cases";
  if (flag("--gold")) await scoreModel(world, set.filter((c) => c.turns.every((t) => t.change || t.request)), goldPlayer, label);
  for (const name of models?.split(",") ?? []) {
    const model = ollamaModel(name.trim());
    const outside = value("--outside");
    if (outside) {
      await scoreOutside(world, cases, model, outside, { dream: prompt("understand-dream"), plan: prompt("understand-plan") }, flag("--examples") ? { dream: loadExamples("dream"), plan: loadExamples("plan") } : undefined);
      continue;
    }
    const player = flag("--loop")
      ? modelPlayer(model, { dream: prompt("dream"), plan: prompt("plan") })
      : understandPlayer(model, { dream: prompt("understand-dream"), plan: prompt("understand-plan"), ...(flag("--words") ? { words: prompt("words") } : {}), ...(flag("--examples") ? { examples: { dream: loadExamples("dream"), plan: loadExamples("plan") } } : {}) });
    await scoreModel(world, set, player, label);
  }
  process.exit(0);
}

// After a re-audit: the same cases on each route's current run.
if (flag("--current")) {
  const current = new Map<string, string>();
  for (const route of new Set(chosen.map((c) => c.route))) {
    const [network, ref] = route.split("/") as [string, string];
    current.set(route, (await loadDreamFiles(network, ref, { fetch })).manifest.run_id);
  }
  for (const c of chosen) {
    const run = current.get(c.route)!;
    if (run === c.run) continue;
    const scores = await playCase(world, { ...c, run }, referencePlayer);
    const failing = scores.filter((s) => !s.pass);
    console.log(`${failing.length ? "CHANGED" : "same   "} ${c.id} (${c.run} → ${run})`);
    for (const s of failing) console.log(`         turn ${s.turn}: ${describe(s)}`);
  }
  process.exit(0);
}

const tally = { cases: 0, passed: 0, turns: 0, phrasings: 0 };
const marks = { honest: [0, 0], options: [0, 0], lookups: [0, 0], declines: [0, 0], mustSay: [0, 0], thoughts: [0, 0] };
const planted = { caught: 0, of: 0, coincides: 0, missed: [] as string[] };
const add = (m: number[], ok: boolean) => {
  m[1]!++;
  if (ok) m[0]!++;
};

for (const c of chosen) {
  const scores = await playCase(world, c, referencePlayer);
  tally.cases++;
  tally.turns += c.turns.length;
  tally.phrasings += c.turns.reduce((a, t) => a + (t.phrasings?.length ?? 0), 0);
  const ok = scores.every((s) => s.pass);
  if (ok) tally.passed++;
  if (flag("--print")) {
    console.log(`\n=== ${c.id} (${c.kind}, ${c.route})`);
    for (const s of scores) {
      console.log(`  rider: ${s.rider || "(a change on screen)"}`);
      if (s.onScreen) console.log(`  on screen: ${s.onScreen.change.join("; ")}
  second thought: ${s.onScreen.thought.join(" / ") || "none"}`);
      s.calls.forEach((k, i) => {
        console.log(`  > ${k.tool} ${JSON.stringify(k.args)}`);
        for (const l of s.results[i]!.lines) console.log(`      ${l}`);
        s.results[i]!.options?.forEach((o, j) => console.log(`      [option ${j}] ${o.label}: ${o.changes.join("; ")}`));
      });
      console.log(`  answer: ${s.answer}`);
      if (!s.pass) console.log(`  FAILS: ${describe(s)}`);
    }
  } else console.log(`${ok ? "pass" : "FAIL"} ${c.id}${ok ? "" : `: ${scores.filter((s) => !s.pass).map((s) => `turn ${s.turn}: ${describe(s)}`).join(" / ")}`}`);
  for (const s of scores) {
    add(marks.honest, s.honest);
    if (s.option !== null) add(marks.options, s.option);
    if (c.kind === "lookup") add(marks.lookups, s.tools);
    if (s.decline !== null) add(marks.declines, s.decline);
    if (c.turns[s.turn - 1]!.mustSay?.length) add(marks.mustSay, s.mustSay);
    if (s.thought !== null) add(marks.thoughts, s.thought);
    const said = c.turns.slice(0, s.turn).map((t) => t.rider ?? "").filter(Boolean);
    const earlier = scores.slice(0, s.turn).flatMap((x) => x.results);
    for (const p of plant(s.answer, earlier, said)) {
      if (p.caught === "coincides") planted.coincides++;
      else {
        planted.of++;
        if (p.caught) planted.caught++;
        else planted.missed.push(`${c.id} turn ${s.turn}: ${p.kind}`);
      }
    }
  }
}

const pct = ([a, b]: number[]) => (b ? `${a} of ${b}` : "none");
console.log(`\n${tally.passed} of ${tally.cases} cases pass (${tally.turns} turns, ${tally.phrasings} more phrasings).`);
console.log(`Honest answers: ${pct(marks.honest)} · right options: ${pct(marks.options)} · right lookups: ${pct(marks.lookups)} · right declines: ${pct(marks.declines)} · must-say facts: ${pct(marks.mustSay)} · second thoughts: ${pct(marks.thoughts)}`);
console.log(`Planted mistakes caught: ${planted.caught} of ${planted.of}${planted.coincides ? ` (and ${planted.coincides} that landed on a number the tools really gave)` : ""}.`);
for (const m of planted.missed) console.log(`  missed: ${m}`);
process.exit(tally.passed === tally.cases && !planted.missed.length ? 0 : 1);
