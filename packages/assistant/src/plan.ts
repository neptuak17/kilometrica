/**
 * Plan's tools (D77): the chat beside a plan, whose state is the rider's answers and choices. The lookups say what the
 * brief, the day cards and the to-do say; "offer_options" builds each change with the very actions the screen's
 * controls take, and returns what it would change for the rider to preview and apply, or not.
 */
import {
  applyAction,
  beInBy,
  bedKinds,
  bedsFor,
  bedsKnown,
  bookedAction,
  bookingSearches,
  clock,
  day as dayText,
  dayFacts,
  dayItems,
  dayStory,
  dayWeather,
  hours,
  km,
  MAX_REST_LENGTH,
  MONTHS_LONG,
  nightOptions,
  monthOf,
  nightStay,
  nightsAt,
  numberList,
  optionOutcome,
  ownNights,
  placeKind,
  placeTitle,
  type PlanAction,
  planChanges,
  type PlanData,
  type PlanInputs,
  type PlanItem,
  type PlanResult,
  type PlanState,
  placesMissing,
  plural,
  restAfterAction,
  restFacts,
  restInAction,
  restLengthAction,
  restMoveAction,
  sleepNoun,
  STEEP,
  stayDates,
  stopName,
  toDo,
  WILD_CAMP,
  withRestDays,
  withTotalDays,
} from "@dpg/planner";
import type { DayPlan, NightPlan } from "@dpg/planner";
import { closeNames, matchNames } from "./names";
import { weatherIn } from "./dream";
import { arg, monthIndex, MONTHS_ENUM, problem, schema, type Tool, type ToolOption, type ToolResult } from "./tool";

export interface PlanContext {
  data: PlanData;
  state: PlanState;
  /** Plans a state: the screen's own, so a tool plans nothing twice and sees the plan as the screen does. */
  planFor: (s: PlanState) => PlanResult;
  /** What the rider is looking at (D77): the open day, for "this day". */
  screen?: { day?: number };
}

/** What a Plan option applies: the new state, previewed first (D77). */
export interface PlanApply {
  state: PlanState;
  actions: PlanAction[];
}

const EFFORT = { within: "within your level", harder: "a harder day", beyond: "beyond your level" } as const;
const KIND = { call: "Your call", todo: "To do", headsup: "Heads-up", highlight: "Highlight", note: "To be aware of" } as const;
const PASS = "comes with a Trip Pass";

const planOf = (ctx: PlanContext) => ctx.planFor(ctx.state);
/** An item's why as a sentence of its own: a highlight's ("castle at km 64") starts lower case. */
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
const rides = (p: PlanResult) => p.days.filter((d) => d.kind === "ride");
const fileNights = (ctx: PlanContext) => ownNights(ctx.data, ctx.state.inputs.fromM, ctx.state.inputs.toM).length;

/** A day by its number on screen, else the open one. */
function dayOf(ctx: PlanContext, p: PlanResult, n: number | undefined): DayPlan | ToolResult<never> {
  const k = n ?? ctx.screen?.day;
  if (k === undefined) return problem("Which day?");
  return p.days.find((d) => d.number === k) ?? problem(`There's no day ${k}: the trip has ${plural(p.days.length, "day")}.`);
}

/** The night after a riding day, by the day's number on screen. */
function nightAfter(p: PlanResult, d: DayPlan): NightPlan | ToolResult<never> {
  if (d.kind === "rest") return problem(`Day ${d.number} is a rest day, the second night at ${d.endName}.`);
  return p.nights.find((n) => n.afterRide === d.ride) ?? problem(`Day ${d.number} is the last day: there's no night after it.`);
}

/** Stops on the stretch by the rider's name for them; with none, the names nearest in spelling. */
function stopOf(ctx: PlanContext, name: string) {
  const { fromM, toM } = ctx.state.inputs;
  const all = ctx.data.stops.stops.filter((s) => s.at_m > Math.min(fromM, toM) && s.at_m < Math.max(fromM, toM));
  const stops = matchNames(name, all, (s) => s.name ?? s.near);
  return { stops, close: stops.length ? [] : closeNames(name, all.map((s) => s.name).filter((x): x is string => !!x)) };
}

