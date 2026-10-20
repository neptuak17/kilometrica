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
  | { type: "start-earlier"; minutes: number }
  /** A rest day after this riding day (1-based), or none. */
  | { type: "rest"; afterRide: number; on: boolean }
  /** Keep this night (0-based) at this stop, whatever else changes. */
  | { type: "lock-night"; night: number; stop: string }
  | { type: "release-night"; night: number }
  /** Booked keeps the night where it is. */
  | { type: "booked"; night: number; stop: string; on: boolean }
  | { type: "bed"; night: number; place: string | null }
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
      return replan({ days: inputs.days + 1, stops: "ours" });
    case "start-earlier":
      return replan({ startMinutes: Math.max(EARLIEST_START, inputs.startMinutes - action.minutes) });
    case "rest":
      return replan({ restAfter: action.on ? withOne(inputs.restAfter, action.afterRide).sort((a, b) => a - b) : without(inputs.restAfter, action.afterRide) });
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
      return replan({}, { ...choices, booked, locked });
    }
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
      return Number.isFinite(n) ? { action: { type: "set", inputs: { days: n } } } : null;
    case "earlier":
      return Number.isFinite(n) ? { action: { type: "start-earlier", minutes: n } } : null;
    case "rest":
      return Number.isFinite(n) ? { action: { type: "rest", afterRide: n, on: true } } : null;
    case "move":
      return Number.isFinite(n) ? { showDay: n } : null;
    default:
      return null;
  }
}
