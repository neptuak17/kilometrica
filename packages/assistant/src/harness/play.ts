/**
 * Playing a case and scoring it (A2, D77). A player answers each turn through a session that runs the real tools and
 * records the calls: in A2 the reference player replays each case's own calls and reference answer, which proves the
 * tools can answer it; in A3 the model takes its place, and the same scoring gives its marks.
 */
import { secondThoughts } from "@dpg/planner";
import { DREAM_TOOLS, type DreamContext } from "../dream";
import { checkAnswer, type Unsupported } from "../honesty";
import { fold } from "../names";
import { PLAN_TOOLS, type PlanApply, type PlanContext } from "../plan";
import type { ToolResult } from "../tool";
import type { Call, Case, Turn } from "./cases";
import type { World } from "./world";

/** The tools as a player reaches them: each call runs the real tool and is recorded. */
export interface Session {
  call(tool: string, args: Record<string, unknown>): ToolResult<unknown>;
}

/** A player's answer: what it says. The options it offers are those its calls returned (offer_options, set_question). */
export interface Answer {
  text: string;
}

export interface Player {
  name: string;
  answer(c: Case, turn: Turn, rider: string, session: Session): Promise<Answer>;
}

/** A2's player: each case's own calls and reference answer. */
export const referencePlayer: Player = {
  name: "reference",
  async answer(_c, turn, _rider, session) {
    for (const k of turn.calls) session.call(k.tool, k.args);
    return { text: turn.reference };
  },
};

export interface TurnScore {
  turn: number;
  rider: string;
  /** Each part of a pass (D77): null where it doesn't apply. */
  tools: boolean;
  option: boolean | null;
  honest: boolean;
  mustSay: boolean;
  /** A decline offers nothing and says what it must. */
  decline: boolean | null;
  /** After a change on screen: the second thought the planner raised is the one expected, or none. */
  thought: boolean | null;
  /** The change made on screen, as the change bar says it, and the second thought it raised (none: empty). */
  onScreen: { change: string[]; thought: string[] } | null;
  pass: boolean;
  unsupported: Unsupported[];
  missing: string[];
  calls: Call[];
  results: ToolResult<unknown>[];
  answer: string;
}

/** Whether every key the expected call gives is in the made one, with the same value (extra keys are fine). */
function subset(want: unknown, got: unknown): boolean {
  if (want && typeof want === "object") {
    if (!got || typeof got !== "object") return false;
    if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => subset(w, got[i]));
    return Object.entries(want).every(([k, v]) => subset(v, (got as Record<string, unknown>)[k]));
  }
  return typeof want === "string" && typeof got === "string" ? fold(want) === fold(got) : want === got;
}

const has = (text: string, phrase: string) => ` ${fold(text)} `.includes(` ${fold(phrase)} `);

