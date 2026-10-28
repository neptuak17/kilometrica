/**
 * Plan rules (11.6): facts on the rider's days become a few plan items, each with why it matters to this rider and
 * the evidence behind it (D38). Thresholds live with their rules, one file per topic, so the assistant's tools can
 * reach each (A2, D77): effort, gaps, nights, travel, the calendar, findings, water and food, sights, and the hand-offs.
 *
 * The teaser (D45) has only the free files, so it gets the rules that need nothing else: effort, sunset, days, beds by
 * count, gaps, getting there, borders and missing data. The Trip Pass adds findings, water and food, opening on the
 * date, climbs and highlights.
 */
import type { Geometry } from "../geometry";
import type { PlanCore } from "../plan";
import type { PlanChoices, PlanData, PlanItem } from "../types";
import { holidayNotes } from "./calendar";
import { bigClimb, effortItems } from "./effort";
import { findingItems } from "./findings";
import { gapItems } from "./gaps";
import { addStreetPhotos } from "./links";
import { nightItems } from "./nights";
import { type Add, CAPS, fewTrains } from "./shared";
import { highlightItems } from "./sights";
import { openFood, type SupplyGap, supplyAdvice, supplyGaps } from "./supplies";
import { travelItems } from "./travel";

export { bookingSearches, mapsSearch, nightsAt, nightStay, placeLinks, RAIL, railLinks, streetPhotos, wikiLinks } from "./links";
export { chosenBed, type NightChoice, nightChoice, nightOfDay, nightOptions, type NightOptions, WILD_CAMP } from "./nights";
export { CAPS, STEEP } from "./shared";
export { foodOnDay } from "./supplies";
export { SCHENGEN } from "./travel";
export { bedsFor } from "../stages";

export function planItems(data: PlanData, core: PlanCore, geo?: Geometry): PlanItem[] {
  const items: PlanItem[] = [];
  const add: Add = (i) => items.push(i);
  effortItems(core, add);
  gapItems(core, add);
  nightItems(data, core, add);
  travelItems(data, core, add);
  // An unknown surface is said in the brief's note, never as a to-do (D75).
  holidayNotes(data, core, add);
  if (data.full) fullItems(data, core, add);
  if (geo) addStreetPhotos(data, core, items, geo);
  return items.sort((a, b) => b.rank - a.rank || (a.day ?? 0) - (b.day ?? 0));
}

/** What the Trip Pass adds, day by day: findings, water and food, opening on the date, the big climb, highlights. */
function fullItems(data: PlanData, core: PlanCore, add: Add) {
  const full = data.full!;
  const rides = core.days.filter((d) => d.kind === "ride");
  const ownWay = fewTrains(data, core);
  const gaps: SupplyGap[] = [];
  for (const d of rides) {
    findingItems(full, core, d, ownWay, add);
    gaps.push(...supplyGaps(full, core, d));
    openFood(data, d, add);
    bigClimb(full, data.effort, core, d, add);
    highlightItems(full, core, d, add);
  }
  supplyAdvice(gaps, rides.length, add);
}

/** A day's items within the attention budget (11.6): calls and to-dos all, heads-ups and highlights capped. */
export function dayItems(items: PlanItem[], dayNumber: number) {
  const mine = items.filter((i) => i.day === dayNumber);
  const pick = (kind: PlanItem["kind"], cap: number) => {
    const all = mine.filter((i) => i.kind === kind);
    return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
  };
  return {
    calls: mine.filter((i) => i.kind === "call"),
    todos: mine.filter((i) => i.kind === "todo"),
    headsups: pick("headsup", CAPS.headsup),
    highlights: pick("highlight", CAPS.highlight),
  };
}

export const openItems = (items: PlanItem[], done: string[], dismissed: string[]) =>
  items.filter((i) => !done.includes(i.id) && !dismissed.includes(i.id));

/** A night's line in the to-do (D64). */
export const isNightLine = (i: PlanItem) => i.kind === "todo" && i.id.startsWith("bed:");

/**
 * What's left to sort out before the trip (D64): the calls not yet answered, the nights not yet settled on their day
 * card, and the other to-dos not yet ticked, calls first; and what's done. The plan is complete when `open` is empty.
 */
export function toDo(items: PlanItem[], choices: PlanChoices): { open: PlanItem[]; done: PlanItem[] } {
  const isDone = (i: PlanItem) => (i.kind === "call" ? choices.dismissed.includes(i.id) : isNightLine(i) ? !!i.settled : choices.done.includes(i.id));
  // In the order of the trip: by day, the whole trip's lines last.
  const mine = items.filter((i) => i.kind === "call" || i.kind === "todo").sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity));
  const open = mine.filter((i) => !isDone(i));
  return { open: [...open.filter((i) => i.kind === "call"), ...open.filter((i) => i.kind !== "call")], done: mine.filter(isDone) };
}
