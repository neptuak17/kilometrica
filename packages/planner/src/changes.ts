/**
 * What changed between two plans (11.7, D52), in the rider's terms: shown with a preview before a change and as one
 * line after it. Later the assistant phrases changes from the same facts.
 */
import type { PlanResult } from "./plan";
import { clock } from "./sun";
import { restLengthOf } from "./rest";
import { day, km, numberList, plural, stopName } from "./text";
import type { Bike, PlanItem, Sleep, StopStyle } from "./types";

export interface PlanChanges {
  /** Plain lines, most important first. */
  lines: string[];
  /** One line for a bar: the first two facts, and how many more. Empty when nothing the plan shows has changed. */
  summary: string;
  /** Calendar days of the new plan that differ: new days, or a different distance or end. */
  days: number[];
  /** Calls the change raises, and calls it settles. */
  raised: PlanItem[];
  settled: PlanItem[];
}

const SLEEP: Record<Sleep, string> = { camping: "camping", rooms: "rooms", mix: "rooms or camping" };
const BIKE: Record<Bike, string> = { road: "road bike", touring: "touring bike", gravel: "gravel bike", ebike: "e-bike", bikepacking: "bikepacking bike" };
const STOPS: Record<StopStyle, string> = { short: "short", normal: "normal", long: "long" };

/** A day's distance counts as changed from this many km. */
const KM_CHANGE = 1;

const openCalls = (p: PlanResult) => p.items.filter((i) => i.kind === "call" && !p.choices.dismissed.includes(i.id));

export function planChanges(before: PlanResult, after: PlanResult): PlanChanges {
  const lines: string[] = [];
  const a = before.inputs;
  const b = after.inputs;

  // The rider's answers.
  const ridesA = before.days.filter((d) => d.kind === "ride");
  const ridesB = after.days.filter((d) => d.kind === "ride");
  const more = ridesB.length - ridesA.length;
  if (more) {
    const n = Math.abs(more);
    lines.push(`${n === 1 ? "One" : n} riding ${n === 1 ? "day" : "days"} ${more > 0 ? "more" : "fewer"} (${ridesB.length})`);
  }
  // Rest days in effect, the rider's and the planner's (D74).
  const ra = before.restAfter;
  const rb = after.restAfter;
  const stays = (p: PlanResult) => p.restAfter.map((r) => `${r}:${restLengthOf(p.inputs, r)}`).join();
  if (ra.join() !== rb.join()) lines.push(rb.length ? `Rest days now after riding ${rb.length === 1 ? "day" : "days"} ${numberList(rb)}` : "No rest days");
  // A longer or shorter stay where a rest day already is (D80).
  else if (stays(before) !== stays(after)) {
    for (const r of rb) {
      const [x, y] = [restLengthOf(a, r), restLengthOf(b, r)];
      const town = after.nights.find((n) => n.afterRide === r);
      if (x !== y) lines.push(`${plural(y, "rest day")} in a row${town ? ` at ${stopName(town.stop)}` : ""} (was ${x})`);
    }
  }
  if (a.fromM !== b.fromM || a.toM !== b.toM || a.direction !== b.direction) lines.push(`Now ${after.brief.title} (was ${before.brief.title})`);
  if (a.startDate !== b.startDate) lines.push(`Starts ${day(b.startDate)} (was ${day(a.startDate)})`);
  // The end date holds unless a change moves it (D74, D75): when it does, it is said.
  else if (before.endDate !== after.endDate) lines.push(`Ends ${day(after.endDate)} (was ${day(before.endDate)})`);
  if (a.startMinutes !== b.startMinutes) lines.push(`Leave at ${clock(b.startMinutes)} (was ${clock(a.startMinutes)})`);
  if (a.level !== b.level) lines.push(`Level: ${after.level.name} (was ${before.level.name})`);
  if (a.sleep !== b.sleep) lines.push(`Sleep: ${SLEEP[b.sleep]} (was ${SLEEP[a.sleep]})`);
  if (a.bike !== b.bike) lines.push(`Bike: ${BIKE[b.bike]} (was ${BIKE[a.bike]})`);
  if (a.stopStyle !== b.stopStyle) lines.push(`Stops: ${STOPS[b.stopStyle]} (was ${STOPS[a.stopStyle]})`);
  // The train switches (D75, D79): unset getting there and back is on, as plans saved before it had it.
  if ((a.travel !== false) !== (b.travel !== false)) lines.push(b.travel !== false ? "Getting to the start and home is in the plan" : "Getting to the start and home is left out");
  if (!!a.bailouts !== !!b.bailouts) lines.push(b.bailouts ? "Each day's stations for going home early are shown" : "Stations for going home early are left out");

  // The days, matched by riding day: a new end, a new distance, or a day that wasn't there.
  const changed: { number: number; line: string; delta: number }[] = [];
  const added: number[] = [];
  ridesB.forEach((d, j) => {
    const old = ridesA[j];
    if (!old) return void added.push(d.number);
    const ends = old.endName !== d.endName;
    const delta = Math.abs(d.km - old.km);
    if (!ends && delta < KM_CHANGE) return;
    changed.push({
      number: d.number,
      delta,
      line: ends
        ? `Day ${d.number} now ends at ${d.endName}, ${km(d.km)} km (was ${old.endName}, ${km(old.km)} km)`
        : `Day ${d.number} is now ${km(d.km)} km (was ${km(old.km)})`,
    });
  });
  if (changed.length <= 2) lines.push(...changed.map((c) => c.line));
  else {
    const [top, ...rest] = [...changed].sort((x, y) => y.delta - x.delta);
    lines.push(top!.line, `Days ${numberList(rest.map((c) => c.number).sort((x, y) => x - y))} change too`);
  }

  // Calls: compared by id, so a call that moves to another day reads as settled and raised.
  const callsA = openCalls(before);
  const callsB = openCalls(after);
  const raised = callsB.filter((i) => !callsA.some((x) => x.id === i.id));
  const settled = callsA.filter((i) => !callsB.some((x) => x.id === i.id));
  if (settled.length) lines.push(settled.length === 1 ? `Settles: ${settled[0]!.title}` : `Settles ${plural(settled.length, "call")}`);
  if (raised.length) lines.push(raised.length === 1 ? `New call: ${raised[0]!.title}` : plural(raised.length, "new call"));

  const summary = lines.length <= 2 ? lines.join("; ") : `${lines.slice(0, 2).join("; ")}; and ${plural(lines.length - 2, "more change")}`;
  return {
    lines,
    summary,
    days: [...changed.map((c) => c.number), ...added].sort((x, y) => x - y),
    raised,
    settled,
  };
}