/** Play a case: one rider message (or one phrasing of it) per turn. */
export async function playCase(world: World, c: Case, player: Player, phrasing = 0): Promise<TurnScore[]> {
  const out: TurnScore[] = [];
  const results: ToolResult<unknown>[] = [];
  const said: string[] = [];
  let dream: DreamContext | null = c.phase === "dream" ? await world.dreamContext(c) : null;
  let plan: PlanContext | null = c.phase === "plan" ? await world.planContext(c) : null;
  const tools = (c.phase === "dream" ? DREAM_TOOLS : PLAN_TOOLS) as { name: string; run: (ctx: unknown, args: Record<string, unknown>) => ToolResult<unknown> }[];
  const ctx = () => (dream ?? plan)!;

  for (const [k, turn] of c.turns.entries()) {
    let thought: boolean | null = null;
    let onScreen: TurnScore["onScreen"] = null;
    // A change made on screen (D77): it applies at once; the planner says whether it's worth a second thought.
    if (turn.change && plan) {
      const offer = PLAN_TOOLS.find((t) => t.name === "offer_options")!.run(plan, { options: [{ changes: [turn.change] }] });
      const next = (offer.options?.[0]?.apply as PlanApply | undefined)?.state;
      if (next) {
        const raised = secondThoughts(plan.data, plan.planFor(plan.state), plan.planFor(next))[0] ?? null;
        thought = (raised?.question ?? null) === (turn.thought ?? null);
        const lines = raised ? [raised.question, raised.why, ...raised.options.map((o) => o.label), raised.keep] : [];
        if (raised) results.push({ lines, facts: {} });
        onScreen = { change: offer.options?.[0]?.changes ?? [], thought: lines };
        plan = { ...plan, state: next };
      } else {
        thought = false;
        onScreen = { change: offer.lines, thought: [] };
      }
    }
    const rider = turn.rider ? ([turn.rider, ...(turn.phrasings ?? [])][phrasing] ?? turn.rider) : "";
    if (rider) said.push(rider);
    const calls: Call[] = [];
    const made: ToolResult<unknown>[] = [];
    const session: Session = {
      call(tool, args) {
        const t = tools.find((x) => x.name === tool);
        const r = t ? t.run(ctx(), args) : { lines: [`There's no tool called ${tool}.`], facts: { ok: false } };
        calls.push({ tool, args });
        made.push(r);
        results.push(r);
        return r;
      },
    };
    const answer = await player.answer(c, turn, rider, session);

    const toolsRight = turn.calls.every((want) => calls.some((got) => got.tool === want.tool && subset(want.args, got.args)));
    // The options the answer offers: every one its calls returned.
    const offered = made.flatMap((r) => r.options ?? []).map((o) => JSON.stringify(o.apply));
    let option: boolean | null = null;
    if (turn.offer) {
      // The expected option, made fresh, must be among them: judged by what it would make, not how it was asked for.
      const want = turn.calls[turn.offer.call]!;
      const expected = tools.find((x) => x.name === want.tool)!.run(ctx(), want.args).options?.[turn.offer.option]?.apply;
      option = expected !== undefined && offered.includes(JSON.stringify(expected));
    } else if (offered.length) option = false;
    const check = checkAnswer(answer.text, { results, rider: said });
    const missing = [...(turn.mustSay ?? []).filter((p) => !has(answer.text, p)), ...(turn.mustNotSay ?? []).filter((p) => has(answer.text, p)).map((p) => `not: ${p}`)];
    const decline = c.kind === "decline" ? !offered.length && !missing.length : null;
    const pass = toolsRight && option !== false && check.ok && !missing.length && decline !== false && thought !== false;
    out.push({ turn: k + 1, rider, tools: toolsRight, option, honest: check.ok, mustSay: !missing.length, decline, thought, onScreen, pass, unsupported: check.unsupported, missing, calls, results: made, answer: answer.text });
  }
  return out;
}

/**
 * Mistakes planted in a reference answer (D81): each must fail the honesty check. A planted number that happens to be
 * one the tools really gave can't be caught, and is counted apart.
 */
export function plant(answer: string, results: ToolResult<unknown>[], rider: string[]) {
  const out: { kind: string; caught: boolean | "coincides" }[] = [];
  if (!answer.trim()) return out;
  const sources = { results, rider };
  const try_ = (kind: string, text: string, number?: number) => {
    if (text === answer) return;
    const caught = !checkAnswer(text, sources).ok;
    const known = number !== undefined && checkAnswer(String(number), sources).ok;
    out.push({ kind, caught: caught ? true : known ? "coincides" : false });
  };
  const m = /\d+/.exec(answer.replace(/\d{1,2}:\d{2}/g, "xx"));
  if (m) try_("number nudged", answer.slice(0, m.index) + String(Number(m[0]) + 1) + answer.slice(m.index + m[0].length), Number(m[0]) + 1);
  const kmM = /(\d+) km/.exec(answer);
  if (kmM) try_("km as miles", answer.replace(kmM[0], `${Math.round(Number(kmM[1]) * 0.621)} miles`), Math.round(Number(kmM[1]) * 0.621));
  try_("invented hotel", `${answer} The Hotel Miramar Splendid is lovely.`);
  try_("a percentage", `${answer} About 35% of it is on roads.`);
  return out;
}
