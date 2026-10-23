/**
 * Water and food (D48): the longest stretch on a day without them, food places open on the date, and in sparse
 * country one piece of advice for the trip instead of a warning a day (D69, D70). Riders judge what to carry.
 */
import type { PlanCore } from "../plan";
import { dayIndex, weekday } from "../sun";
import { KNOWN_ENOUGH, plural, WEEKDAYS_LONG } from "../text";
import { type DayPlan, type FullData, type PlanData, type PlanItem, placesMissing } from "../types";
import { holidayOn } from "./calendar";
import { type Add, dayKm } from "./shared";

/**
 * A riding day's food places, and how many are open that day among those whose hours we know (D37: the known part
 * only). Null where the day's places didn't load: not loaded isn't none.
 */
export function foodOnDay(data: PlanData, d: DayPlan): { all: number; known: number; open: number; holiday: string | null; ids: string[] } | null {
  const full = data.full;
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  if (!full || placesMissing(full, lo, hi).length) return null;
  const food = full.places.filter((p) => p.service === "food" && p.counts && p.access_at_m >= lo && p.access_at_m <= hi);
  const known = food.filter((p) => typeof p.detail.days === "string");
  const di = dayIndex(d.date);
  const hol = holidayOn(data, d.stop?.country ?? null, d.date);
  const open = known.filter((p) => !(hol && /\bPH\b/.test(p.opening_hours ?? "")) && (p.detail.days as string)[di] === "o").length;
  return { all: food.length, known: known.length, open, holiday: hol?.name ?? null, ids: known.map((p) => p.id) };
}

/** A day's longest stretch without water (or a shop) and without food, where longer than the service's gap. */
export interface SupplyGap {
  item: PlanItem;
  km: number;
}

/** Where the day's places didn't load, nothing is said: not loaded isn't none (D37). */
export function supplyGaps(full: FullData, core: PlanCore, d: DayPlan): SupplyGap[] {
  const water = full.serviceTypes.find((t) => t.id === "water");
  const food = full.serviceTypes.find((t) => t.id === "food");
  const out: SupplyGap[] = [];
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  const loaded = !placesMissing(full, lo, hi).length;
  const on = (svc: string[]) =>
    full.places
      .filter((p) => svc.includes(p.service) && p.counts && p.access_at_m >= lo && p.access_at_m <= hi)
      .map((p) => dayKm(core, d, p.access_at_m))
      .sort((x, y) => x - y);
  for (const [svc, cfg, label] of [
    [["water", "food"], water, "water"],
    [["food"], food, "food"],
  ] as const) {
    if (!cfg?.gap_m || !loaded) continue;
    const pts = [0, ...on([...svc]), d.km];
    let worst = 0;
    let at = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]! - pts[i - 1]! > worst) {
        worst = pts[i]! - pts[i - 1]!;
        at = pts[i - 1]!;
      }
    }
    if (worst * 1000 > cfg.gap_m) {
      out.push({ km: worst, item: {
        id: `${label}:gap:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `No ${label} for ${Math.round(worst)} km from km ${Math.round(at)}`,
        short: `No ${label} ${Math.round(worst)} km`,
        why: `The longest stretch on the day without ${label === "water" ? "water or a shop" : "food"}; you judge what to carry.`,
        rank: 47,
        topic: "risk",
        evidence: { source: "M2 places" },
        handoffs: [],
      } });
    }
  }
  return out;
}

/**
 * Few food places open on the date: said only when we know the hours of nearly all of them (D57), since a conclusion
 * drawn from the few that publish hours would be a guess.
 */
export function openFood(data: PlanData, d: DayPlan, add: Add) {
  const eat = foodOnDay(data, d);
  if (eat && eat.all >= 3 && eat.known / eat.all >= KNOWN_ENOUGH) {
    if (eat.open / eat.known <= 0.5) {
      const what = eat.holiday ? `a public holiday (${eat.holiday})` : `a ${WEEKDAYS_LONG[weekday(d.date)]}`;
      add({
        id: `open:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Day ${d.number} is ${what}: ${eat.open} of the ${eat.known} food places${eat.known < eat.all ? " with known hours" : ""} are open`,
        short: "Food: few open",
        why: "From their published hours; check the ones you count on.",
        rank: 44,
        topic: "risk",
        evidence: { places: eat.ids, source: "OSM opening_hours" },
        handoffs: [],
      });
    }
  }
}

/**
 * Water and food gaps on most days (sparse country, D69, D70): one piece of advice for the trip, not a warning a day.
 * The day cards still show each day's longest stretch. Otherwise each day's gaps.
 */
export function supplyAdvice(gaps: SupplyGap[], rides: number, add: Add) {
  const gapDays = new Set(gaps.map((g) => g.item.day)).size;
  if (gapDays >= 3 && gapDays * 2 >= rides) {
    add({
      id: "supply:sparse",
      kind: "todo",
      day: null,
      fromM: null,
      toM: null,
      title: `Long stretches without water or food on ${gapDays} of ${plural(rides, "day")}, up to ${Math.round(Math.max(...gaps.map((g) => g.km)))} km`,
      why: "Bring a water filter and enough food: filter from streams and lakes on the way where there are any, your judgement. Each day card shows the day's longest stretch.",
      rank: 47,
      topic: "prepare",
      evidence: { source: "M2 places" },
      handoffs: [],
    });
  } else {
    for (const g of gaps) add(g.item);
  }
}
