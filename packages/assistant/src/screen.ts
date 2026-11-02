/**
 * What's on screen, in our words (A3): the loop tells the model where the rider is, so "this one" and "my plan" make
 * sense, and the honesty check counts these words as ours, like a tool's. The tools themselves fall back to what's on
 * screen when the rider names no day or stretch.
 */
import { keyOf, stretchesFor, stretchName } from "@dpg/dream";
import { plural } from "@dpg/planner";
import type { DreamContext } from "./dream";
import type { PlanContext } from "./plan";
import { MONTHS_ENUM } from "./tool";

export function dreamScreen(ctx: DreamContext): string {
  const { route, ask } = ctx;
  const level = route.dream.levels.find((l) => l.level === ask.level)?.name;
  const set = [level ? `level ${level}` : "", ask.days !== null ? plural(ask.days, "day") : "", ask.month !== null ? (MONTHS_ENUM[ask.month] ?? "") : ""].filter(Boolean);
  const shown = ctx.screen?.stretch ? stretchesFor(route, ask).find((r) => keyOf(r) === ctx.screen!.stretch) : undefined;
  const daily = new Map(route.daily.map((d) => [d.number, d]));
  return `On screen: Dream, on ${route.name}; the question so far: ${set.length ? set.join(", ") : "nothing set yet"}${shown ? `; the stretch open: ${stretchName(daily, shown)}` : ""}.`;
}

export function planScreen(ctx: PlanContext): string {
  const p = ctx.planFor(ctx.state);
  return `On screen: Plan, ${p.brief.title}, ${plural(p.days.length, "day")}, ${p.brief.dates}${ctx.screen?.day ? `; day ${ctx.screen.day} open` : ""}.`;
}
