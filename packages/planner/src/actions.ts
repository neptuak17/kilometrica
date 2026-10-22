/**
 * Plan actions (11.7, D52): every change to a plan is one of these, whether it comes from the screen or, later, from
 * the assistant. `applyAction` is pure; the planner re-plans from the new state and `planChanges` says what changed.
 * Actions say what they set rather than toggle, so the same action twice changes nothing more.
 */
import type { PlanChoices, PlanInputs, PlanItem } from "./types";

export interface PlanState {
  inputs: PlanInputs;
  choices: PlanChoices;
}

export type PlanAction =
  /** Any of the rider's answers: dates, days, level, bike, sleep, start time, stops, stretch, direction. */
  | { type: "set"; inputs: Partial<PlanInputs> }
  | { type: "add-day" }
  /**
   * Riding days (D75): one more uses up a rest day when there is one (the end date holds), else the trip ends a day
   * later; one fewer becomes a rest day, placed where it helps.
   */
  | { type: "ride-days"; days: number }
  | { type: "start-earlier"; minutes: number }
  /**
   * A rest day after this riding day (1-based), or none (D74). The end date holds, so a rest day takes a riding day
   * away and removing one gives it back. `current` is the plan's rest days in effect, which then stay where they are;
   * `night` and `stop` keep that night's stop, so the rest day stays in that town.
   */
  | { type: "rest"; afterRide: number; on: boolean; current?: number[]; night?: number; stop?: string }
  /** Move a rest day to after another riding day; the riding days stay as they are (`nights`, the plan's stops). */
  | { type: "rest-move"; from: number; to: number; current: number[]; nights: string[] }
  /** Rest at this stop: the night (0-based) is kept there and a rest day follows; `add` makes it one more (D74). */
  | { type: "rest-in"; night: number; stop: string; add: boolean; current?: number[] }
  /** Keep this night (0-based) at this stop, whatever else changes. */
  | { type: "lock-night"; night: number; stop: string }
  | { type: "release-night"; night: number }
  /** Booked keeps the night where it is. */
  | { type: "booked"; night: number; stop: string; on: boolean; date?: string }
  | { type: "bed"; night: number; place: string | null }
  /** Sleep at this place, one of a night's other options (D72): the night moves to its stop and is kept there. */
  | { type: "stay"; night: number; stop: string; place: string }
  | { type: "done"; item: string; on: boolean }
  /** "I know": the item stays as it is and is no longer raised. */
  | { type: "dismiss"; item: string };

/** The earliest leaving time a change may set. */
const EARLIEST_START = 5 * 60;

const without = <T>(xs: T[], x: T) => xs.filter((y) => y !== x);
const withOne = <T>(xs: T[], x: T) => (xs.includes(x) ? xs : [...xs, x]);

/**
 * The new state. Changing the answers or the nights re-plans the days (locked and booked nights stay); a bed, a
 * tick or a dismissal keeps the nights as they are.
 */
