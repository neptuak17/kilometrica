/**
 * What the screens say about one day and about a whole plan, worked out once for the day card, its trip-book page
 * (11.6, D55) and the assistant's tools (A2, D77): water and food by km and the longest gap, the bail-out stations,
 * where to sleep (the places at the night's stop and the other options nearby, D72, never ranked by quality: we have
 * no prices or reviews), a rest day's town (D74), and the figures Compare sets side by side. Where places didn't load,
 * nothing is "none" (D37).
 */
import type { Highlight, Place, Stop } from "@dpg/contracts";
import { type NightOptions, nightOptions } from "./items";
import type { PlanResult } from "./plan";
import { restPlace } from "./rest";
import { dayIndex, monthOf } from "./sun";
import { hours, km, listable, MONTHS_LONG, placeKind, placeTitle, stopName } from "./text";
import { type DayPlan, type NightPlan, type PlanData, placesMissing } from "./types";

export interface DayFacts {
  /** The night after this day; none on a rest day or the last day. */
  night: NightPlan | undefined;
  /** Km of the day at a route measure. */
  kmOf: (m: number) => number;
  /** Parts of the day, in its km, whose places didn't load. */
  unloaded: [number, number][];
  /** Water and food along the day, by km; `thinned` keeps one every 5 km for a short list. */
  waterFood: { p: Place; at: number }[];
  thinned: { p: Place; at: number }[];
  longest: number;
  /** Train stations within 10 km that carry bikes. */
  stations: { p: Place; at: number }[];
  /** Places to stay at the night's stop, not known closed: the rider's kind first, then open, then nearest (D72). */
  beds: Place[];
  /** The other options nearby and wild camping (D72). */
  options: NightOptions | null;
  /** The night's stop is in a part whose places didn't load. */
  bedsUnloaded: boolean;
  /** The night's month, spelled out. */
  month: string;
  /** The other options in words, for the trip book: "Otter Lake Provincial Park (BC Parks campground), 5.5 km back · …". */
  others: string;
}

export function dayPlaces(data: PlanData, d: DayPlan, services: string[], counting = true): Place[] {
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  return (data.full?.places ?? []).filter((p) => services.includes(p.service) && (!counting || p.counts) && p.access_at_m >= lo && p.access_at_m <= hi);
}

export function dayFacts(plan: PlanResult, data: PlanData, d: DayPlan, free: boolean): DayFacts {
  const night = plan.nights.find((n) => n.afterRide === d.ride && d.kind === "ride");
  const kmOf = (m: number) => Math.max(0, (plan.axis.tOf(m) - d.fromT) / 1000);
  const unloaded = (data.full ? placesMissing(data.full, Math.min(d.fromM, d.toM), Math.max(d.fromM, d.toM)) : []).map(
    (r) => [kmOf(r.fromM), kmOf(r.toM)].sort((a, b) => a - b).map((x) => Math.round(Math.min(x, d.km))) as [number, number],
  );
  const waterFood = free ? [] : dayPlaces(data, d, ["water", "food"]).map((p) => ({ p, at: kmOf(p.access_at_m) })).sort((a, b) => a.at - b.at);
  const thinned: { p: Place; at: number }[] = [];
  for (const w of waterFood) if (!thinned.length || w.at - thinned[thinned.length - 1]!.at >= 5) thinned.push(w);
  let longest = 0;
  const pts = [0, ...waterFood.map((w) => w.at), d.km];
  for (let i = 1; i < pts.length; i++) longest = Math.max(longest, pts[i]! - pts[i - 1]!);
  // Bail-outs are trains (D63): ferry landings aren't, and a station listed twice (both platforms) counts once.
  const stations = free
    ? []
    : dayPlaces(data, d, ["station"], false)
        .filter((p) => p.kind !== "ferry_terminal" && ["yes", "reservation", "limited"].includes(String(p.detail.bikes)) && (p.access_m ?? 1e9) <= 10_000)
        .map((p) => ({ p, at: kmOf(p.access_at_m) }))
        .sort((a, b) => a.at - b.at)
        .filter((s, i, all) => !!s.p.name && all.findIndex((x) => x.p.name === s.p.name) === i);
  const options = !free && night ? nightOptions(data, plan, night) : null;
  const beds = options?.here ?? [];
  const bedsUnloaded = !!night && !!data.full && placesMissing(data.full, night.stop.at_m - 5000, night.stop.at_m + 5000).length > 0;
  const month = night ? MONTHS_LONG[monthOf(night.date)]! : "";
  const others = options
    ? [
        ...options.others.map((o) => `${placeTitle(o.place, o.stop ? stopName(o.stop) : null)} (${placeKind(o.place)}), ${km(Math.abs(o.km))} km ${o.km >= 0 ? "on" : "back"}`),
        ...(options.wildCamp ? ["a wild camp, if it's allowed and feasible"] : []),
      ].join(" · ")
    : "";
  return { night, kmOf, unloaded, waterFood, thinned, longest, stations, beds, options, bedsUnloaded, month, others };
}

