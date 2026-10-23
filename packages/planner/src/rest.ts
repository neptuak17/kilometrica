/**
 * Rest days (D74): where they help most. Each riding night is scored on recovery (the days before it against the
 * rider's usual day), spacing (close to even; never after day 1 or the last riding day; at least 3 riding days apart)
 * and a place worth a day (a town, sights within 5 km, food, a bike shop, a station, room for 2 nights of the rider's
 * kind). Pure, so the assistant can call it too (D38).
 */
import type { Highlight, Stop } from "@dpg/contracts";
import { bedsFor, type DayContext, type DayEval, evalDay, type StagePlan, usable } from "./stages";
import { monthOf } from "./sun";
import { km, plural, stopName } from "./text";
import type { PlanData, Sleep } from "./types";

const SIGHTS_M = 5000;
const MIN_APART = 3;
/** A better town for a rest day is looked for this far either way of the night, and must score this much higher. */
const BETTER_M = 25_000;
const BETTER_BY = 0.25;
const TOWN: Record<string, number> = { city: 1, town: 0.7, village: 0.35 };

/** How the rider likes to travel (D74): it sets how many of their days are rest days. */
export type Pace = "relaxed" | "steady" | "moving";

/** Rest days for so many riding days (D74): about one per 4 riding days relaxed, one per 6 steady, none moving. */
export const restFor = (riding: number, pace: Pace) =>
  pace === "moving" ? 0 : pace === "relaxed" ? (riding >= 4 ? Math.floor(riding / 4) : 0) : riding >= 7 ? Math.floor(riding / 6) : 0;

/** The riding days in so many days in all (D74): the days left over are rest days, so the total always holds. */
export function ridingDays(total: number, pace: Pace): number {
  let r = total;
  while (r > 1 && r + restFor(r, pace) > total) r--;
  return r;
}

/** Rest days by default (D74): about one per 6 riding days, from 7 riding days. */
export const suggestedRestDays = (rides: number) => restFor(rides, "steady");

/**
 * The rest days Plan suggests for so many days in all, as Dream splits them at its default pace, so the two agree:
 * 7 days are 6 riding and 1 rest. When the rider's file sets the riding days (D70), by those instead.
 */
export const suggestedRest = (total: number, ownRides?: number) =>
  ownRides !== undefined ? suggestedRestDays(ownRides) : total - ridingDays(total, "steady");

export interface RestPlace {
  /** 0-1: how good a place it is to spend a day; 0 for a spot with no name (never in the middle of nowhere). */
  score: number;
  sights: Highlight[];
  /** "the Palais des Papes, the Pont d'Avignon and 2 more sights; a bike shop; a station" */
  text: string;
}

/** How good a stop is for a day off (D74), from what we know: never from guesses (D37). */
export function restPlace(data: PlanData, stop: Stop, sleep: Sleep, month: number): RestPlace {
  if (!stop.name) return { score: 0, sights: [], text: "" };
  const sights = (data.full?.highlights ?? [])
    .filter((h) => Math.abs(h.at_m - stop.at_m) <= SIGHTS_M && h.offset_m <= 3000)
    .sort((a, b) => b.rank - a.rank);
  const sightScore = Math.min(1, sights.reduce((a, h) => a + 0.4 + 0.4 * h.rank + (h.unesco ? 0.4 : 0), 0) / 3);
  const svc = stop.services;
  const services = ((svc.food ?? 0) > 0 ? 0.4 : 0) + ((svc.bike_shop ?? 0) > 0 ? 0.3 : 0) + (stop.station ? 0.3 : 0);
  const sec = data.dream.sections.find((s) => stop.at_m >= s.from_m && stop.at_m <= s.to_m);
  const theme = Math.min(1, Math.max(sec?.themes.culture?.score ?? 0, sec?.themes.heritage?.score ?? 0));
  let score = 0.35 * (TOWN[stop.place_kind ?? ""] ?? 0.1) + 0.35 * sightScore + 0.15 * services + 0.15 * theme;
  if (!usable(bedsFor(stop, sleep, month))) score *= 0.3;
  const names = sights.slice(0, 2).map((h) => h.name);
  const parts = [
    names.length ? `${names.join(sights.length > 2 ? ", " : " and ")}${sights.length > 2 ? ` and ${plural(sights.length - 2, "more sight")}` : ""}` : null,
    !names.length && (svc.food ?? 0) > 0 ? "places to eat" : null,
    (svc.bike_shop ?? 0) > 0 ? "a bike shop" : null,
    stop.station ? "a station" : null,
  ].filter((x): x is string => !!x);
  return { score, sights, text: parts.join("; ") };
}

/** How much the days before a night call for a rest (D74), with the reason in words. */
function recovery(days: DayEval[], r: number, usualHours: number, since: number): { score: number; text: string } {
  const d = days[r - 1]!;
  const run = days.slice(Math.max(0, r - 3), r);
  const hours = run.reduce((a, x) => a + x.hours, 0);
  const effort = d.effort === "beyond" ? 1 : d.effort === "harder" ? 0.6 : Math.max(0, Math.min(0.5, d.hours / usualHours - 0.5));
  const score = 0.6 * effort + 0.4 * Math.min(1, hours / (run.length * usualHours) / 1.2);
  const text =
    d.effort !== "within"
      ? `after ${d.effort === "beyond" ? "a day beyond your level" : "a hard day"} (${km(d.km)} km)`
      : run.length === 3 && run.every((x) => x.hours >= usualHours)
        ? "after three long days in a row"
        : `after ${plural(since, "riding day")}`;
  return { score, text };
}

