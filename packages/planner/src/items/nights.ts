/**
 * Where do I sleep? The places at each night's stop and the other options nearby (D72), the place the rider chose,
 * and one line per night in the to-do until it's settled (D18, D64).
 */
import type { Place, Stop } from "@dpg/contracts";
import type { PlanCore, PlanResult } from "../plan";
import { monthOf } from "../sun";
import { day as dayText, km, listable, placeTitle, sleepNoun, stopName } from "../text";
import { type DayPlan, type NightPlan, type PlanChoices, type PlanData, placesMissing, type Sleep } from "../types";
import { holidayOn, schoolOn } from "./calendar";
import { nightsAt } from "./links";
import type { Add } from "./shared";

/** A night's places "here": within this of its stop. Other options reach OPTIONS_M either way (D72). */
const HERE_M = 5000;
const OPTIONS_M = 10_000;
const OTHER_OPTIONS = 5;
/** A night settled as a wild camp (D72), kept in `choices.beds` like a chosen place. */
export const WILD_CAMP = "wild-camp";

function bedPlaces(full: NonNullable<PlanData["full"]>, stop: Stop): Place[] {
  return full.places
    .filter((p) => p.service === "accommodation" && p.counts && Math.abs(p.access_at_m - stop.at_m) <= HERE_M)
    .sort((a, b) => Math.abs(a.access_at_m - stop.at_m) - Math.abs(b.access_at_m - stop.at_m));
}

/** The rider's preferred kind of place (D72): a preference that orders the options, never a filter. */
const preferred = (p: Place, sleep: Sleep) => sleep === "mix" || (sleep === "camping") === (p.kind === "campsite");

export interface NightOptions {
  /** At the night's stop: every kind, the rider's first, then known open, then the shortest detour (D72). */
  here: Place[];
  /**
   * Within 10 km either way but not here, at most 5: the 3 nearest of the rider's kind, the nearest of each other
   * kind, then the nearest. `km` is along the way (+ on, − back); `stop` is where the night moves when chosen.
   */
  others: { place: Place; km: number; stop: Stop | null }[];
  /** Places within 10 km beyond those shown. */
  more: number;
  /** Wild camping is an option: the rider carries a tent (no tent, no camping). */
  wildCamp: boolean;
}

/** Where a rider could sleep on a night (D72): what's here, the other options nearby, and wild camping. */
export function nightOptions(data: PlanData, core: Pick<PlanCore, "inputs" | "axis" | "candidates">, night: NightPlan): NightOptions {
  const sleep = core.inputs.sleep;
  const wildCamp = sleep !== "rooms";
  if (!data.full) return { here: [], others: [], more: 0, wildCamp };
  const at = night.stop.at_m;
  const month = monthOf(night.date);
  const all = data.full.places.filter(
    (p) => p.service === "accommodation" && p.counts && listable(p) && p.months[month] !== "c" && Math.abs(p.access_at_m - at) <= OPTIONS_M,
  );
  const known = (p: Place) => (["o", "p", "a"].includes(p.months[month] ?? "?") ? 0 : 1);
  const here = all
    .filter((p) => Math.abs(p.access_at_m - at) <= HERE_M)
    .sort((a, b) => Number(!preferred(a, sleep)) - Number(!preferred(b, sleep)) || known(a) - known(b) || (a.access_m ?? 0) - (b.access_m ?? 0));
  const away = all
    .filter((p) => Math.abs(p.access_at_m - at) > HERE_M)
    .sort((a, b) => Math.abs(a.access_at_m - at) + (a.access_m ?? 0) - (Math.abs(b.access_at_m - at) + (b.access_m ?? 0)));
  const picked: Place[] = sleep === "mix" ? [] : away.filter((p) => preferred(p, sleep)).slice(0, 3);
  for (const p of away) if (picked.length < OTHER_OPTIONS && !picked.some((q) => q.kind === p.kind)) picked.push(p);
  for (const p of away) if (picked.length < OTHER_OPTIONS && !picked.includes(p)) picked.push(p);
  const stopFor = (p: Place) => {
    let best: Stop | null = null;
    for (const c of core.candidates) {
      const d = Math.abs(c.stop.at_m - p.access_at_m);
      if (c.stop.id !== night.stop.id && c.stop.beds.length && d <= HERE_M && (!best || d < Math.abs(best.at_m - p.access_at_m))) best = c.stop;
    }
    return best;
  };
  const t0 = core.axis.tOf(at);
  const others = picked.map((place) => ({ place, km: (core.axis.tOf(place.access_at_m) - t0) / 1000, stop: stopFor(place) }));
  return { here, others, more: away.length - picked.length, wildCamp };
}

/**
 * The place the rider chose for a night on its day card, while it is still one of that night's places (D64). A
 * choice stays with its town: when the night moves elsewhere it no longer counts, and counts again if it moves back.
 */
export function chosenBed(data: PlanData, night: NightPlan, choices: Pick<PlanChoices, "beds">, _sleep?: Sleep): Place | null {
  const id = choices.beds[night.index];
  if (!id || !data.full) return null;
  return bedPlaces(data.full, night.stop).find((p) => p.id === id) ?? null;
}

/** What the rider chose for a night (D95), in the words the day list shows; `camp`: a campsite or a wild camp, a tent. */
export type NightChoice =
  | { kind: "place"; place: Place; text: string; camp: boolean }
  | { kind: "wild-camp"; text: string; camp: true }
  | { kind: "own"; text: string; camp: false };