const theTrip: Tool<PlanContext> = {
  name: "the_trip",
  description: "The trip brief: dates, km and climbing, the five questions with their answers, what's left to sort out, and each day in a line.",
  parameters: () => schema({}),
  run(ctx) {
    const p = planOf(ctx);
    const b = p.brief;
    const way = b.direction === "forward" ? "as the route runs" : "the other way";
    const days = p.days.map((d) =>
      d.kind === "rest"
        ? `Day ${d.number}, ${dayText(d.date)}: rest day at ${d.endName}.`
        : `Day ${d.number}, ${dayText(d.date)}: ${d.startName} → ${d.endName}, ${km(d.km)} km, ${hours(d.hoursSlow)} riding, ${EFFORT[d.effort]}.`,
    );
    return {
      lines: [
        `${b.title}: ${plural(p.days.length, "day")}, ${b.dates}, ${km(b.km)} km, ${Math.round(b.climbM).toLocaleString("en-GB")} m of climbing, ${way}.`,
        b.readiness,
        ...b.lines.map((l) => `${l.question} ${l.answer}${l.more ? ` (and ${l.more} more)` : ""}`),
        ...(b.confidence.length ? [`To be aware of: ${b.confidence.join("; ")}.`] : []),
        ...days,
      ],
      facts: {
        title: b.title,
        days: p.days.length,
        ridingDays: rides(p).length,
        dates: b.dates,
        km: km(b.km),
        climbM: Math.round(b.climbM).toLocaleString("en-GB"),
        readiness: b.readiness,
        brief: b.lines.map((l) => ({ question: l.question, answer: l.answer, more: l.more })),
        trip: p.mode === "free" ? "the free outline" : "with the Trip Pass",
      },
    };
  },
};

function dayLines(ctx: PlanContext, p: PlanResult, d: DayPlan): { lines: string[]; facts: Record<string, unknown> } {
  const free = !ctx.data.full;
  const weather = dayWeather(ctx.data, d);
  if (d.kind === "rest") {
    return {
      lines: [`Day ${d.number}, ${dayText(d.date)}: rest day at ${d.endName}. ${d.rest?.why ?? ""}`.trim(), ...(weather ? [weather] : [])],
      facts: { day: d.number, date: dayText(d.date), rest: true, at: d.endName, why: d.rest?.why ?? null, weather },
    };
  }
  const f = dayFacts(p, ctx.data, d, free);
  const range = d.hoursFast !== d.hoursSlow && Math.abs(d.hoursSlow - d.hoursFast) > 0.05;
  const riding = range ? `${hours(d.hoursFast)}–${hours(d.hoursSlow)}` : hours(d.hoursSlow);
  const steep = !!d.steepest && d.steepest.grade > STEEP(p.level.level).grade;
  const climb = `${Math.round(d.climbM).toLocaleString("en-GB")} m of climbing${d.unknownKm >= 1 ? ` (at least: terrain unknown for ${km(d.unknownKm)} km)` : ""}`;
  const lines = [
    `Day ${d.number}, ${dayText(d.date)}: ${d.startName} → ${d.endName}. ${km(d.km)} km, ${climb}; ${EFFORT[d.effort]}.`,
    `Riding ${riding}, about ${hours(d.hoursSlow + d.stopsMin / 60)} with stops; off at ${clock(d.startMinutes)}, in by ${clock(d.endMinutes)}${d.sunset !== null ? `, sunset ${clock(d.sunset)}${d.clockApprox ? " (approximate)" : ""}` : ""}.`,
    ...(steep ? [`Steepest ${d.steepest!.lengthKm} km: ${Math.round(d.steepest!.grade)}% at km ${Math.round(d.steepest!.atKm)}.`] : []),
    dayStory(ctx.data, d, p.items),
    // The day's big climb, as its card gives it among the heads-ups or highlights (D75).
    ...p.items.filter((i) => i.id === `climb:${d.number}`).map((i) => `${i.title}; ${i.why}`),
    ...(weather ? [weather] : []),
  ];
  if (free) lines.push(`Water and food, heads-ups, highlights and where to sleep ${PASS}.`);
  else {
    if (f.waterFood.length) lines.push(`Water and food at km ${f.thinned.map((w) => Math.round(w.at)).join(" · ")}; longest gap ${Math.round(f.longest)} km.`);
    if (p.inputs.bailouts && f.stations.length) lines.push(`Stations for going home early: ${f.stations.map((s) => `${s.p.name} (km ${Math.round(s.at)})`).join(", ")}.`);
    if (f.night) lines.push(`Night at ${stopName(f.night.stop)}: ${bedsKnown(f.night.beds, f.month, p.inputs.sleep, !!f.night.own)}.`);
  }
  return {
    lines,
    facts: {
      day: d.number,
      date: dayText(d.date),
      from: d.startName,
      to: d.endName,
      km: km(d.km),
      climbM: Math.round(d.climbM).toLocaleString("en-GB"),
      effort: EFFORT[d.effort],
      riding,
      offAt: clock(d.startMinutes),
      inBy: clock(d.endMinutes),
      sunset: d.sunset === null ? null : clock(d.sunset),
      weather,
    },
  };
}

/**
 * Water and food between two towns on the stretch (D80): by km of the trip, as the day cards give them by km of the
 * day, and the longest stretch without. Not loaded is never none (D37).
 */
