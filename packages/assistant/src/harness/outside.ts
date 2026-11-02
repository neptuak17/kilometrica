/**
 * A test set from outside (D101, question 117): messages someone else wrote, each with the request it should be
 * understood as, played one by one beside Plan or Dream on one case's own screen, and scored only on the request.
 * The sets live in `outside/`, kept out of git with the files they come from. `--outside <name>` plays one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DREAM_TOOLS, type DreamContext } from "../dream";
import type { Example } from "../examples";
import type { Model } from "../model/model";
import { PLAN_TOOLS, type PlanContext } from "../plan";
import { dreamScreen, planScreen } from "../screen";
import type { ToolResult } from "../tool";
import { type PhaseName, type Request, startUnderstanding, tidy, understandTurn } from "../understand";
import type { Case } from "./cases";
import { sameRequest } from "./score";
import type { World } from "./world";

interface Outside {
  about: string;
  /** `also`: other readings that are as right, where the message could mean either. */
  messages: { id: string; phase: PhaseName; rider: string; request: Request; also?: Request[]; gap?: string }[];
}

/** The screen every message is played beside: the first case of the phase on this route with no change made on screen. */
const ROUTE = "eurovelo/ev15";

export async function scoreOutside(world: World, cases: Case[], model: Model, name: string, prompts: { dream: string; plan: string }, examples?: { dream: Example[]; plan: Example[] }) {
  const set = JSON.parse(readFileSync(resolve(import.meta.dirname, `../../outside/${name}.json`), "utf8")) as Outside;
  const base = (phase: PhaseName) => cases.find((c) => c.phase === phase && c.route === ROUTE && c.turns.every((t) => !t.change))!;
  const tally: Record<"all" | "gaps" | "declines" | "rest", [number, number]> = { all: [0, 0], gaps: [0, 0], declines: [0, 0], rest: [0, 0] };
  const misses: string[] = [];
  const ms: number[] = [];
  console.log(`${model.name}${examples ? " with the closest examples" : ""} · ${name} · ${set.messages.length} messages\n`);

  for (const m of set.messages) {
    const ctx: DreamContext | PlanContext = m.phase === "dream" ? await world.dreamContext(base("dream")) : await world.planContext(base("plan"));
    const tools = (m.phase === "dream" ? DREAM_TOOLS : PLAN_TOOLS) as { name: string; run: (c: unknown, a: Record<string, unknown>) => ToolResult<unknown> }[];
    const chat = startUnderstanding(m.phase, ctx, { understand: prompts[m.phase], ...(examples ? { examples: examples[m.phase] } : {}) });
    const wants = [m.request, ...(m.also ?? [])].map((r) => tidy(m.phase, ctx, r, {}));
    const want = wants[0]!;
    const screen = m.phase === "dream" ? dreamScreen(ctx as DreamContext) : planScreen(ctx as PlanContext);
    const out = await understandTurn(model, chat, { rider: m.rider, screen, ctx, call: (t, a) => tools.find((x) => x.name === t)!.run(ctx, a) });
    ms.push(out.ms.understand);
    const ok = wants.some((w) => sameRequest(w, out.request));
    for (const k of ["all", m.gap ? "gaps" : m.request.kind === "decline" ? "declines" : "rest"] as const) {
      tally[k][1]++;
      if (ok) tally[k][0]++;
    }
    if (!ok) misses.push(`${m.id} ${m.phase}${m.gap ? ` (gap: ${m.gap})` : ""}: "${m.rider}"\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(out.request)}`);
  }
  const line = (label: string, [ok, of]: number[]) => `  ${label}: ${ok} of ${of}`;
  console.log([...misses, "", `Right requests:`, line("all", tally.all), line("our kinds", tally.rest), line("declines", tally.declines), line("gaps (the nearest we have now)", tally.gaps)].join("\n"));
  const sorted = [...ms].sort((a, b) => a - b);
  console.log(`Time to understand: ${((sorted[Math.floor(sorted.length / 2)] ?? 0) / 1000).toFixed(1)} s median.`);
}
