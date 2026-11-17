/**
 * Taking a plan to a newer audit of its route (D111). A plan opens on the audit it was made on; when the rider updates
 * it, each night stays at the same town where the new audit has it (by name, near where it was), else at the nearest
 * stop within NEAREST_M, and the nights that find neither are planned again around the ones kept. Pure, so the screen
 * and later the app do the same.
 */
import type { Stop } from "@dpg/contracts";
import { makePlan } from "./plan";
import type { PlanChoices, PlanData, PlanInputs } from "./types";

/** A town of the same name counts as the same night this far from where it was. */
const SAME_TOWN_M = 10_000;
/** Otherwise the nearest stop this close is. */
const NEAREST_M = 3_000;
/** Stop ids before D111 were their km: "stop-27231" is km 2,723.1. */
const KM_ID = /^stop-(\d+)(?:-\d+)?$/;

/** Where a night's stop was: from the old audit's stops when we have them, else from an id that is a km. */
function whereWas(id: string, old: Stop[] | null): { name: string | null; at: number } | null {
  const s = old?.find((x) => x.id === id);
  if (s) return { name: s.name, at: s.at_m };
  const m = KM_ID.exec(id);
  return m ? { name: null, at: Number(m[1]) * 100 } : null;
}

/** The new audit's stop for one of the plan's stops, or null when it has none near enough. */
export function carryStop(id: string, stops: Stop[], old: Stop[] | null): string | null {
  const was = whereWas(id, old);
  if (!was) return stops.some((s) => s.id === id) ? id : null;
  const nearest = (keep: (s: Stop) => boolean, reach: number) => {
    let best: Stop | null = null;
    for (const s of stops) {
      if (!keep(s) || Math.abs(s.at_m - was.at) > reach) continue;
      if (!best || Math.abs(s.at_m - was.at) < Math.abs(best.at_m - was.at)) best = s;
    }
    return best;
  };
  const same = was.name ? nearest((s) => s.name === was.name, SAME_TOWN_M) : null;
  return (same ?? nearest(() => true, NEAREST_M))?.id ?? null;
}

export interface Carried {
  choices: PlanChoices;
  /** Nights (0-based) that stayed at their town, and those planned again. */
  kept: number[];
  planned: number[];
}

/**
 * The rider's choices on a newer audit. `old` is the audit the plan was made on (its stops), when it is still kept;
 * without it, stop ids that are km (before D111) are placed by their km and the others by their id.
 */
export function carryChoices(choices: PlanChoices, inputs: PlanInputs, data: PlanData, old: Stop[] | null): Carried {
  const stops = data.stops.stops;
  // Our stops move to the new audit's; the planner's own spots (a wild camp, the rider's waypoint) are made again.
  const map = (id: string) => (id.startsWith("stop-") ? carryStop(id, stops, old) : id);
  const carried = (choices.nights ?? []).map(map);
  const locked: Record<number, string> = {};
  for (const [k, id] of Object.entries(choices.locked)) {
    const c = map(id);
    if (c) locked[Number(k)] = c;
  }
  // The nights kept are held while the others are planned around them; only the rider's own locks stay locks.
  const hold: Record<number, string> = { ...locked };
  carried.forEach((id, k) => {
    if (id && hold[k] === undefined) hold[k] = id;
  });
  const restStops = choices.restStops?.map(map).filter((id): id is string => !!id);
  const trial = makePlan({ ...data, full: null }, inputs, { ...choices, nights: undefined, keepNights: undefined, locked: hold, restStops });
  const nights = trial.nights.map((n) => n.stop.id);
  const kept = nights.flatMap((id, k) => (carried[k] === id ? [k] : []));
  return {
    choices: { ...choices, nights, locked, keepNights: undefined, restStops },
    kept,
    planned: nights.flatMap((_, k) => (kept.includes(k) ? [] : [k])),
  };
}