function between(ctx: PlanContext, p: PlanResult, fromName: string, toName: string): ToolResult<never> {
  if (!ctx.data.full) return problem(`Water and food along the way ${PASS}.`);
  const [x, y] = [stopOf(ctx, fromName).stops[0], stopOf(ctx, toName).stops[0]];
  if (!x || !y) return problem(`"${!x ? fromName : toName}" isn't a town on this plan's stretch.`);
  const [t0, t1] = [p.axis.tOf(x.at_m), p.axis.tOf(y.at_m)].sort((m, n) => m - n) as [number, number];
  const [lo, hi] = [Math.min(x.at_m, y.at_m), Math.max(x.at_m, y.at_m)];
  if (placesMissing(ctx.data.full, lo, hi).length) return problem(`Places between ${stopName(x)} and ${stopName(y)} didn't all load: any there aren't known.`);
  const at = ctx.data.full.places
    .filter((pl) => (pl.service === "water" || pl.service === "food") && pl.counts && pl.access_at_m >= lo && pl.access_at_m <= hi)
    .map((pl) => (p.axis.tOf(pl.access_at_m) - t0) / 1000)
    .sort((m, n) => m - n);
  const pts = [0, ...at, (t1 - t0) / 1000];
  let longest = 0;
  for (let i = 1; i < pts.length; i++) longest = Math.max(longest, pts[i]! - pts[i - 1]!);
  const thinned: number[] = [];
  for (const k of at) if (!thinned.length || k - thinned[thinned.length - 1]! >= 5) thinned.push(k);
  const span = `${stopName(x)} to ${stopName(y)} (${km((t1 - t0) / 1000)} km)`;
  return {
    lines: at.length
      ? [`Water and food from ${span}: at km ${thinned.map((k) => Math.round(k)).join(" · ")} from ${stopName(x)}; longest stretch without ${Math.round(longest)} km.`]
      : [`No water or food we know of from ${span}: you judge what to carry.`],
    facts: { ok: true, from: stopName(x), to: stopName(y), km: km((t1 - t0) / 1000), at: thinned.map((k) => Math.round(k)), longest: Math.round(longest) },
  };
}

const days: Tool<PlanContext> = {
  name: "days",
  description:
    "One day, or a run of days with their totals, as the day cards say: km, climbing, hours, effort against the rider's level, times, the steepest stretch, the way, the usual weather, water and food, and the night. Without a day, the one on screen. Or between two towns: the water and food there and the longest stretch without.",
  parameters: () =>
    schema({
      day: { type: "integer", minimum: 1 },
      to: { type: "integer", minimum: 1, description: "The last day of a run." },
      from_town: { type: "string" },
      to_town: { type: "string" },
    }),
  run(ctx, args) {
    const p = planOf(ctx);
    const [a, b] = [arg.str(args, "from_town"), arg.str(args, "to_town")];
    if (a && b) return between(ctx, p, a, b);
    const first = dayOf(ctx, p, arg.int(args, "day"));
    if ("lines" in first) return first;
    const last = arg.int(args, "to");
    const run = p.days.filter((d) => d.number >= first.number && d.number <= (last ?? first.number));
    const each = run.map((d) => dayLines(ctx, p, d));
    const lines = each.flatMap((e) => e.lines);
    const ridden = run.filter((d) => d.kind === "ride");
    let total: Record<string, string> | null = null;
    if (run.length > 1 && ridden.length) {
      total = {
        km: km(ridden.reduce((a, d) => a + d.km, 0)),
        climbM: Math.round(ridden.reduce((a, d) => a + d.climbM, 0)).toLocaleString("en-GB"),
        riding: hours(ridden.reduce((a, d) => a + d.hoursSlow, 0)),
      };
      lines.push(`Days ${first.number}–${run[run.length - 1]!.number} together: ${total.km} km, ${total.climbM} m of climbing, about ${total.riding} riding.`);
    }
    return { lines, facts: { days: each.map((e) => e.facts), ...(total ? { total } : {}) } };
  },
};

const items: Tool<PlanContext> = {
  name: "items",
  description:
    "What the plan raises: calls to make, things to sort out, heads-ups, highlights and things to be aware of, each with why. Filter by day or kind; 'left' gives what's still to sort out before the trip, calls first.",
  parameters: () =>
    schema({
      day: { type: "integer", minimum: 1 },
      kind: { type: "string", enum: ["call", "todo", "headsup", "highlight", "note"] },
      left: { type: "boolean", description: "Only what's left to sort out (the to-do)." },
    }),
  run(ctx, args) {
    const p = planOf(ctx);
    const n = arg.int(args, "day");
    const kind = arg.str(args, "kind") as PlanItem["kind"] | undefined;
    let list: PlanItem[];
    let more = 0;
    if (arg.bool(args, "left")) list = toDo(p.items, p.choices).open;
    else if (n !== undefined) {
      // A day's items within its attention budget, as its card shows them (11.6).
      const di = dayItems(p.items, n);
      list = [...di.calls, ...di.todos, ...di.headsups.shown, ...di.highlights.shown, ...p.items.filter((i) => i.day === n && i.kind === "note")];
      more = di.headsups.more + di.highlights.more;
    } else list = p.items.filter((i) => !p.choices.dismissed.includes(i.id));
    if (kind) list = list.filter((i) => i.kind === kind);
    if (n !== undefined && arg.bool(args, "left")) list = list.filter((i) => i.day === n);
    const cap = 10;
    more += Math.max(0, list.length - cap);
    const shown = list.slice(0, cap).map((i) => ({ id: i.id, kind: KIND[i.kind], day: i.day, title: i.title, why: i.why, ...(i.options ? { options: i.options.map((o) => o.label) } : {}) }));
    if (!shown.length) return { lines: [arg.bool(args, "left") ? "Nothing left to sort out: everything is taken care of." : "Nothing of that kind in the plan."], facts: { items: [] } };
    return {
      lines: [
        ...shown.map((i) => `${i.kind}${i.day ? ` (day ${i.day})` : ""}: ${i.title}.${i.why ? ` ${sentence(i.why)}` : ""}${i.options ? ` Options: ${i.options.join(" / ")}.` : ""}`),
        ...(more ? [`And ${more} more.`] : []),
        ...(p.mode === "free" ? [`The plan's items in full ${PASS}.`] : []),
      ],
      facts: { items: shown, more },
    };
  },
};

