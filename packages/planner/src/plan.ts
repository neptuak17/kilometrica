/**
 * Plan (11.6): from a stretch and the rider's inputs to days, nights, plan items and the trip brief.
 *
 * `makePlan` is pure and deterministic, so it doubles as the assistant's "what if" tool (D38): call it with other
 * inputs and nothing is saved.
 */
import type { RiderLevel, Stop, UserPlace } from "@dpg/contracts";
import { TripAxis } from "./axis";
import type { Geometry } from "./geometry";
import { makeBrief } from "./brief";
import { planItems } from "./items";
import { type Rider, riderFor, usualDay } from "./pace";
import {
  alternatives,
  bedsFor,
  type Candidate,
  type DayContext,
  fixedStages,
  planB,
  planStages,
  type StagePlan,
  usable,
} from "./stages";
import { addDays, monthOf, sunTimes } from "./sun";
import { bedsKnown, km as kmText, MONTHS_LONG, stopName } from "./text";
import {
  type Brief,
  type DayPlan,
  type FreeData,
  NO_CHOICES,
  type NightPlan,
  type PlanChoices,
  type PlanData,
  type PlanInputs,
  type PlanItem,
  type RouteRef,
} from "./types";

const END_MARGIN_M = 1000;
/** The rider's waypoint and one of our stops this close along the route are the same night (D70). */
const OWN_NEAR_M = 3000;
/** A waypoint the rider's file types as somewhere to sleep marks a night (D70). */
const NIGHT_WAYPOINT = /\b(lodging|hotel|motel|inn|hostel|camp|campsite|campground|camping|shelter|cabin|hut|bivouac|bivvy|overnight|accommodation)\b/i;
/** For a rider who camps, a stretch this long without a stop gets spots to wild camp about every 10 km (D70). */
const WILD_GAP_M = 20_000;
const WILD_STEP_M = 10_000;

export interface DaysOffer {
  days: number;
  why: string;
  plan: StagePlan;
}

/** Device settings that shape the plan's links, never part of the plan document. */
export interface PlanOptions {
  /** The rider's languages, best first (the browser's or phone's), for Wikipedia links. */
  languages?: string[];
  /** The route's lines, for street-level photo links at the heads-ups (D58). Without it, items carry none. */
  geometry?: Geometry;
}

export interface PlanResult {
  route: RouteRef;
  languages: string[];
  inputs: PlanInputs;
  choices: PlanChoices;
  mode: "free" | "full";
  level: RiderLevel;
  rider: Rider;
  usual: { km: number; climbM: number; hours: number };
  axis: TripAxis;
  candidates: Candidate[];
  days: DayPlan[];
  nights: NightPlan[];
  items: PlanItem[];
  brief: Brief;
  offers: DaysOffer[];
  endDate: string;
}

function nearestStop(stops: Stop[], m: number): Stop | null {
  let best: Stop | null = null;
  for (const s of stops) if (!best || Math.abs(s.at_m - m) < Math.abs(best.at_m - m)) best = s;
  return best;
}

/** A name for a place on the route: a named stop within 5 km, a daily section's end, else its km. */
export function placeName(data: PlanData, m: number): string {
  let best: Stop | null = null;
  for (const s of data.stops.stops) {
    if (!s.name || Math.abs(s.at_m - m) > 5000) continue;
    if (!best || Math.abs(s.at_m - m) < Math.abs(best.at_m - m)) best = s;
  }
  if (best?.name) return best.name;
  for (const d of data.daily) {
    if (Math.abs(d.from_m - m) < 3000 && d.start_name) return d.start_name;
    if (Math.abs(d.to_m - m) < 3000 && d.end_name) return d.end_name;
  }
  return `km ${Math.round(m / 1000)}`;
}

/** "12 km from Tulameen": a spot between stops, by the nearest named one (D70), never "near km 293". */
function fromName(data: FreeData, m: number): string {
  let best: Stop | null = null;
  for (const s of data.stops.stops) if (s.name && (!best || Math.abs(s.at_m - m) < Math.abs(best.at_m - m))) best = s;
  if (!best?.name) return `km ${Math.round(m / 1000)}`;
  const d = Math.round(Math.abs(best.at_m - m) / 1000);
  return d < 1 ? `near ${best.name}` : `${d} km from ${best.name}`;
}

