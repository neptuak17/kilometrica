/**
 * What a day card and its trip-book page say about one day (11.6, D55), worked out once for both: water and food by
 * km and the longest gap, the bail-out stations, the places to stay at the night's stop (open first, then by detour,
 * never by quality: we have no prices or reviews) and the plan B. Where places didn't load, nothing is "none" (D37).
 */
import type { Place } from "@dpg/contracts";
import { type DayPlan, km, MONTHS_LONG, monthOf, type NightPlan, type PlanData, type PlanResult, placesMissing, stopName } from "@dpg/planner";

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
  /** Places to stay of the rider's kind at the night's stop, not known closed, open first then nearest. */
  beds: Place[];
  /** The night's stop is in a part whose places didn't load. */
  bedsUnloaded: boolean;
  /** The night's month, spelled out. */
  month: string;
  /** "Frontignan, 14 km back · Sète, 9 km on", or empty. */
  planB: string;
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
  const beds =
    !free && night
      ? (data.full?.places ?? [])
          .filter(
            (p) =>
              p.service === "accommodation" &&
              p.counts &&
              Math.abs(p.access_at_m - night.stop.at_m) <= 5000 &&
              (plan.inputs.sleep === "mix" || (plan.inputs.sleep === "camping") === (p.kind === "campsite")) &&
              p.months[monthOf(night.date)] !== "c",
          )
          .sort((a, b) => {
            const known = (p: Place) => (["o", "p"].includes(p.months[monthOf(night.date)] ?? "?") ? 0 : 1);
            return known(a) - known(b) || (a.access_m ?? 0) - (b.access_m ?? 0);
          })
      : [];
  const bedsUnloaded = !!night && !!data.full && placesMissing(data.full, night.stop.at_m - 5000, night.stop.at_m + 5000).length > 0;
  const month = night ? MONTHS_LONG[monthOf(night.date)]! : "";
  const planB = night
    ? [
        night.planB.before && `${stopName(night.planB.before.stop)}, ${km(Math.abs(night.planB.before.km))} km back`,
        night.planB.after && `${stopName(night.planB.after.stop)}, ${km(night.planB.after.km)} km on`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return { night, kmOf, unloaded, waterFood, thinned, longest, stations, beds, bedsUnloaded, month, planB };
}