const night: Tool<PlanContext> = {
  name: "night",
  description: "Where to sleep on a night: the places at its stop and what we know of their opening, the other options nearby, why the plan stops there, the booking searches, and what's settled. By the day the night follows, or the town.",
  parameters: () => schema({ after_day: { type: "integer", minimum: 1 }, town: { type: "string" } }),
  run(ctx, args) {
    const p = planOf(ctx);
    let n: NightPlan | undefined;
    const town = arg.str(args, "town");
    if (town) {
      n = matchNames(town, p.nights, (x) => stopName(x.stop))[0];
      if (!n) return problem(`No night at "${town}" in this plan. Nights: ${p.nights.map((x) => stopName(x.stop)).join(", ")}.`);
    } else {
      const d = dayOf(ctx, p, arg.int(args, "after_day"));
      if ("lines" in d) return d;
      const x = nightAfter(p, d);
      if ("lines" in x) return x;
      n = x;
    }
    const d = p.days.find((x) => x.ride === n!.afterRide)!;
    const stay = nightStay(n, p.restAfter, p.inputs);
    const nights = nightsAt(n, p.restAfter, p.inputs);
    const month = MONTHS_LONG[monthOf(n.date)]!;
    const lines = [
      `The night after day ${d.number} (${stayDates(stay.checkIn, stay.checkOut)}${nights > 1 ? `, ${nights} nights` : ""}): ${stopName(n.stop)}: ${bedsKnown(n.beds, month, p.inputs.sleep, !!n.own)}.`,
      n.whyOther,
    ];
    const facts: Record<string, unknown> = { afterDay: d.number, at: stopName(n.stop), dates: stayDates(stay.checkIn, stay.checkOut), beds: bedsKnown(n.beds, month, p.inputs.sleep, !!n.own) };
    if (!ctx.data.full) lines.push(`The places to stay and their links ${PASS}.`);
    else {
      const o = nightOptions(ctx.data, p, n);
      const code = (pl: (typeof o.here)[number]) => pl.months[monthOf(n.date)];
      const here = o.here.slice(0, 6).map((pl) => `${placeTitle(pl, stopName(n.stop))} (${placeKind(pl)}${code(pl) === "o" ? `, open in ${month}` : code(pl) === "p" ? `, partly open in ${month}` : ""})`);
      if (here.length) lines.push(`Here: ${here.join("; ")}${o.here.length > 6 ? `; and ${o.here.length - 6} more` : ""}.`);
      const others = o.others.map((x) => `${placeTitle(x.place, x.stop ? stopName(x.stop) : null)} (${placeKind(x.place)}), ${km(Math.abs(x.km))} km ${x.km >= 0 ? "on" : "back"}`);
      if (others.length || o.wildCamp) lines.push(`Other options: ${[...others, ...(o.wildCamp ? ["a wild camp, if it's allowed and feasible"] : [])].join("; ")}.`);
      const search = bookingSearches(n, { ...p.inputs, restAfter: p.restAfter });
      if (search.length) lines.push(`None of these suit? Search ${search.map((h) => h.label).join(" or ")} for ${n.stop.name ?? "places near this stop"}, ${stayDates(stay.checkIn, stay.checkOut)}.`);
      Object.assign(facts, { here, others });
    }
    // The day card's "Stay somewhere else this night": the other stops, with this day's and the next day's km (D80).
    const stops = n.alternatives.map((a) => {
      const b = bedsFor(a.stop, p.inputs.sleep, monthOf(n!.date));
      const beds = b.count - b.closed ? bedKinds(b.kinds) : `no known ${sleepNoun(p.inputs.sleep)}`;
      return `${stopName(a.stop)}: this day ${km(a.dayKm)} km, next day ${a.nextKm === null ? "–" : `${km(a.nextKm)} km`} (${beds})`;
    });
    if (stops.length) {
      lines.push(`Other stops for this night: ${stops.join("; ")}.`);
      facts.otherStops = stops;
    }
    // What settled it, as the to-do says; its nudges are the to-do's, and the night's line above says the same (D64).
    const line = p.items.find((i) => i.id.startsWith(`bed:${n!.index}:`));
    if (line?.settled) lines.push(`Settled: ${line.settled}.`);
    return { lines: lines.filter(Boolean), facts };
  },
};