/**
 * The rider's choice for a night (D95): the place chosen on its day card, a wild camp, or "Own accommodation found"
 * when Booked is ticked with no place chosen; null while nothing is, the To do's job. We make no bookings, so a chosen
 * place is said by name only. A chosen place we can't check, its part's places not loaded, is null rather than a guess.
 */
export function nightChoice(data: PlanData, night: NightPlan, choices: Pick<PlanChoices, "beds" | "booked">, sleep: Sleep): NightChoice | null {
  const id = choices.beds[night.index];
  const chosen = chosenBed(data, night, choices);
  if (chosen) return { kind: "place", place: chosen, text: placeTitle(chosen, stopName(night.stop)), camp: chosen.kind === "campsite" };
  if (id === WILD_CAMP && sleep !== "rooms") return { kind: "wild-camp", text: "Wild camp", camp: true };
  if (id && id !== WILD_CAMP && (!data.full || placesMissing(data.full, night.stop.at_m - HERE_M, night.stop.at_m + HERE_M).length)) return null;
  return choices.booked.includes(night.index) ? { kind: "own", text: "Own accommodation found", camp: false } : null;
}

/** The night a day ends in: a riding day's own, a rest day's the night it stays on for; null on the last day. */
export function nightOfDay(plan: Pick<PlanResult, "days" | "nights">, d: DayPlan): NightPlan | null {
  const ride = d.kind === "ride" ? d.ride : (plan.days.filter((x) => x.number < d.number && x.kind === "ride").pop()?.ride ?? null);
  return plan.nights.find((n) => n.afterRide === ride) ?? null;
}

/**
 * One line per night, until the day card settles it: a place chosen there, or Booked. The line is a nudge, not a copy
 * of the day card: the places, their links and the other options are on the card, which its Day button opens. The id
 * carries the stop, so a night moved to another town is a new line.
 */
export function nightItems(data: PlanData, core: PlanCore, add: Add) {
  const { inputs, days, nights } = core;
  for (const n of nights) {
    const d = days.find((x) => x.ride === n.afterRide)!;
    const name = stopName(n.stop);
    const stayNights = nightsAt(n, core.restAfter, inputs);
    // A booking whose night has moved to another date (a rest day moved, D74) is to sort again.
    const bookedFor = core.choices.bookedOn?.[n.index];
    const booked = core.choices.booked.includes(n.index);
    const moved = booked && !!bookedFor && bookedFor !== n.date;
    const nudges: string[] = [];
    let rank = 30;
    if (moved) {
      nudges.push(`Your booking was for ${dayText(bookedFor!)}; this night is now ${dayText(n.date)}: change it with them.`);
      rank = 49;
    } else if (n.own && n.beds.count === 0) {
      // The rider's own stop (D70): they have a place in mind.
    } else if (n.wildCamp) {
      nudges.push(n.wildCamp);
      rank = 48;
    } else if (n.stop.beds.length === 0 || n.beds.count === 0) {
      nudges.push(`No known ${sleepNoun(inputs.sleep)} within 5 km of the route: look further, or change how you sleep.`);
      rank = 48;
    } else {
      if (n.beds.open + n.beds.partly + n.beds.unmanaged === 0) {
        nudges.push(`Check ahead if ${n.beds.count === 1 ? "it's" : "they're"} open.`);
        rank = 42;
      }
      if (n.beds.count === 1) {
        const b = n.planB.after ?? n.planB.before;
        nudges.push(`Only one place nearby${b ? `; other options: ${stopName(b.stop)}, ${km(Math.abs(b.km))} km ${b.km > 0 ? "on" : "back"}` : ""}.`);
        rank = Math.max(rank, 41);
      }
      const hol = holidayOn(data, n.stop.country, n.date);
      const school = schoolOn(data, n.stop.country, n.date);
      const sec = data.dream.sections.find((s) => s.from_m <= n.stop.at_m && n.stop.at_m <= s.to_m);
      const busy = sec?.crowding.tourism_index[monthOf(n.date)];
      const why = hol ? `a public holiday (${hol.name})` : school ? `school holidays (${school.name})` : busy && busy >= 1.3 ? `a busy month for tourism there` : null;
      if (why && n.beds.count <= 3) {
        nudges.push(`Book ahead: ${why}.`);
        rank = Math.max(rank, 40);
      }
    }
    const chosen = chosenBed(data, n, core.choices, inputs.sleep);
    add({
      id: `bed:${n.index}:${n.stop.id}`,
      kind: "todo",
      day: d.number,
      fromM: n.stop.at_m,
      toM: n.stop.at_m,
      title: `${n.wildCamp ? "Find a place to camp" : "Find accommodation"} at ${name} for ${dayText(n.date)}${stayNights > 1 ? `, ${stayNights} nights` : ""}`,
      why: nudges.join(" "),
      rank,
      topic: "sleep",
      evidence: { source: "stops.json (D18); OpenHolidays; Eurostat" },
      handoffs: [],
      settled: moved
        ? undefined
        : booked
          ? "Booked"
        : chosen
          ? `Chosen: ${placeTitle(chosen, name)}`
          : core.choices.beds[n.index] === WILD_CAMP && inputs.sleep !== "rooms"
            ? "Wild camp"
            : undefined,
    });
  }
}