export function applyAction(state: PlanState, action: PlanAction): PlanState {
  const { inputs, choices } = state;
  const replan = (next: Partial<PlanInputs>, c: PlanChoices = choices): PlanState => ({
    inputs: { ...inputs, ...next },
    choices: { ...c, nights: undefined },
  });
  const keep = (c: PlanChoices): PlanState => ({ inputs, choices: c });
  switch (action.type) {
    case "set": {
      const next = { ...action.inputs };
      if (next.days !== undefined) next.days = Math.max(1, Math.round(next.days));
      // Choosing a number of days means planning the stops (D70): the file's nights set their own.
      if (next.days !== undefined && next.days !== inputs.days && next.stops === inputs.stops) next.stops = "ours";
      return replan(next);
    }
    case "add-day":
    case "ride-days": {
      const n = action.type === "add-day" ? inputs.days + 1 : Math.max(1, Math.round(action.days));
      const count = Math.max(inputs.restDays ?? 0, inputs.restAfter.length);
      if (n > inputs.days && count > 0) return replan({ days: n, restDays: count - 1, restAfter: inputs.restAfter.slice(0, count - 1), stops: "ours" });
      if (n < inputs.days) return replan({ days: n, restDays: count + 1, stops: "ours" });
      return replan({ days: n, stops: "ours" });
    }
    case "start-earlier":
      return replan({ startMinutes: Math.max(EARLIEST_START, inputs.startMinutes - action.minutes) });
    case "rest": {
      const current = action.current ?? inputs.restAfter;
      const count = Math.max(inputs.restDays ?? 0, current.length);
      if (!action.on) return replan({ restAfter: without(current, action.afterRide), restDays: Math.max(0, count - 1), days: inputs.days + 1 });
      const locked = action.night !== undefined && action.stop ? { ...choices.locked, [action.night]: action.stop } : choices.locked;
      return replan(
        { restAfter: withOne(current, action.afterRide).sort((a, b) => a - b), restDays: count + 1, days: Math.max(1, inputs.days - 1) },
        { ...choices, locked },
      );
    }
    case "rest-move": {
      const restAfter = withOne(without(action.current, action.from), action.to).sort((a, b) => a - b);
      return { inputs: { ...inputs, restAfter, restDays: Math.max(inputs.restDays ?? 0, restAfter.length) }, choices: { ...choices, nights: action.nights } };
    }
    case "rest-in": {
      const current = action.current ?? inputs.restAfter;
      const count = Math.max(inputs.restDays ?? 0, current.length);
      const restAfter = withOne(current, action.night + 1).sort((a, b) => a - b);
      const locked = { ...choices.locked, [action.night]: action.stop };
      return replan(
        action.add ? { restAfter, restDays: count + 1, days: Math.max(1, inputs.days - 1) } : { restAfter, restDays: Math.max(count, restAfter.length) },
        { ...choices, locked },
      );
    }
    case "lock-night":
      return replan({}, { ...choices, locked: { ...choices.locked, [action.night]: action.stop } });
    case "release-night": {
      const locked = { ...choices.locked };
      delete locked[action.night];
      return replan({}, { ...choices, locked, booked: without(choices.booked, action.night) });
    }
    case "booked": {
      const booked = action.on ? withOne(choices.booked, action.night) : without(choices.booked, action.night);
      const locked = action.on ? { ...choices.locked, [action.night]: action.stop } : choices.locked;
      // The date it was booked for (D74): if the night moves, the booking goes back on the to-do.
      const bookedOn = { ...choices.bookedOn };
      if (action.on && action.date) bookedOn[action.night] = action.date;
      else delete bookedOn[action.night];
      return replan({}, { ...choices, booked, locked, bookedOn });
    }
    case "stay":
      return replan({}, { ...choices, locked: { ...choices.locked, [action.night]: action.stop }, beds: { ...choices.beds, [action.night]: action.place } });
    case "bed": {
      const beds = { ...choices.beds };
      if (action.place) beds[action.night] = action.place;
      else delete beds[action.night];
      return keep({ ...choices, beds });
    }
    case "done":
      return keep({ ...choices, done: action.on ? withOne(choices.done, action.item) : without(choices.done, action.item) });
    case "dismiss":
      return keep({ ...choices, dismissed: withOne(choices.dismissed, action.item) });
  }
}

/** What one of a call's options does: a change to the plan, or a day to look at (the rider then moves its stop). */
export type OptionOutcome = { action: PlanAction } | { showDay: number };

export function optionOutcome(item: PlanItem, optionId: string): OptionOutcome | null {
  const [kind, arg] = optionId.split(":") as [string, string | undefined];
  const n = Number(arg);
  switch (kind) {
    case "keep":
      return { action: { type: "dismiss", item: item.id } };
    case "add-day":
      return { action: { type: "add-day" } };
    case "days":
      return Number.isFinite(n) ? { action: { type: "ride-days", days: n } } : null;
    case "earlier":
      return Number.isFinite(n) ? { action: { type: "start-earlier", minutes: n } } : null;
    case "rest":
      return Number.isFinite(n) ? { action: { type: "rest", afterRide: n, on: true } } : null;
    case "rest-in": {
      // rest-in:<night>:<stop id>
      const parts = optionId.split(":");
      const stop = parts.slice(2).join(":");
      return Number.isFinite(n) && stop ? { action: { type: "rest-in", night: n, stop, add: false } } : null;
    }
    case "move":
      return Number.isFinite(n) ? { showDay: n } : null;
    default:
      return null;
  }
}