const restDay: Tool<PlanContext> = {
  name: "rest_day",
  description: "A rest day: its town and why it's there, the usual weather, what to see and where to eat, what else is in town, and where else it could go. By its day, or the town.",
  parameters: () => schema({ day: { type: "integer", minimum: 1 }, town: { type: "string" } }),
  run(ctx, args) {
    const p = planOf(ctx);
    const rests = p.days.filter((d) => d.kind === "rest");
    if (!rests.length) return problem("This plan has no rest days.");
    const town = arg.str(args, "town");
    const found = town ? matchNames(town, rests, (d) => d.endName)[0] : undefined;
    const d0 = found ?? (town ? undefined : dayOf(ctx, p, arg.int(args, "day")));
    if (!d0) return problem(`No rest day at "${town}". Rest days: ${rests.map((d) => `day ${d.number} at ${d.endName}`).join(", ")}.`);
    if ("lines" in d0) return d0;
    if (d0.kind !== "rest") return problem(`Day ${d0.number} isn't a rest day. Rest days: ${rests.map((d) => `day ${d.number} at ${d.endName}`).join(", ")}.`);
    const base = dayLines(ctx, p, d0);
    const r = ctx.data.full ? restFacts(p, ctx.data, d0) : null;
    if (!r) return { lines: [...base.lines, `What to see and eat there ${PASS}.`], facts: base.facts };
    const dayNo = (ride: number) => p.days.find((x) => x.ride === ride)?.number;
    const lines = [
      ...base.lines,
      ...(r.sights.length ? [`To see: ${r.sights.map((h) => h.name).join("; ")}.`] : []),
      ...(r.food.length ? [`To eat: ${r.food.map(({ p: pl, open }) => `${placeTitle(pl, d0.endName)}${open ? " (open that day)" : ""}`).join("; ")}.`] : []),
      ...(r.services.length ? [`In town: ${r.services.join(" · ")}.`] : []),
      `Where else it could go: ${r.moves.filter((m) => !m.current).map((m) => `after day ${dayNo(m.afterRide)}, ${stopName(m.stop)}${m.text ? ` (${m.text})` : ""}`).join("; ") || "nowhere nearby"}.`,
    ];
    return { lines, facts: { ...base.facts, sights: r.sights.map((h) => h.name), services: r.services } };
  },
};

const usualWeatherTool: Tool<PlanContext> = {
  name: "usual_weather",
  description:
    "The usual weather (averages over past years, never a forecast) on the trip, or one day, in a month: night lows to day highs and how often it rains; without a month, the trip's own month, or the best months when asked for them. There is no smoke or wildfire data.",
  parameters: () => schema({ day: { type: "integer", minimum: 1 }, month: { type: "string", enum: MONTHS_ENUM }, best: { type: "boolean", description: "The best months." } }),
  run(ctx, args) {
    const p = planOf(ctx);
    const n = arg.int(args, "day");
    const d = n === undefined ? null : dayOf(ctx, p, n);
    if (d && "lines" in d) return d;
    const nums = new Set((d ? [d] : p.days).flatMap((x) => x.sections));
    const secs = ctx.data.dream.sections.filter((s) => nums.has(s.number));
    const where = d ? `day ${d.number}` : p.brief.title;
    const month = arg.bool(args, "best") ? null : (monthIndex(arg.str(args, "month")) ?? monthOf(d?.date ?? ctx.state.inputs.startDate));
    return weatherIn(secs, where, month);
  },
};

const findStop: Tool<PlanContext> = {
  name: "find_stop",
  description: "A town the rider names on the plan's stretch: which day passes it and at what km, and whether a night is there.",
  parameters: () => schema({ name: { type: "string" } }, ["name"]),
  run(ctx, args) {
    const name = arg.str(args, "name");
    if (!name) return problem("Which town?");
    const p = planOf(ctx);
    const { stops: found, close } = stopOf(ctx, name);
    if (!found.length) return problem(`"${name}" isn't on this plan's stretch${close.length ? `. Close names: ${close.join(", ")}` : ""}.`, { close });
    const stops = found.slice(0, 3);
    const out = stops.map((s) => {
      const t = p.axis.tOf(s.at_m);
      const d = rides(p).find((x) => t >= x.fromT - 1 && t <= x.toT + 1);
      const n = p.nights.find((x) => x.stop.id === s.id);
      const nd = n ? p.days.find((x) => x.ride === n.afterRide) : undefined;
      return {
        name: stopName(s),
        tripKm: km(t / 1000),
        day: d?.number ?? null,
        dayKm: d ? km(Math.max(0, (t - d.fromT) / 1000)) : null,
        night: nd ? `the night after day ${nd.number}` : null,
      };
    });
    return {
      lines: out.map((s) => `${s.name}: km ${s.tripKm} of the trip${s.day ? `, on day ${s.day} at km ${s.dayKm}` : ""}${s.night ? `; ${s.night} is there` : ""}.`),
      facts: { ok: true, stops: out },
    };
  },
};

