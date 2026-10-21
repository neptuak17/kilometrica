/**
 * What a day card and its trip-book page say about one day (11.6, D55), worked out once for both: water and food by
 * km and the longest gap, the bail-out stations, and where to sleep: the places at the night's stop and the other
 * options nearby (D72), never ranked by quality (we have no prices or reviews). Where places didn't load, nothing is
 * "none" (D37).
 */
import type { Place } from "@dpg/contracts";
import { type DayPlan, km, MONTHS_LONG, monthOf, type NightOptions, nightOptions, type NightPlan, type PlanData, type PlanResult, placeKind, placesMissing } from "@dpg/planner";

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
        .filter((s, i, all) => !s.p.name || all.findIndex((x) => x.p.name === s.p.name) === i);
  const options = !free && night ? nightOptions(data, plan, night) : null;
  const beds = options?.here ?? [];
  const bedsUnloaded = !!night && !!data.full && placesMissing(data.full, night.stop.at_m - 5000, night.stop.at_m + 5000).length > 0;
  const month = night ? MONTHS_LONG[monthOf(night.date)]! : "";
  const others = options
    ? [
        ...options.others.map((o) => `${o.place.name ?? "Unnamed"} (${placeKind(o.place)}), ${km(Math.abs(o.km))} km ${o.km >= 0 ? "on" : "back"}`),
        ...(options.wildCamp ? ["a wild camp, if it's allowed and feasible"] : []),
      ].join(" · ")
    : "";
  return { night, kmOf, unloaded, waterFood, thinned, longest, stations, beds, options, bedsUnloaded, month, others };
}
