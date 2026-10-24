/**
 * Dream on one route (11.7): the stretches that fit the rider's question, a stretch picked from town to town, and the
 * link that opens one in Plan. Dream's page and the assistant's tools (A2, D77) both work from these, so the chat and
 * the screen always agree.
 */
import type { DailySection, DreamFile, StopsFile, UserPlace } from "@dpg/contracts";
import { ownNightBeds, ownNights, ridingDays } from "@dpg/planner";
import { and, type Ask, planHref, type Point, pointsOf } from "./ask";
import { describeStretch, findStretches, type StretchResult } from "./matchmaker";

/** A route's Dream files: what Dream's page loads, and what the assistant's Dream tools see. */
export interface DreamRoute {
  /** "eurovelo/ev8", or "user/u4a8fece911" for a rider's own file. */
  id: string;
  name: string;
  dream: DreamFile;
  daily: DailySection[];
  /** Waypoints from a rider's own file, for the nights it marks (D70). */
  userPlaces: UserPlace[];
  /** A rider's own file is the trip (D76). */
  own: boolean;
  /** Its stops, for a rider's own file: whether its nights have a place to stay (D86). */
  stops?: StopsFile | null;
}

export const sectionsOf = (r: DreamRoute) => [...r.dream.sections].sort((x, y) => x.from_m - y.from_m);

/** The towns between daily sections, where a stretch can start or end. */
export const routePoints = (r: DreamRoute): Point[] => pointsOf(sectionsOf(r), new Map(r.daily.map((d) => [d.number, d])));

/** Where a stretch lies on the route, in route metres. */
export function spanOf(r: DreamRoute, s: StretchResult) {
  const by = new Map(r.dream.sections.map((x) => [x.number, x]));
  return { fromM: by.get(s.first)?.from_m ?? 0, toM: by.get(s.last)?.to_m ?? 0 };
}

const nightsIn = (r: DreamRoute, fromM: number, toM: number) => (r.own ? ownNights(r, fromM, toM).length : 0);

/** The question as the matchmaker takes it: the town to pass through placed on the route (D80). */
function query(r: DreamRoute, a: Ask) {
  const p = a.through ? routePoints(r).find((x) => x.name.toLowerCase() === a.through!.toLowerCase()) : undefined;
  return { ...a, through: p ? { m: p.m, name: p.name } : null };
}

/** Whether the rider's file marks nights on the whole route (D70). */
export function fileNights(r: DreamRoute): boolean {
  const secs = sectionsOf(r);
  return secs.length > 0 && nightsIn(r, secs[0]!.from_m, secs[secs.length - 1]!.to_m) > 0;
}

/**
 * A stretch's riding days: the rider's, or until they set theirs, the nights their file marks, as in Plan (D70, D78);
 * with neither, null (a usual day at the level).
 */
export function ridesFor(r: DreamRoute, a: Ask, fromM: number, toM: number): number | null {
  if (a.days !== null) return ridingDays(a.days, a.pace);
  const nights = nightsIn(r, fromM, toM);
  return nights ? nights + 1 : null;
}

/**
 * Every stretch that fits, best first (the search's own cap lifted); a rider's own route is the trip, once the level
 * is set (D76). None until the level and, on a network route, the days are given: nothing is assumed.
 */
export function stretchesFor(r: DreamRoute, a: Ask): StretchResult[] {
  const secs = sectionsOf(r);
  if (a.level === null || !secs.length) return [];
  if (r.own) {
    const days = ridesFor(r, a, secs[0]!.from_m, secs[secs.length - 1]!.to_m);
    const whole = describeStretch(r.dream, secs[0]!.number, secs[secs.length - 1]!.number, { ...query(r, a), level: a.level, days });
    return whole ? [whole] : [];
  }
  return a.days === null ? [] : findStretches(r.dream, { ...query(r, a), level: a.level, days: ridingDays(a.days, a.pace), limit: 1000 });
}

/** A stretch from one point to another (`routePoints` indices), ridden from the first: described, never ruled out. */
export function pickedStretch(r: DreamRoute, a: Ask, i: number, j: number): StretchResult | null {
  const secs = sectionsOf(r);
  if (a.level === null || i === j || !secs[Math.min(i, j)] || !secs[Math.max(i, j) - 1]) return null;
  // Point i is the start of sections[i] (the last point is the end of the last section).
  const from = i < j ? secs[i]!.number : secs[i - 1]!.number;
  const to = i < j ? secs[j - 1]!.number : secs[j]!.number;
  const days = ridesFor(r, a, secs[Math.min(i, j)]!.from_m, secs[Math.max(i, j) - 1]!.to_m);
  return describeStretch(r.dream, from, to, { ...query(r, a), level: a.level, days });
}

/** The riding days a usual day at the rider's level would take on a stretch: shown beside the file's nights (D80). */
export function usualRides(r: DreamRoute, a: Ask, s: StretchResult): number | null {
  if (a.level === null) return null;
  return describeStretch(r.dream, s.first, s.last, { ...query(r, a), level: a.level, days: null })?.days ?? null;
}

/**
 * Where a stretch's days come from until the rider sets theirs: the file's nights, with the days a usual day at the
 * level would take beside them (D80); else a usual day at the level.
 */
export function daysNote(r: DreamRoute, a: Ask, s: StretchResult): string {
  const { fromM, toM } = spanOf(r, s);
  const level = r.dream.levels.find((l) => l.level === a.level)?.name ?? "";
  const usual = usualRides(r, a, s);
  return nightsIn(r, fromM, toM) && usual !== null
    ? `Your file's nights: ${s.days} riding days · at a usual ${level} day: ${usual}. Set your days above and we find the stops instead.`
    : "The days are those of a usual day at your level; set your days above to change them.";
}

/**
 * For a file that marks its nights, on its own stops (D70, D86): which have a place of the rider's kind, as Plan will
 * find them. "Campsites near 6 of your 10 nights; none known near Tulameen, Bankeir, Beaverdell and New Denver."
 */
export function nightsNote(r: DreamRoute, a: Ask, s: StretchResult): string | null {
  if (!r.own || !r.stops || a.days !== null) return null;
  const { fromM, toM } = spanOf(r, s);
  const sleep = a.stay === "camping" ? "camping" : a.stay === "rooms" ? "rooms" : "mix";
  const nights = ownNightBeds({ userPlaces: r.userPlaces, stops: r.stops }, fromM, toM, sleep, a.month ?? s.month ?? 6);
  if (!nights.length) return null;
  const what = sleep === "camping" ? "Campsites" : sleep === "rooms" ? "Rooms" : "Places to stay";
  const none = nights.filter((n) => n.count === 0).map((n) => n.name ?? `km ${Math.round(n.at_m / 1000)}`);
  if (!none.length) return `${what} near every one of your ${nights.length} nights.`;
  const names = none.length <= 4 ? and(none) : `${none.slice(0, 3).join(", ")} and ${none.length - 3} more`;
  if (none.length === nights.length) return `No ${what.toLowerCase()} known near any of your ${nights.length} nights.`;
  return `${what} near ${nights.length - none.length} of your ${nights.length} nights; none known near ${names}.`;
}

/** Plan's address for a stretch; days chosen on a stretch the rider's file marks nights on mean our stops (D70). */
export function planLink(r: DreamRoute, s: StretchResult, a: Ask): string {
  const { fromM, toM } = spanOf(r, s);
  return planHref(r.id, s, a, a.level!, a.days !== null && nightsIn(r, fromM, toM) > 0);
}
