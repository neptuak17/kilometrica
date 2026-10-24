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
import { planItems, STEEP } from "./items";
import { placeRests, restLengthOf, restWhy } from "./rest";
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
import { bedsKnown, km as kmText, MONTHS_LONG, plural, stopName } from "./text";
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
/** When a moved night makes a day beyond the level, up to this many nights each side of it are planned again (D85). */
const NEAR_NIGHTS = 3;
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

/** A better town for a rest day that would make a day harder than the rider's usual: offered as a call (D74). */
export interface RestOffer {
  afterRide: number;
  /** The night (0-based) that would move. */
  night: number;
  stop: Stop;
  /** Along the way from the planned stop: + on, − back. */
  km: number;
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
  /** Rest days in effect (D74): the rider's own and the planner's, after these riding days (1-based). */
  restAfter: number[];
  restOffers: RestOffer[];
  endDate: string;
}

function nearestStop(stops: Stop[], m: number): Stop | null {
  let best: Stop | null = null;
  for (const s of stops) if (!best || Math.abs(s.at_m - m) < Math.abs(best.at_m - m)) best = s;
  return best;
}

/**
 * A name for an end of the trip: the daily section on the trip's side of it that starts or ends there, as Dream names
 * a stretch, so the two agree; else a named stop within 5 km, a daily section's end within 3 km, else its km. `side`
 * says where the trip lies: at greater route measures than `m` ("after") or smaller ("before").
 */