export interface RestFacts {
  /** The rest day follows this riding day (1-based). */
  afterRide: number;
  stop: Stop;
  /** Sights within 5 km, best first (D74). */
  sights: Highlight[];
  /** Places to eat within 3 km: open that day first (from their published hours), then nearest. */
  food: { p: Place; open: boolean | null }[];
  /** What else is in town: "12 places to eat", "a bike shop", "Station: Avignon Centre". */
  services: string[];
  /** Other nights within 3 riding days either way, best for a rest day first, the current one included. */
  moves: { afterRide: number; stop: Stop; text: string; score: number; current: boolean }[];
}

/** What a rest day's card says (D74): what to see and eat in town, what else is there, and where it could move. */
export function restFacts(plan: PlanResult, data: PlanData, d: DayPlan): RestFacts | null {
  const before = plan.days.filter((x) => x.number < d.number && x.kind === "ride").pop();
  const stop = d.stop;
  if (!before?.ride || !stop) return null;
  const afterRide = before.ride;
  const month = monthOf(d.date);
  const near = (m: number, r: number) => Math.abs(m - stop.at_m) <= r;
  const di = dayIndex(d.date);
  const food = (data.full?.places ?? [])
    .filter((p) => p.service === "food" && p.counts && listable(p) && near(p.access_at_m, 3000))
    .map((p) => ({ p, open: typeof p.detail.days === "string" ? (p.detail.days as string)[di] === "o" : null }))
    .filter((x) => x.open !== false)
    .sort((a, b) => Number(b.open === true) - Number(a.open === true) || (a.p.access_m ?? 0) - (b.p.access_m ?? 0))
    .slice(0, 6);
  const s = stop.services;
  const services = [
    s.food ? `${s.food} places to eat` : null,
    s.bike_shop ? `${s.bike_shop === 1 ? "a bike shop" : `${s.bike_shop} bike shops`}` : null,
    s.pharmacy ? `${s.pharmacy === 1 ? "a pharmacy" : `${s.pharmacy} pharmacies`}` : null,
    s.atm ? `${s.atm === 1 ? "a cash machine" : `${s.atm} cash machines`}` : null,
    stop.station ? `Station: ${stop.station}` : null,
  ].filter((x): x is string => !!x);
  const rides = plan.days.filter((x) => x.kind === "ride").length;
  const moves = plan.nights
    .filter((n) => Math.abs(n.afterRide - afterRide) <= 3 && n.afterRide < rides && (n.afterRide === afterRide || !plan.restAfter.includes(n.afterRide)))
    .map((n) => {
      const p = restPlace(data, n.stop, plan.inputs.sleep, month);
      return { afterRide: n.afterRide, stop: n.stop, text: p.text, score: p.score, current: n.afterRide === afterRide };
    })
    .sort((a, b) => b.score - a.score);
  return { afterRide, stop, sights: restPlace(data, stop, plan.inputs.sleep, month).sights.slice(0, 6), food, services, moves };
}

/** What Compare sets side by side for a plan (11.6): days, the hardest day, total hours, nights, calls, busy km. */
export function planFigures(p: PlanResult) {
  const rides = p.days.filter((d) => d.kind === "ride");
  const hardest = [...rides].sort((a, b) => b.hoursSlow - a.hoursSlow)[0]!;
  const busy = p.items
    .filter((i) => i.id.startsWith("finding:") && i.title.includes("busy roads"))
    .reduce((a, i) => a + Math.abs((i.toM ?? 0) - (i.fromM ?? 0)) / 1000, 0);
  return {
    days: `${p.days.length} (${rides.length} riding)`,
    hardest: `Day ${hardest.number}: ${km(hardest.km)} km, ${hours(hardest.hoursSlow)}`,
    hours: hours(rides.reduce((a, d) => a + d.hoursSlow, 0)),
    beyond: String(rides.filter((d) => d.effort === "beyond").length),
    nights: String(p.nights.filter((n) => n.beds.open + n.beds.partly === 0).length),
    calls: String(p.items.filter((i) => i.kind === "call").length),
    busy: p.mode === "full" ? `${km(busy)} km` : "with a Trip Pass",
  };
}