export interface RestPick {
  /** The rest day follows this riding day (1-based). */
  afterRide: number;
  why: string;
  /** A better town within reach whose day stays within the rider's level: the night moves there (candidate index). */
  move?: number;
  /** A better town that would make the day harder than the rider's usual: offered as a call. */
  offer?: { c: number; km: number };
}

/**
 * The planner's rest days (D74), around the rider's own (`fixed`, never moved): `count` more, each with its reason.
 * `own` holds the candidate indices of the rider's own nights (D70), which never move to a better town.
 */
export function placeRests(
  data: PlanData,
  ctx: DayContext,
  stage: StagePlan,
  usualHours: number,
  fixed: Set<number>,
  count: number,
  own: Set<number> = new Set(),
): RestPick[] {
  const rides = stage.days.length;
  const C = ctx.candidates;
  const place = (r: number) => restPlace(data, C[stage.nights[r - 1]!]!.stop, ctx.sleep, monthOf(ctx.dayDate(r - 1)));
  const total = fixed.size + count;
  // Even spacing: the rider's own rest days take the ideal places nearest them.
  const ideals = Array.from({ length: total }, (_, i) => Math.round((rides * (i + 1)) / (total + 1)));
  for (const f of fixed) {
    const i = ideals.reduce((b, x, j) => (Math.abs(x - f) < Math.abs(ideals[b]! - f) ? j : b), 0);
    ideals.splice(i, 1);
  }
  const window = Math.max(2, Math.round(rides / (2 * (total + 1))));
  const taken = [...fixed];
  const picks: number[] = [];
  for (const ideal of ideals.slice(0, count)) {
    let best: number | null = null;
    for (const [gap, named] of [[MIN_APART, true], [2, true], [1, true], [1, false]] as const) {
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let r = 2; r <= rides - 1; r++) {
        if (taken.some((t) => Math.abs(t - r) < gap)) continue;
        const p = place(r);
        if (named && p.score === 0) continue;
        const dist = Math.abs(r - ideal);
        const s = 0.45 * recovery(stage.days, r, usualHours, r).score + 0.45 * p.score - 0.3 * (Math.max(0, dist - window) / window) - 0.05 * (dist / window);
        if (s > bestScore) {
          bestScore = s;
          best = r;
        }
      }
      if (best !== null) break;
    }
    if (best === null) break;
    taken.push(best);
    picks.push(best);
  }

  const all = [...taken].sort((a, b) => a - b);
  return picks
    .sort((a, b) => a - b)
    .map((r) => {
      const since = r - (all.filter((x) => x < r).pop() ?? 0);
      const pick: RestPick = { afterRide: r, why: restWhy(data, ctx, stage, usualHours, r, since) };
      // A clearly better town within reach (D74): moved to when that day stays within the rider's level, else offered.
      const s = stage.nights[r - 1]!;
      if (own.has(s)) return pick;
      const prevT = r >= 2 ? C[stage.nights[r - 2]!]!.t : 0;
      const last = r === rides - 1;
      const nextT = last ? ctx.axis.length : C[stage.nights[r]!]!.t;
      const here = place(r).score;
      let better: number | null = null;
      for (let j = 0; j < C.length; j++) {
        const c = C[j]!;
        if (j === s || c.t <= prevT || c.t >= nextT || Math.abs(c.t - C[s]!.t) > BETTER_M) continue;
        const p = restPlace(data, c.stop, ctx.sleep, monthOf(ctx.dayDate(r - 1)));
        if (p.score >= here + BETTER_BY && (better === null || p.score > restPlace(data, C[better]!.stop, ctx.sleep, monthOf(ctx.dayDate(r - 1))).score)) better = j;
      }
      if (better === null) return pick;
      const a = evalDay(ctx, r - 1, prevT, C[better]!.t, C[better]!.stop, false);
      const b = evalDay(ctx, r, C[better]!.t, nextT, last ? null : C[stage.nights[r]!]!.stop, last);
      if (a.effort === "within" && b.effort !== "beyond") pick.move = better;
      else pick.offer = { c: better, km: (C[better]!.t - C[s]!.t) / 1000 };
      return pick;
    });
}

/** Why a rest day is where it is (D74): "Rest at Avignon: after a hard day (98 km); the Palais des Papes; a station." */
export function restWhy(data: PlanData, ctx: DayContext, stage: StagePlan, usualHours: number, r: number, since: number): string {
  const stop = ctx.candidates[stage.nights[r - 1]!]!.stop;
  const p = restPlace(data, stop, ctx.sleep, monthOf(ctx.dayDate(r - 1)));
  const rec = recovery(stage.days, r, usualHours, since);
  return `Rest at ${stopName(stop)}: ${rec.text}${p.text ? `; ${p.text}` : ""}.`;
}