// --- offering changes ----------------------------------------------------------------------------------------------

/** A change built as the screen builds it, with what the rider should know about it that the plan's changes don't say. */
type Built = { action: PlanAction; note?: string } | { error: string };

/** One change in the rider's terms, built as the screen's control for it would (D77). */
function build(ctx: PlanContext, state: PlanState, c: Record<string, unknown>): Built {
  const p = ctx.planFor(state);
  const inputs = state.inputs;
  const own = fileNights(ctx);
  const riding = (n: number | undefined) => {
    const d = n === undefined ? undefined : p.days.find((x) => x.number === n);
    return d?.kind === "ride" ? d : undefined;
  };
  switch (arg.str(c, "do")) {
    case "set": {
      let next: PlanInputs = { ...inputs };
      const date = arg.str(c, "start_date");
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `"${date}" isn't a date (YYYY-MM-DD).` };
        next.startDate = date;
      }
      const total = arg.int(c, "total_days");
      if (total !== undefined) next = withTotalDays(next, total, own);
      const level = arg.int(c, "level");
      if (level !== undefined) next.level = Math.min(5, Math.max(1, level));
      const pick = <K extends keyof PlanInputs>(key: K, name: string, allowed: readonly string[]) => {
        const v = arg.str(c, name);
        if (v && allowed.includes(v)) next = { ...next, [key]: v };
      };
      pick("bike", "bike", ["road", "touring", "gravel", "ebike", "bikepacking"]);
      pick("sleep", "sleep", ["camping", "rooms", "mix"]);
      pick("stopStyle", "stops_during_day", ["short", "normal", "long"]);
      pick("direction", "direction", ["forward", "reverse"]);
      const off = arg.str(c, "off_at");
      if (off) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(off);
        if (!m) return { error: `"${off}" isn't a time (HH:MM).` };
        next.startMinutes = Number(m[1]) * 60 + Number(m[2]);
      }
      for (const [key, name] of [["avoidBusy", "avoid_busy"], ["avoidGravel", "avoid_gravel"], ["travel", "trains_there_and_back"], ["bailouts", "stations_for_going_home"]] as const) {
        const v = arg.bool(c, name);
        if (v !== undefined) next = { ...next, [key]: v };
      }
      return { action: { type: "set", inputs: next } };
    }
    case "rest_days": {
      const n = arg.int(c, "count");
      return n === undefined ? { error: "How many rest days?" } : { action: { type: "set", inputs: withRestDays(inputs, Math.max(0, n), own) } };
    }
    case "rest_in": {
      const town = arg.str(c, "town") ?? "";
      const stop = stopOf(ctx, town).stops[0];
      if (!stop || !stop.name) return { error: `"${town}" isn't a town on this stretch.` };
      // A longer stay: 2 or 3 rest days in a row (D80).
      const action = restInAction(p, stop, Math.min(MAX_REST_LENGTH, Math.max(1, arg.int(c, "days") ?? 1)));
      return action ? { action } : { error: "A one-day trip has no night to rest." };
    }
    case "rest_length": {
      // "Stay another day" or "One day fewer" where a rest day is (D80).
      const town = arg.str(c, "town");
      const r = town ? matchNames(town, p.days.filter((x) => x.kind === "rest"), (x) => x.endName)[0] : p.days.find((x) => x.number === arg.int(c, "rest_day") && x.kind === "rest");
      const before = r && p.days.filter((x) => x.number < r.number && x.kind === "ride").pop();
      const n = arg.int(c, "days");
      if (!before || n === undefined) return { error: "Which rest day, and how many days in a row?" };
      return { action: restLengthAction(p, before.ride!, Math.min(MAX_REST_LENGTH, Math.max(1, n))) };
    }
    case "be_in_by": {
      // The planner works out the start (D80); the model never does.
      const m = /^(\d{1,2}):(\d{2})$/.exec(arg.str(c, "time") ?? "");
      if (!m) return { error: "Be in by what time (HH:MM)?" };
      const by = Number(m[1]) * 60 + Number(m[2]);
      const { start, late } = beInBy(p, by);
      const note = late.length ? `${late.length === 1 ? "Day" : "Days"} ${numberList(late)} still ${late.length === 1 ? "ends" : "end"} after ${clock(by)}` : `Every day in by ${clock(by)}`;
      return { action: { type: "set", inputs: { ...inputs, startMinutes: start } }, note };
    }
    case "add_rest": {
      const d = riding(arg.int(c, "after_day"));
      return d ? { action: restAfterAction(p, d.ride!, true) } : { error: "After which riding day?" };
    }
    case "remove_rest": {
      const r = p.days.find((x) => x.number === arg.int(c, "rest_day") && x.kind === "rest");
      const before = r && p.days.filter((x) => x.number < r.number && x.kind === "ride").pop();
      return before ? { action: restAfterAction(p, before.ride!, false) } : { error: "Which rest day?" };
    }
    case "move_rest": {
      const r = p.days.find((x) => x.number === arg.int(c, "rest_day") && x.kind === "rest");
      const before = r && p.days.filter((x) => x.number < r.number && x.kind === "ride").pop();
      const to = riding(arg.int(c, "after_day"));
      return before && to ? { action: restMoveAction(p, before.ride!, to.ride!) } : { error: "Which rest day, and after which riding day?" };
    }
    case "stop_at": {
      const stop = stopOf(ctx, arg.str(c, "town") ?? "").stops[0];
      if (!stop) return { error: `"${arg.str(c, "town") ?? ""}" isn't a town on this stretch.` };
      // Without a day, the night nearest the town moves there, as "Rest in…" picks its night (D80).
      const d = riding(arg.int(c, "after_day"));
      const n = d ? p.nights.find((x) => x.afterRide === d.ride) : p.nights.reduce<NightPlan | undefined>((b, x) => (!b || Math.abs(x.stop.at_m - stop.at_m) < Math.abs(b.stop.at_m - stop.at_m) ? x : b), undefined);
      return n ? { action: { type: "lock-night", night: n.index, stop: stop.id } } : { error: "A one-day trip has no night to move." };
    }
    case "stay_at": {
      const d = riding(arg.int(c, "after_day"));
      const n = d && p.nights.find((x) => x.afterRide === d.ride);
      if (!n) return { error: "Which night?" };
      const place = arg.str(c, "place") ?? "";
      if (/wild\s*camp/i.test(place)) return inputs.sleep === "rooms" ? { error: "A wild camp needs a tent: you sleep in rooms." } : { action: { type: "bed", night: n.index, place: WILD_CAMP } };
      if (!ctx.data.full) return { error: `Choosing a place ${PASS}.` };
      const o = nightOptions(ctx.data, p, n);
      const here = matchNames(place, o.here, (x) => placeTitle(x, stopName(n.stop)))[0];
      if (here) return { action: { type: "bed", night: n.index, place: here.id } };
      const other = matchNames(place, o.others, (x) => placeTitle(x.place, x.stop ? stopName(x.stop) : null))[0];
      if (other?.stop) return { action: { type: "stay", night: n.index, stop: other.stop.id, place: other.place.id } };
      return { error: `"${place}" isn't one of that night's places.` };
    }
    case "booked": {
      const d = riding(arg.int(c, "after_day"));
      const n = d && p.nights.find((x) => x.afterRide === d.ride);
      const action = n && bookedAction(p, n.index, arg.bool(c, "on") ?? true);
      return action ? { action } : { error: "Which night?" };
    }
    case "answer_call": {
      const item = p.items.find((i) => i.id === arg.str(c, "call") && i.kind === "call");
      if (!item) return { error: "Which call? Use its id from the plan's items." };
      const want = arg.str(c, "option") ?? "";
      const option = item.options?.find((o) => o.id === want) ?? matchNames(want, item.options ?? [], (o) => o.label)[0];
      const out = option && optionOutcome(item, option.id);
      if (!out) return { error: `"${want}" isn't one of that call's options.` };
      return "action" in out ? out : { error: `That's done on day ${out.showDay}'s card: pick the night's stop there.` };
    }
    case "tick": {
      const item = p.items.find((i) => i.id === arg.str(c, "item") && i.kind === "todo");
      return item ? { action: { type: "done", item: item.id, on: arg.bool(c, "done") ?? true } } : { error: "Which to-do? Use its id from the plan's items." };
    }
    case "i_know": {
      const item = p.items.find((i) => i.id === arg.str(c, "item"));
      return item ? { action: { type: "dismiss", item: item.id } } : { error: "Which item? Use its id from the plan's items." };
    }
    default:
      return { error: `"${String(c.do)}" isn't a change the plan knows.` };
  }
}

