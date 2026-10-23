/** What the plan rules share: the attention budget, the steepness threshold, and where things fall on a day. */
import type { PlanCore } from "../plan";
import type { DayPlan, PlanData, PlanItem } from "../types";

export const CAPS = { headsup: 3, highlight: 3, brief: 5 };

/** A steep stretch worth raising (D75): this long and steeper than this on average, by level. */
export const STEEP = (level: number) => (level <= 3 ? { km: 2, grade: 6 } : { km: 5, grade: 8 });

/** Each rule adds its items to the plan's list. */
export type Add = (i: PlanItem) => void;

/** Km of the day at a route measure. */
export const dayKm = (core: PlanCore, d: DayPlan, m: number) => Math.max(0, (core.axis.tOf(m) - d.fromT) / 1000);

export function inDay(core: PlanCore, d: DayPlan, m0: number, m1: number): boolean {
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  const a = Math.min(m0, m1);
  const b = Math.max(m0, m1);
  return b >= lo && a <= hi && core.axis.length > 0;
}

/**
 * Whether most of the stretch has no station that carries bikes (D70): then getting home is the rider's own affair,
 * said once, with no warning on each day. Routes like the Trans Canada Trail draw riders who expect that.
 */
export function fewTrains(data: PlanData, core: PlanCore): boolean {
  const lo = Math.min(core.axis.startM, core.axis.endM);
  const hi = Math.max(core.axis.startM, core.axis.endM);
  const none = (data.full?.findings ?? [])
    .filter((f) => f.rule_id === "services.bail_out")
    .reduce((a, f) => a + Math.max(0, Math.min(hi, Math.max(f.from_m, f.to_m)) - Math.max(lo, Math.min(f.from_m, f.to_m))), 0);
  return hi > lo && none / (hi - lo) > 0.5;
}