/** The nights the rider's file marks on the stretch (D70), in route order, one per place. */
export function ownNights(data: FreeData, fromM: number, toM: number): UserPlace[] {
  const lo = Math.min(fromM, toM) + END_MARGIN_M;
  const hi = Math.max(fromM, toM) - END_MARGIN_M;
  const out: UserPlace[] = [];
  for (const w of [...(data.userPlaces ?? [])].sort((a, b) => a.at_m - b.at_m)) {
    if (w.at_m <= lo || w.at_m >= hi || !NIGHT_WAYPOINT.test(`${w.kind} ${w.note ?? ""}`)) continue;
    if (out.length && w.at_m - out[out.length - 1]!.at_m < OWN_NEAR_M) continue;
    out.push(w);
  }
  return out;
}

function pseudoStop(id: string, m: number, near: Stop | null): Stop {
  return {
    id,
    name: null,
    near: null,
    place_kind: null,
    at_m: m,
    lon: near?.lon ?? 0,
    lat: near?.lat ?? 0,
    country: near?.country ?? null,
    time_zone: near?.time_zone ?? null,
    detour_m: null,
    beds: [],
    services: {},
    station: null,
    station_at_m: null,
  };
}

export function makePlan(
  data: PlanData,
  inputs: PlanInputs,
  choices: PlanChoices = NO_CHOICES,
  options: PlanOptions = {},
): PlanResult {
  const levels = data.dream.levels;
  const level = levels.find((l) => l.level === inputs.level) ?? levels[2] ?? levels[0]!;
  const rider = riderFor(level.level, inputs.bike);
  const usual = usualDay(rider, level.km_min, level.km_max, level.climb_max_m);
  const month0 = monthOf(inputs.startDate);
  const axis = new TripAxis(data.effort, inputs.fromM, inputs.toM, inputs.direction, rider, data.dream.sections, (s) =>
    s.climate ? (s.climate.wind_along_ms[month0] ?? null) : null,
  );
  const lo = Math.min(inputs.fromM, inputs.toM) + END_MARGIN_M;
  const hi = Math.max(inputs.fromM, inputs.toM) - END_MARGIN_M;
  const candidates: Candidate[] = data.stops.stops
    .filter((s) => s.at_m > lo && s.at_m < hi)
    .map((stop) => ({ stop, t: axis.tOf(stop.at_m) }))
    .sort((a, b) => a.t - b.t || a.stop.id.localeCompare(b.stop.id));

  // The nights the rider's file marks (D70): one of our stops when it's close, else the waypoint itself.
  const ownName = new Map<string, string | null>();
  for (const w of inputs.stops === "ours" ? [] : ownNights(data, inputs.fromM, inputs.toM)) {
    let best: Candidate | null = null;
    for (const c of candidates) {
      const d = Math.abs(c.stop.at_m - w.at_m);
      if (d <= OWN_NEAR_M && (!best || d < Math.abs(best.stop.at_m - w.at_m))) best = c;
    }
    if (!best) {
      const stop = pseudoStop(`own-${w.id}`, w.at_m, nearestStop(data.stops.stops, w.at_m));
      best = { stop: { ...stop, name: w.name, near: w.name ? null : fromName(data, w.at_m), lon: w.lon, lat: w.lat }, t: axis.tOf(w.at_m) };
      candidates.push(best);
    } else if (!best.stop.name && w.name) {
      // Our stop has no town name ("69 km from Midway"): the rider's name for it reads better (D70).
      best.stop = { ...best.stop, name: w.name, near: null };
    }
    if (!ownName.has(best.stop.id)) ownName.set(best.stop.id, w.name);
  }
  // Spots to wild camp for a rider who camps, where stops are far apart (D69, D70): used only when they spare a day
  // beyond the rider's level (WILD_CAMP_COST).
  if (inputs.sleep !== "rooms" && !ownName.size) {
    const ts = [0, ...candidates.map((c) => c.t), axis.length];
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i]! - ts[i - 1]!;
      if (gap < WILD_GAP_M) continue;
      const n = Math.max(1, Math.round(gap / WILD_STEP_M) - 1);
      for (let s = 1; s <= n; s++) {
        const t = ts[i - 1]! + (gap * s) / (n + 1);
        const m = axis.mOf(t);
        const stop = pseudoStop(`wild-${Math.round(m)}`, m, nearestStop(data.stops.stops, m));
        candidates.push({ stop: { ...stop, near: fromName(data, m) }, t });
      }
    }
  }
  candidates.sort((a, b) => a.t - b.t || a.stop.id.localeCompare(b.stop.id));
  const own = candidates.flatMap((c, i) => (ownName.has(c.stop.id) ? [i] : []));

  const rides = own.length ? own.length + 1 : Math.max(1, Math.round(inputs.days));
  const rest = new Set(inputs.restAfter.filter((r) => r >= 1 && r < rides));
  const dayDate = (k: number) => addDays(inputs.startDate, k + [...rest].filter((r) => r <= k).length);
  const endStop = nearestStop(data.stops.stops, axis.endM);
  const ctx: DayContext = {
    axis,
    candidates,
    level,
    usualHours: usual.hours,
    sleep: inputs.sleep,
    startMinutes: inputs.startMinutes,
    stopStyle: inputs.stopStyle,
    dayDate,
    end: { lat: endStop?.lat ?? 0, lon: endStop?.lon ?? 0, country: endStop?.country ?? null, timeZone: endStop?.time_zone },
  };
  const index = new Map(candidates.map((c, i) => [c.stop.id, i]));
  const locked = new Map<number, number>();
  for (const [k, id] of Object.entries(choices.locked)) {
    const i = index.get(id);
    if (i !== undefined && Number(k) < rides - 1) locked.set(Number(k), i);
  }

  let stage: StagePlan | null = null;
  const fixed = choices.nights?.map((id) => index.get(id));
  if (own.length) {
    // The rider's nights, unless they moved one on its day card.
    const moved = own.map((i, k) => locked.get(k) ?? i);
    stage = fixedStages(ctx, moved.every((i, k) => k === 0 || i > moved[k - 1]!) ? moved : own);
  } else if (fixed && fixed.length === rides - 1 && fixed.every((i) => i !== undefined)) {
    stage = fixedStages(ctx, fixed as number[]);
  }
  stage ??= planStages(ctx, rides, locked);
  if (!stage) {
    // No stop of the rider's kind within reach: nights go where the days split evenly, with no known bed there.
    for (let k = 0; k < rides - 1; k++) {
      const t = (axis.length * (k + 1)) / rides;
      const m = axis.mOf(t);
      candidates.push({ stop: pseudoStop(`none-${k + 1}`, m, nearestStop(data.stops.stops, m)), t });
    }
    candidates.sort((a, b) => a.t - b.t);
    const ids = candidates.map((c) => c.stop.id);
    stage = fixedStages(
      ctx,
      Array.from({ length: rides - 1 }, (_, k) => ids.indexOf(`none-${k + 1}`)),
    );
  }

  // A day more or fewer, when it makes the plan clearly better (D48: Dream's number by default).
  const offers: DaysOffer[] = [];
  if (!choices.nights && !own.length) {
    const score = (p: StagePlan) => ({
      beyond: p.days.filter((d) => d.effort === "beyond").length,
      dark: p.days.filter((d) => d.afterSunset).length,
      cost: p.cost,
    });
    const now = score(stage);
    for (const n of [rides + 1, rides - 1]) {
      if (n < 1 || n > rides * 2) continue;
      const alt = planStages(ctx, n, new Map());
      if (!alt) continue;
      const s = score(alt);
      const fewerHard = s.beyond < now.beyond || (s.beyond === now.beyond && s.dark < now.dark);
      if (n > rides && fewerHard) {
        const what = s.beyond < now.beyond ? "no day beyond your level" : "no day ending after sunset";
        offers.push({ days: n, why: `${n} riding days instead of ${rides}: ${what}`, plan: alt });
      } else if (n < rides && s.beyond <= now.beyond && s.dark <= now.dark && s.cost < now.cost * 0.75) {
        offers.push({ days: n, why: `${n} riding days instead of ${rides}: days closer to your usual`, plan: alt });
      }
    }
  }

  // Calendar days, with rest days.
  const days: DayPlan[] = [];
  const nightsOut: NightPlan[] = [];
  let number = 0;
  for (let k = 0; k < rides; k++) {
    const d = stage.days[k]!;
    const stats = d.stats!;
    const t0 = k === 0 ? 0 : candidates[stage.nights[k - 1]!]!.t;
    const t1 = k === rides - 1 ? axis.length : candidates[stage.nights[k]!]!.t;
    const stop = k === rides - 1 ? null : candidates[stage.nights[k]!]!.stop;
    const date = dayDate(k);
    const where = stop ?? endStop;
    const sun = sunTimes(date, where?.lat ?? 0, where?.lon ?? 0, where?.country ?? null, where?.time_zone);
    const fromM = axis.mOf(t0);
    const toM = axis.mOf(t1);
    number += 1;
    days.push({
      number,
      ride: k + 1,
      date,
      kind: "ride",
      fromT: t0,
      toT: t1,
      fromM: k === 0 ? axis.startM : fromM,
      toM: k === rides - 1 ? axis.endM : toM,
      startName: k === 0 ? placeName(data, axis.startM) : stopName(candidates[stage.nights[k - 1]!]!.stop),
      stop,
      endName: stop ? stopName(stop) : placeName(data, axis.endM),
      km: stats.km,
      climbM: stats.climbM,
      unknownKm: stats.unknownKm,
      hoursFast: stats.fastS / 3600,
      hoursSlow: stats.slowS / 3600,
      stopsMin: d.endMinutes - inputs.startMinutes - stats.slowS / 60,
      startMinutes: inputs.startMinutes,
      endMinutes: d.endMinutes,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      clockApprox: sun.approximate,
      effort: d.effort,
      surfaces: stats.surfaces,
      gaps: stats.gaps,
      tailwindMs: stats.tailwindMs,
      steepest: (() => {
        const s = axis.steepest(t0, t1);
        return s ? { grade: s.grade, atKm: (s.t - t0) / 1000 } : null;
      })(),
      sections: stats.sections,
    });
    if (stop) {
      const ci = stage.nights[k]!;
      const b = bedsFor(stop, inputs.sleep, monthOf(date));
      const alts = alternatives(ctx, stage, k).map((a) => ({
        stop: candidates[a.c]!.stop,
        dayKm: a.dayKm,
        nextKm: a.nextKm,
      }));
      const pb = planB(ctx, stage, k);
      const shift = (j: number | null) =>
        j === null ? null : { stop: candidates[j]!.stop, km: (candidates[j]!.t - candidates[ci]!.t) / 1000 };
      const mine = ownName.has(stop.id) ? { name: ownName.get(stop.id) ?? null } : null;
      const bedText = bedsKnown({ ...b, count: b.count - b.closed }, MONTHS_LONG[monthOf(date)]!, inputs.sleep, !!mine);
      const extras = [
        (stop.services.food ?? 0) > 0 ? "food" : null,
        stop.station ? "a station" : null,
      ].filter(Boolean);
      const yours = mine ? ` (your stop${mine.name && mine.name !== stop.name ? `: ${mine.name}` : ""})` : "";
      const at = `Stopping ${stop.name ? `at ${stop.name}` : stopName(stop)}${yours}`;
      // No known campsite in reach for a rider who camps (D69, D70): their call, never ours.
      const on = shift(pb.after);
      const wildCamp =
        inputs.sleep !== "rooms" && !mine && !usable(b)
          ? `Wild camp if it's feasible and allowed (your call)${on ? `, push on to ${stopName(on.stop)}, ${kmText(on.km)} km more, for a longer day than your usual` : ""}, or change the plan.`
          : null;
      const dayText = `makes a ${kmText(stats.km)} km day.`;
      nightsOut.push({
        index: k,
        date,
        afterRide: k + 1,
        stop,
        locked: locked.get(k) === ci,
        beds: { count: b.count - b.closed, open: b.open, partly: b.partly, closed: b.closed, unknown: b.unknown, unmanaged: b.unmanaged, kinds: b.kinds },
        alternatives: alts,
        planB: { before: shift(pb.before), after: shift(pb.after) },
        why: `${at}: ${bedText}${extras.length ? `; ${extras.join(" and ")}` : ""}; ${dayText}`,
        whyOther: `${at}: ${extras.length ? `${extras.join(" and ")}; ` : ""}${dayText}`,
        own: mine,
        wildCamp,
      });
      if (rest.has(k + 1)) {
        number += 1;
        days.push({
          ...days[days.length - 1]!,
          number,
          ride: null,
          date: addDays(date, 1),
          kind: "rest",
          fromT: t1,
          toT: t1,
          fromM: toM,
          toM,
          startName: stopName(stop),
          endName: stopName(stop),
          km: 0,
          climbM: 0,
          unknownKm: 0,
          hoursFast: 0,
          hoursSlow: 0,
          stopsMin: 0,
          endMinutes: inputs.startMinutes,
          effort: "within",
          surfaces: { r: 0, c: 0, g: 0, u: 0 },
          gaps: [],
          tailwindMs: null,
          steepest: null,
        });
      }
    }
  }

  const partial = {
    route: data.route,
    languages: options.languages?.length ? options.languages : ["en"],
    inputs,
    choices,
    mode: data.full ? ("full" as const) : ("free" as const),
    level,
    rider,
    usual,
    axis,
    candidates,
    days,
    nights: nightsOut,
    offers,
    endDate: days[days.length - 1]!.date,
  };
  const items = planItems(data, partial, options.geometry);
  const brief = makeBrief(data, partial, items);
  return { ...partial, items, brief };
}

export type PlanCore = Omit<PlanResult, "items" | "brief">;

export { stopName, usable };