/** What a change that moves no day settles: "Night of Sat 16 Oct at Benicarló: Chosen: Camping Vizmar". */
function settles(after: PlanResult, a: PlanAction): string {
  if (a.type === "dismiss") return "No longer raised";
  if (a.type === "done") return a.on ? "Ticked off" : "Back on the to-do";
  if ("night" in a && typeof a.night === "number") {
    const n = after.nights[a.night];
    const line = after.items.find((i) => i.id.startsWith(`bed:${a.night}:`));
    if (n) return `Night of ${dayText(n.date)} at ${stopName(n.stop)}: ${line?.settled ?? (a.type === "lock-night" ? "kept there" : "still to sort")}`;
  }
  return "Kept as it is";
}

const CHANGE = schema(
  {
    do: { type: "string", enum: ["set", "rest_days", "rest_in", "rest_length", "add_rest", "remove_rest", "move_rest", "be_in_by", "stop_at", "stay_at", "booked", "answer_call", "tick", "i_know"] },
    days: { type: "integer", minimum: 1, maximum: 3, description: "Rest days in a row in one town." },
    time: { type: "string", description: "HH:MM" },
    start_date: { type: "string", description: "YYYY-MM-DD" },
    total_days: { type: "integer", minimum: 1, maximum: 60 },
    level: { type: "integer", minimum: 1, maximum: 5 },
    bike: { type: "string", enum: ["road", "touring", "gravel", "ebike", "bikepacking"] },
    sleep: { type: "string", enum: ["camping", "rooms", "mix"] },
    off_at: { type: "string", description: "HH:MM" },
    stops_during_day: { type: "string", enum: ["short", "normal", "long"] },
    direction: { type: "string", enum: ["forward", "reverse"] },
    avoid_busy: { type: "boolean" },
    avoid_gravel: { type: "boolean" },
    trains_there_and_back: { type: "boolean" },
    stations_for_going_home: { type: "boolean" },
    count: { type: "integer", minimum: 0 },
    town: { type: "string" },
    place: { type: "string" },
    after_day: { type: "integer", minimum: 1 },
    rest_day: { type: "integer", minimum: 1 },
    on: { type: "boolean" },
    call: { type: "string" },
    option: { type: "string" },
    item: { type: "string" },
    done: { type: "boolean" },
  },
  ["do"],
);