export function placeName(data: PlanData, m: number, side?: "after" | "before"): string {
  const edge = data.daily.find((d) => (side === "after" ? Math.abs(d.from_m - m) < 1000 && d.start_name : side === "before" && Math.abs(d.to_m - m) < 1000 && d.end_name));
  if (edge) return (side === "after" ? edge.start_name : edge.end_name)!;
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
export function ownNights(data: Pick<FreeData, "userPlaces">, fromM: number, toM: number): UserPlace[] {
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

/**
 * The nights a rider's own file marks (D70), each with how many places of the rider's kind are known there (D86): as
 * Plan finds them, at the stop within OWN_NEAR_M of the waypoint, so Dream says what Plan will.
 */
export function ownNightBeds(
  data: Pick<FreeData, "userPlaces" | "stops">,
  fromM: number,
  toM: number,
  sleep: PlanInputs["sleep"],
  month: number,
): { name: string | null; at_m: number; count: number }[] {
  return ownNights(data, fromM, toM).map((w) => {
    let best: Stop | null = null;
    for (const s of data.stops.stops) {
      const d = Math.abs(s.at_m - w.at_m);
      if (d <= OWN_NEAR_M && (!best || d < Math.abs(best.at_m - w.at_m))) best = s;
    }
    // Named as Plan names the night: the stop's town, else the rider's own name for it.
    return { name: best?.name ?? w.name ?? null, at_m: w.at_m, count: best ? bedsFor(best, sleep, month).count : 0 };
  });
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
  const ownRest = new Set<string>();
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
    // A night the file marks as a rest ("Nelson, rest day") gets a rest day after it (D74).
    if (/\brest\b/i.test(`${w.name ?? ""} ${w.note ?? ""}`)) ownRest.add(best.stop.id);
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
  const fileRests = own.flatMap((i, k) => (ownRest.has(candidates[i]!.stop.id) ? [k + 1] : []));
  const rest = new Set([...inputs.restAfter, ...fileRests].filter((r) => r >= 1 && r < rides));
  const ownRests = new Set(rest);
  // A longer stay is several rest days in a row (D80); the planner's own rest days are one each.
  const restLen = (r: number) => (rest.has(r) ? restLengthOf(inputs, r) : 0);
  const dayDate = (k: number) => addDays(inputs.startDate, k + [...rest].filter((r) => r <= k).reduce((a, r) => a + restLen(r), 0));
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
  const kept = !!fixed && fixed.length === rides - 1 && fixed.every((i) => i !== undefined);
  // The nights before the rider moved one (D85): the others stay where they were, as long as that leaves no more days
  // beyond the level than planning them all again would. Failing that, the nights nearest it are planned again, one
  // more each side at a time; then those after it, or those before it; and only then all of them.
  let held = false;
  const prior = kept || own.length ? undefined : choices.keepNights?.map((id) => index.get(id));
  if (prior && prior.length === rides - 1 && prior.every((i) => i !== undefined)) {
    const nights = (prior as number[]).map((i, k) => locked.get(k) ?? i);
    const moved = nights.flatMap((i, k) => (i !== prior[k] ? [k] : []));
    if (moved.length && nights.every((i, k) => k === 0 || candidates[i]!.t > candidates[nights[k - 1]!]!.t)) {
      const beyond = (s: StagePlan) => s.days.filter((d) => d.effort === "beyond").length;
      // Planning them all again is worked out only when a try leaves a day beyond the level.
      let all: StagePlan | null | undefined;
      const allBeyond = () => {
        if (all === undefined) all = planStages(ctx, rides, locked);
        return all ? beyond(all) : Infinity;
      };
      const hold = (stays: (k: number) => boolean) => {
        const lock = new Map(locked);
        nights.forEach((i, k) => stays(k) && lock.set(k, i));
        return planStages(ctx, rides, lock);
      };
      const tries = [
        () => fixedStages(ctx, nights),
        ...Array.from({ length: NEAR_NIGHTS }, (_, j) => () => hold((k) => !moved.some((m) => Math.abs(m - k) <= j + 1))),
        () => hold((k) => k < Math.min(...moved)),
        () => hold((k) => k > Math.max(...moved)),
      ];
      for (const t of tries) {
        const s = t();
        if (s && (beyond(s) === 0 || beyond(s) <= allBeyond())) {
          stage = s;
          held = true;
          break;
        }
      }
      stage ??= all ?? null;
    }
  }
  if (own.length) {
    // The rider's nights, unless they moved one on its day card.
    const moved = own.map((i, k) => locked.get(k) ?? i);
    stage = fixedStages(ctx, moved.every((i, k) => k === 0 || i > moved[k - 1]!) ? moved : own);
  } else if (kept) {
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

  // Rest days (D74): the rider's own, then the planner's where they help most. A clearly better town nearby takes the
  // night when that day stays within the rider's level, else it's offered. The days after a rest day move a day on.
  const restOffers: RestOffer[] = [];
  const moved = new Map<number, { from: Stop; km: number }>();
  const ownDays = [...rest].reduce((a, r) => a + restLen(r), 0);
  const wanted = Math.min(Math.max(0, rides - 2 - rest.size), Math.max(0, (inputs.restDays ?? 0) - ownDays));
  if (wanted > 0) {
    const nights = [...stage.nights];
    for (const p of placeRests(data, ctx, stage, usual.hours, rest, wanted, new Set(own), choices.restStops)) {
      const k = p.afterRide - 1;
      if (p.move !== undefined && !own.length && !kept && !held && !locked.has(k)) {
        moved.set(p.afterRide, { from: candidates[nights[k]!]!.stop, km: (candidates[p.move]!.t - candidates[nights[k]!]!.t) / 1000 });
        nights[k] = p.move;
      } else if (p.offer) {
        restOffers.push({ afterRide: p.afterRide, night: k, stop: candidates[p.offer.c]!.stop, km: p.offer.km });
      }
      rest.add(p.afterRide);
    }
    ctx.sunsets = undefined;
    stage = fixedStages(ctx, nights);
  }
  const restAfter = [...rest].sort((a, b) => a - b);
  const restInfo = new Map(
    restAfter.map((r, i) => {
      const m = moved.get(r);
      const why = restWhy(data, ctx, stage, usual.hours, r, r - (restAfter[i - 1] ?? 0));
      const note = m ? ` The day ends here, ${kmText(Math.abs(m.km))} km ${m.km > 0 ? "past" : "before"} ${stopName(m.from)}.` : "";
      return [r, { why: why + note, own: ownRests.has(r) }];
    }),
  );

  // One more riding day, only when days are beyond the rider's level and it makes fewer of them so (D75): nothing is
  // said when every day is within it.
  const offers: DaysOffer[] = [];
  const beyondNow = stage.days.filter((d) => d.effort === "beyond").length;
  if (!choices.nights && !own.length && beyondNow) {
    const alt = planStages(ctx, rides + 1, new Map());
    const left = alt ? alt.days.filter((d) => d.effort === "beyond").length : beyondNow;
    if (alt && left < beyondNow) {
      offers.push({
        days: rides + 1,
        why: left ? `One more riding day: ${plural(beyondNow - left, "day")} fewer beyond your selected level` : "One more riding day keeps every day within your level",
        plan: alt,
      });
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
      startName: k === 0 ? placeName(data, axis.startM, axis.startM <= axis.endM ? "after" : "before") : stopName(candidates[stage.nights[k - 1]!]!.stop),
      stop,
      endName: stop ? stopName(stop) : placeName(data, axis.endM, axis.endM >= axis.startM ? "before" : "after"),
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
        const lengthKm = STEEP(level.level).km;
        const s = axis.steepest(t0, t1, lengthKm * 1000);
        return s ? { grade: s.grade, atKm: (s.t - t0) / 1000, lengthKm } : null;
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
      for (let j = 1; j <= restLen(k + 1); j++) {
        number += 1;
        days.push({
          ...days[days.length - 1]!,
          number,
          ride: null,
          date: addDays(date, j),
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
          rest: restInfo.get(k + 1),
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
    restAfter,
    restOffers,
    endDate: days[days.length - 1]!.date,
  };
  const items = planItems(data, partial, options.geometry);
  const brief = makeBrief(data, partial, items);
  return { ...partial, items, brief };
}

export type PlanCore = Omit<PlanResult, "items" | "brief">;

export { stopName, usable };
