/**
 * Second thoughts (D77): a question, never a warning, about a choice the rider made that is allowed but unusual. Asked
 * once, right after the change that brought it up, in the change bar and later by the assistant; never on the to-do,
 * since keeping it as it is is a fine answer. "Keep it" dismisses it for good, as "I know" does. Only the rider's own
 * rest days are asked about: the planner never places them like this itself (D74).
 */
import type { PlanAction } from "./actions";
import type { PlanResult } from "./plan";
import { MIN_APART, restPlace } from "./rest";
import { bedsFor, usable } from "./stages";
import { monthOf } from "./sun";
import { plural, sleepNoun, stopName } from "./text";
import type { PlanData } from "./types";

export interface SecondThought {
  id: string;
  /** "Two rest days close together?" */
  question: string;
  /** Why we ask, in a sentence or two. */
  why: string;
  /** Ways to change it, best first; each is previewed before it applies (D77). */
  options: { label: string; action: PlanAction }[];
  /** Keeping it as it is: dismisses the thought for good. */
  keep: string;
}

function thoughtsOf(data: PlanData, p: PlanResult): SecondThought[] {
  const rides = p.days.filter((d) => d.kind === "ride").length;
  const rests = [...p.restAfter].sort((a, b) => a - b);
  const own = new Set(p.inputs.restAfter);
  const dayOf = (ride: number) => p.days.find((d) => d.ride === ride)?.number ?? ride;
  const nightAfter = (ride: number) => p.nights.find((n) => n.afterRide === ride);
  const move = (from: number, to: number): { label: string; action: PlanAction } => {
    const n = nightAfter(to);
    return {
      label: n ? `Rest in ${stopName(n.stop)} instead, after day ${dayOf(to)}` : `Rest after day ${dayOf(to)} instead`,
      action: { type: "rest-move", from, to, current: p.restAfter, nights: p.nights.map((x) => x.stop.id) },
    };
  };
  // Where a rest day could go instead: not after day 1 or the last riding day, not on another, and spaced from the
  // others; the nearest first.
  const fits = (from: number, x: number) => {
    const others = rests.filter((r) => r !== from);
    return x >= 2 && x <= rides - 1 && !others.includes(x) && others.every((o) => Math.abs(o - x) >= MIN_APART);
  };
  const nearest = (from: number) => {
    for (let k = 1; k < rides; k++) for (const x of [from + k, from - k]) if (fits(from, x)) return x;
    return null;
  };
  const out: SecondThought[] = [];

  for (let i = 0; i + 1 < rests.length; i++) {
    const [x, y] = [rests[i]!, rests[i + 1]!];
    if (y - x >= MIN_APART || (!own.has(x) && !own.has(y))) continue;
    const moving = own.has(y) ? y : x;
    const to = nearest(moving);
    // By their towns: the change bar's line above counts riding days, the day list calendar days.
    const [a, b] = [nightAfter(x), nightAfter(y)];
    const where = a && b ? `your rest days in ${stopName(a.stop)} and ${stopName(b.stop)}` : "your two rest days";
    out.push({
      id: `thought:close:${x}:${y}`,
      question: "Two rest days close together?",
      why: `Only ${plural(y - x, "riding day")} between ${where}. Further apart, each does more for your legs.`,
      options: to === null ? [] : [move(moving, to)],
      keep: "Keep both",
    });
  }

  if (own.has(1)) {
    const to = nearest(1);
    out.push({
      id: "thought:first",
      question: "A rest day straight after day 1?",
      why: "A rest day helps most once a few days are in your legs. If you arrive from far away, a day to settle in can make sense.",
      options: to === null ? [] : [move(1, to)],
      keep: "Keep it",
    });
  }

  for (const r of rests) {
    const n = nightAfter(r);
    if (!own.has(r) || !n) continue;
    const month = monthOf(n.date);
    const place = restPlace(data, n.stop, p.inputs.sleep, month);
    // A night the rider's file marks: they have a place in mind (D70).
    const noBed = !n.own && !usable(bedsFor(n.stop, p.inputs.sleep, month));
    // Nothing to see is known only with the Trip Pass's highlights; a spot with no name has nothing to offer a day.
    const nothing = !n.stop.name || (!!data.full && place.sights.length === 0);
    if (!noBed && !nothing) continue;
    const better = p.nights
      .filter((m) => m.afterRide !== r && Math.abs(m.afterRide - r) <= 3 && fits(r, m.afterRide))
      .map((m) => ({ ride: m.afterRide, score: restPlace(data, m.stop, p.inputs.sleep, monthOf(m.date)).score }))
      .filter((m) => m.score > place.score)
      .sort((a, b) => b.score - a.score)[0];
    const town = stopName(n.stop);
    out.push({
      id: `thought:place:${r}:${n.stop.id}`,
      question: `A rest day ${n.stop.name ? "in " : ""}${town}?`,
      why: noBed
        ? `We know of no ${sleepNoun(p.inputs.sleep)} there for the 2 nights.`
        : n.stop.name
          ? "We know of nothing to see there."
          : "It's a spot between towns, with nothing we know of for a day off.",
      options: better ? [move(r, better.ride)] : [],
      keep: "Keep it",
    });
  }
  return out;
}

/**
 * The second thoughts a change brought up: those the plan after it has and the plan before it didn't, less the ones
 * the rider dismissed. At most one is shown at a time (D77); the first is the one to show.
 */
export function secondThoughts(data: PlanData, before: PlanResult, after: PlanResult): SecondThought[] {
  const had = new Set(thoughtsOf(data, before).map((t) => t.id));
  return thoughtsOf(data, after).filter((t) => !had.has(t.id) && !after.choices.dismissed.includes(t.id));
}