const offerOptions: Tool<PlanContext, PlanApply> = {
  name: "offer_options",
  description:
    "Offer the rider changes to the plan, as up to four options of up to three changes each; each says what it would change, previews on the plan when chosen, and applies only if the rider applies it. Use it for 'what if' questions too. Days are numbered as on screen.",
  parameters: () =>
    schema(
      { options: { type: "array", minItems: 1, maxItems: 4, items: schema({ label: { type: "string" }, changes: { type: "array", minItems: 1, maxItems: 3, items: CHANGE } }, ["changes"]) } },
      ["options"],
    ),
  run(ctx, args) {
    const before = planOf(ctx);
    const options: ToolOption<PlanApply>[] = [];
    const problems: string[] = [];
    for (const o of (arg.list(args, "options") ?? []).slice(0, 4)) {
      if (!o || typeof o !== "object") continue;
      const changes = (arg.list(o as Record<string, unknown>, "changes") ?? []).slice(0, 3);
      let state = ctx.state;
      const actions: PlanAction[] = [];
      const notes: string[] = [];
      let failed: string | null = null;
      for (const c of changes) {
        if (!c || typeof c !== "object") continue;
        const b = build(ctx, state, c as Record<string, unknown>);
        if ("error" in b) {
          failed = b.error;
          break;
        }
        actions.push(b.action);
        if (b.note) notes.push(b.note);
        state = applyAction(state, b.action);
      }
      if (failed) {
        problems.push(failed);
        continue;
      }
      const after = ctx.planFor(state);
      const what = planChanges(before, after);
      // A place chosen, a booking, a tick or "I know" changes no day: what it settles is the change, as the to-do says it.
      // What it adds to the to-do (getting there and back, a booking to change): the to-do's own lines.
      const was = new Set(before.items.map((i) => i.id));
      const added = after.items.filter((i) => i.kind === "todo" && !was.has(i.id) && !i.id.startsWith("bed:")).map((i) => `New on the to-do: ${i.title}`);
      const lines = [...(what.lines.length ? what.lines : actions.map((x) => settles(after, x))), ...added, ...notes];
      const label = arg.str(o as Record<string, unknown>, "label") ?? lines[0] ?? "A change";
      options.push({ id: `plan:${options.length + 1}`, label, changes: lines, apply: { state, actions } });
    }
    if (!options.length) return problem(problems[0] ?? "No change to offer: the plan already is that way.", { problems });
    return {
      // The label said once: when it is the first change, the line doesn't repeat it.
      lines: [...options.map((o) => `${o.label}${o.changes[0] === o.label ? (o.changes.length > 1 ? `; ${o.changes.slice(1).join("; ")}` : "") : `: ${o.changes.join("; ")}`}.`), ...problems.map((x) => `Left out: ${x}`)],
      facts: { ok: true, options: options.map((o) => ({ label: o.label, changes: o.changes })), problems },
      options,
    };
  },
};

export const PLAN_TOOLS = [theTrip, days, items, night, restDay, findStop, usualWeatherTool, offerOptions] as Tool<PlanContext, PlanApply>[];

