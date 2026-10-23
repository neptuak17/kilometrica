/**
 * Plan actions (11.7, D52): every change to a plan is one of these, whether it comes from the screen or, later, from
 * the assistant. `applyAction` is pure; the planner re-plans from the new state and `planChanges` says what changed.
 * Actions say what they set rather than toggle, so the same action twice changes nothing more.
 */
import type { PlanResult } from "./plan";
import { MAX_REST_LENGTH, ownRestDays, restLengthOf, trimOwnRests } from "./rest";
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
  /**
   * Rest at this stop: the night (0-based) is kept there and a rest day follows; `add` makes it one more (D74). `days`
   * makes it a longer stay of 2 or 3 rest days in a row (D80). `longer`: the riding days stay and the trip ends later,
   * as the assistant may offer (D77).
   */
  | { type: "rest-in"; night: number; stop: string; add: boolean; current?: number[]; days?: number; longer?: boolean }
  /**
   * So many rest days in a row after this riding day (D80): "Stay another day", "One day fewer". The end date holds,
   * unless `longer`.
   */
  | { type: "rest-length"; afterRide: number; days: number; current?: number[]; night?: number; stop?: string; longer?: boolean }
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
      const count = Math.max(inputs.restDays ?? 0, ownRestDays(inputs));
      if (n > inputs.days && count > 0) return replan({ days: n, restDays: count - 1, ...trimOwnRests(inputs, count - 1), stops: "ours" });
      if (n < inputs.days) return replan({ days: n, restDays: count + 1, stops: "ours" });
      return replan({ days: n, stops: "ours" });
    }
    case "start-earlier":
      return replan({ startMinutes: Math.max(EARLIEST_START, inputs.startMinutes - action.minutes) });
    case "rest": {
      const current = action.current ?? inputs.restAfter;
      const count = Math.max(inputs.restDays ?? 0, ownRestDays({ restAfter: current, restLength: inputs.restLength }));
      if (!action.on) {
        // A longer stay gives all its days back (D80).
        const len = restLengthOf(inputs, action.afterRide);
        const restLength = { ...inputs.restLength };
        delete restLength[action.afterRide];
        return replan({ restAfter: without(current, action.afterRide), restLength, restDays: Math.max(0, count - len), days: inputs.days + len });
      }
      const locked = action.night !== undefined && action.stop ? { ...choices.locked, [action.night]: action.stop } : choices.locked;
      return replan(
        { restAfter: withOne(current, action.afterRide).sort((a, b) => a - b), restDays: count + 1, days: Math.max(1, inputs.days - 1) },
        { ...choices, locked },
      );
    }
    case "rest-move": {
      const restAfter = withOne(without(action.current, action.from), action.to).sort((a, b) => a - b);
      // A longer stay moves whole (D80).
      const restLength = { ...inputs.restLength };
      if (restLength[action.from]) restLength[action.to] = restLength[action.from]!;
      delete restLength[action.from];
      return {
        inputs: { ...inputs, restAfter, restLength, restDays: Math.max(inputs.restDays ?? 0, ownRestDays({ restAfter, restLength })) },
        choices: { ...choices, nights: action.nights },
      };
    }
    case "rest-in":
    case "rest-length": {
      const asked = action.type === "rest-in" ? action.night + 1 : action.afterRide;
      const current = action.current ?? inputs.restAfter;
      const count = Math.max(inputs.restDays ?? 0, ownRestDays({ restAfter: current, restLength: inputs.restLength }));
      // A rest day already there counts: one the planner placed is a single day, and becomes the rider's.
      const had = current.includes(asked) ? restLengthOf(inputs, asked) : 0;
      const len = Math.min(MAX_REST_LENGTH, Math.max(1, Math.round(action.days ?? 1)));
      const extra = len - had;
      const keepEnd = !action.longer && (action.type === "rest-length" || action.add);
      // The end date holds, so there are fewer riding days: a stay that would come after the last of them comes as late
      // as it can, its night still kept at the town.
      const rides = keepEnd ? Math.max(1, inputs.days - extra) : inputs.days;
      const r = Math.max(1, Math.min(asked, rides - 1));
      const restAfter = withOne(current.filter((x) => x < rides), r).sort((a, b) => a - b);
      const restLength = { ...inputs.restLength };
      if (r !== asked) delete restLength[asked];
      if (len > 1) restLength[r] = len;
      else delete restLength[r];
      const night = action.night === undefined ? undefined : action.night - (asked - r);
      const locked = night !== undefined && action.stop ? { ...choices.locked, [night]: action.stop } : choices.locked;
      return replan(
        keepEnd || action.longer
          ? { restAfter, restLength, restDays: Math.max(0, count + extra), days: rides }
          : { restAfter, restLength, restDays: Math.max(count, ownRestDays({ restAfter, restLength })) },
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

// --- the screen's ways in, shared with the assistant (D77) -------------------------------------------------------
// Each builds the action a control on the screen takes, so a change from the chat is the very same change.

/** The days answers (D74): the end date holds, so rest days are taken from the total and riding days are the rest. */
export function daysAnswer(inputs: PlanInputs, ownNights: number) {
  const own = ownNights > 0 && inputs.stops !== "ours";
  const rest = Math.max(inputs.restDays ?? 0, ownRestDays(inputs));
  const riding = own ? ownNights + 1 : inputs.days;
  return { own, rest, riding, total: riding + rest };
}

/** "Rest days": so many in all, taken from the total (the file's nights set the riding days when they're the rider's). */
export function withRestDays(inputs: PlanInputs, r: number, ownNights: number): PlanInputs {
  const { own, total } = daysAnswer(inputs, ownNights);
  return own
    ? { ...inputs, restDays: r, ...trimOwnRests(inputs, r) }
    : { ...inputs, restDays: r, days: Math.max(1, total - r), ...trimOwnRests({ restAfter: inputs.restAfter.filter((x) => x < total - r), restLength: inputs.restLength }, r) };
}

/** "Total days": the rest days stay, the riding days are what's left. */
export function withTotalDays(inputs: PlanInputs, total: number, ownNights: number): PlanInputs {
  return { ...inputs, days: Math.max(1, Math.min(60, Math.round(total)) - daysAnswer(inputs, ownNights).rest) };
}

/** A day card's "Rest day after this day", or taking it away. */
export const restAfterAction = (plan: PlanResult, afterRide: number, on: boolean): PlanAction =>
  on
    ? { type: "rest", afterRide, on: true, current: plan.restAfter, night: afterRide - 1, stop: plan.nights[afterRide - 1]?.stop.id }
    : { type: "rest", afterRide, on: false, current: plan.restAfter };

/** A rest day's "Stay another day" or "One day fewer" (D80): so many rest days in a row, in the same town. */
export const restLengthAction = (plan: PlanResult, afterRide: number, days: number, longer = false): PlanAction => ({
  type: "rest-length",
  afterRide,
  days,
  ...(longer ? { longer } : {}),
  current: plan.restAfter,
  night: afterRide - 1,
  stop: plan.nights[afterRide - 1]?.stop.id,
});

/** A rest day's "Move it": after another riding day; the riding days stay as they are. */
export const restMoveAction = (plan: PlanResult, from: number, to: number): PlanAction => ({
  type: "rest-move",
  from,
  to,
  current: plan.restAfter,
  nights: plan.nights.map((n) => n.stop.id),
});

/** "Rest in…" a town (D74): the night nearest it moves there and rest days follow, one or a longer stay (D80). */
export function restInAction(plan: PlanResult, stop: { id: string; at_m: number }, days = 1, longer = false): PlanAction | null {
  if (!plan.nights.length) return null;
  const night = plan.nights.reduce((b, n, i) => (Math.abs(n.stop.at_m - stop.at_m) < Math.abs(plan.nights[b]!.stop.at_m - stop.at_m) ? i : b), 0);
  return { type: "rest-in", night, stop: stop.id, add: true, current: plan.restAfter, ...(days > 1 ? { days } : {}), ...(longer ? { longer } : {}) };
}

/** A night's Booked: it keeps the night where it is, and the date it was booked for (D74). */
export const bookedAction = (plan: PlanResult, night: number, on: boolean): PlanAction | null => {
  const n = plan.nights[night];
  return n ? { type: "booked", night, stop: n.stop.id, on, date: n.date } : null;
};

/**
 * "Be in by" (D80): the latest start, on the quarter hour and no earlier than 05:00, that gets every riding day in by
 * this time (minutes after midnight), and the days that would still end later. A day ends as much later as it starts
 * later, so one start does for all.
 */
export function beInBy(plan: PlanResult, by: number): { start: number; late: number[] } {
  const rides = plan.days.filter((d) => d.kind === "ride");
  const over = Math.max(...rides.map((d) => d.endMinutes - by));
  const start = Math.max(EARLIEST_START, Math.floor((plan.inputs.startMinutes - over) / 15) * 15);
  const shift = plan.inputs.startMinutes - start;
  return { start, late: rides.filter((d) => d.endMinutes - shift > by).map((d) => d.number) };
}
