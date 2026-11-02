/**
 * Understand, then our code (A3, D99): the model reads the rider's words and what's on screen and writes one small
 * request, forced to its phase's schema; our code turns the request into the tool calls, makes every option there is
 * and says the declines in our own words. The model chooses nothing else and claims nothing: it never says it changed
 * anything. Its one other job, as a measured extra, is to reword the tools' lines, through the honesty check.
 */
import { type Ask, countryRows, keyOf, sectionsOf, stretchesFor } from "@dpg/dream";
import { country, monthOf, nightOptions, placeTitle, type PlanResult, stopName } from "@dpg/planner";
import type { DreamContext } from "./dream";
import { checkAnswer, toolLines } from "./honesty";
import type { Model, StepStats } from "./model/model";
import { matchNames } from "./names";
import type { PlanContext } from "./plan";
import { monthIndex, MONTHS_ENUM, type ToolResult } from "./tool";

export type PhaseName = "dream" | "plan";

/** What the model understood: a kind, and the few details it takes. */
export interface Request {
  kind: string;
  [detail: string]: unknown;
}

interface Kind {
  kind: string;
  /** For the model: when this is the request. */
  about: string;
  details?: Record<string, object>;
  required?: string[];
}

export const LEVELS = ["Leisurely", "Easy-moderate", "Moderate", "Challenging", "Tough"];
const DAY = { type: "integer", minimum: 1, maximum: 60 };
const NUMBER = { type: "integer", minimum: 1, maximum: 50 };
const TOWN = { type: "string" };
const MONTH = { type: "string", enum: MONTHS_ENUM };
const LEVEL = { type: "string", enum: LEVELS };
/** The rider asked about smoke or wildfires, which we have no data on. */
const SMOKE = { type: "boolean" };
const NO_SMOKE = "There's no smoke or wildfire data here: check local sources closer to the time.";
/** The weather in a month to come (D84): the usual weather, never a forecast. */
const TYPICAL = "It's too early to tell what the weather will be, but this is what's typical:";

/** What we don't help with, by its reason: each has our own sentence (D77, D84). */
export const REASONS = [
  "kit", "booking", "medical", "safety", "reviews", "other_routes", "history", "wildlife", "fire", "forecast", "directions",
  "cost", "insurance", "visa", "strikes", "water_quality", "availability", "repairs", "other",
] as const;
type Reason = (typeof REASONS)[number];

const decline: Kind = {
  kind: "decline",
  about:
    "Something we don't help with, by its reason: kit (packing, gear, clothes), booking (booking anything), medical (health, injuries), safety (whether a place, road or thing is safe), reviews (whether a place to eat or stay is good), other_routes, history (the history of places), wildlife, fire (fire bans), forecast (the weather forecast for a date), directions (turn-by-turn), cost (prices), insurance, visa, strikes, water_quality (swimming), availability (whether a place has room), repairs (fixing the bike), other.",
  details: { reason: { type: "string", enum: REASONS }, day: DAY, town: TOWN, place: { type: "string", description: "A place to eat or stay, as they named it." } },
  required: ["reason"],
};
const unclear: Kind = { kind: "unclear", about: "It isn't clear what the rider wants." };

const PLAN_KINDS: Kind[] = [
  { kind: "trip", about: "The trip as a whole: what it's like, whether they can do it, the hardest days, whether there's a campsite or a room every night." },
  { kind: "day", about: "One day: what it's like, its distance, climbing, surface, water and food.", details: { day: DAY } },
  { kind: "day_why", about: "Why a day is so long, short or hard.", details: { day: DAY } },
  { kind: "water_between", about: "Water and food between two towns.", details: { town: TOWN, to_town: TOWN }, required: ["town", "to_town"] },
  { kind: "night", about: "Where they sleep on a night, by the day it follows or the town.", details: { day: DAY, town: TOWN } },
  { kind: "rest_day", about: "A rest day: what's there, where to eat.", details: { day: DAY, town: TOWN } },
  { kind: "weather", about: "The usual weather on the trip or a day, in its own month or another; give two months to compare them.", details: { month: MONTH, other_month: MONTH, day: DAY, smoke: SMOKE } },
  { kind: "best_months", about: "Which months are best for the trip.", details: { smoke: SMOKE } },
  { kind: "left_to_do", about: "What's still to sort out before the trip." },
  { kind: "decisions", about: "The decisions they have to make." },
  { kind: "heads_up", about: "What to look out for on a day, such as busy roads.", details: { day: DAY } },
  { kind: "note", about: "Something marked on a day to be aware of, such as a gap.", details: { day: DAY } },
  { kind: "to_do", about: "Why the plan says to do something (book ahead, carry water, a filter).", details: { day: DAY, town: TOWN } },
  { kind: "find", about: "When they reach a town, and whether a night is there.", details: { town: TOWN }, required: ["town"] },
  { kind: "add_rest", about: "A rest day after a riding day they name.", details: { day: DAY }, required: ["day"] },
  { kind: "rest_in", about: "Rest days, or a longer stay, in a town they name.", details: { town: TOWN, days: { type: "integer", minimum: 1, maximum: 3 } }, required: ["town"] },
  { kind: "move_rest", about: "Move their rest day to another town.", details: { town: TOWN }, required: ["town"] },
  { kind: "stop_at", about: "Stop for the night at a town, perhaps instead of another.", details: { town: TOWN, instead_of: TOWN, day: DAY }, required: ["town"] },
  { kind: "stop_at_towns", about: "Nights at two or three towns they name.", details: { towns: { type: "array", items: TOWN, minItems: 2, maxItems: 3 } }, required: ["towns"] },
  { kind: "easier_day", about: "Make a day shorter or easier.", details: { day: DAY }, required: ["day"] },
  { kind: "longer_day", about: "Ride further on a day.", details: { day: DAY }, required: ["day"] },
  { kind: "be_in_by", about: "Finish every day by a time.", details: { time: { type: "string", description: "HH:MM" } }, required: ["time"] },
  { kind: "more_days", about: "More days on the trip.", details: { count: { type: "integer", minimum: 1, maximum: 5 } } },
  { kind: "day_off", about: "Take a day off the trip." },
  { kind: "level", about: "What if they rode at another level.", details: { level: LEVEL }, required: ["level"] },
  { kind: "another_month", about: "Move the trip to another month: a change to the plan, not a question about the weather.", details: { month: MONTH }, required: ["month"] },
  { kind: "bike", about: "The bike they ride.", details: { bike: { type: "string", enum: ["road", "touring", "gravel", "ebike", "bikepacking"] } }, required: ["bike"] },
  { kind: "sleep", about: "Camping, rooms or a mix.", details: { sleep: { type: "string", enum: ["camping", "rooms", "mix"] } }, required: ["sleep"] },
  { kind: "other_way", about: "Ride it the other way." },
  { kind: "trains", about: "Trains to the start and home: in the plan (on true), or not (on false); transport home.", details: { on: { type: "boolean" } }, required: ["on"] },
  { kind: "bail_out", about: "Stations for going home early (bailing out)." },
  { kind: "booked", about: "They've booked the place for a night.", details: { day: DAY, town: TOWN } },
  { kind: "wild_camp", about: "Wild camp on a night.", details: { day: DAY }, required: ["day"] },
  decline,
  unclear,
];

function dreamKinds(ctx: DreamContext): Kind[] {
  const COUNTRY = { type: "string", enum: countryRows(sectionsOf(ctx.route)).map((r) => country(r.cc)) };
  return [
    { kind: "overview", about: "The route as a whole: what it's like, its countries." },
    { kind: "fit", about: "Whether they're up to it or can do it in their days, or how many days it takes at their level." },
    { kind: "stretches", about: "The stretches that fit their question." },
    { kind: "more", about: "More stretches after the first ones." },
    { kind: "sleep_choice", about: "Whether they can camp, or stay in rooms, every night." },
    { kind: "weather", about: "The usual weather on a stretch or the route, in a month.", details: { number: NUMBER, month: MONTH, smoke: SMOKE } },
    { kind: "best_months", about: "The best time of year to ride.", details: { number: NUMBER, smoke: SMOKE } },
    { kind: "describe", about: "What it's like from one town to another.", details: { town: TOWN, to_town: TOWN }, required: ["town", "to_town"] },
    { kind: "compare", about: "Two stretches from the list side by side, by their numbers.", details: { number: NUMBER, other_number: NUMBER }, required: ["number", "other_number"] },
    { kind: "find", about: "Where a town is on the route.", details: { town: TOWN }, required: ["town"] },
    { kind: "plan_this", about: "Plan a stretch.", details: { number: NUMBER } },
    {
      kind: "question",
      about:
        "Change what they ask Dream for, giving only what they said: a level they name, or how they ride (riding: gentle, fit, strong, easier or harder than now); days; month; pace; scenery; rooms or camping; a country to stay in (only_country) or to avoid (avoid_country); a town to pass through; trains at both ends; gravel; no rest days.",
      details: {
        level: LEVEL,
        riding: { type: "string", enum: ["gentle", "fit", "strong", "easier", "harder"] },
        days: DAY,
        month: { type: "string", enum: [...MONTHS_ENUM, "any"] },
        pace: { type: "string", enum: ["relaxed", "steady", "moving"] },
        themes: { type: "array", items: { type: "string", enum: ctx.route.dream.themes.map((t) => t.id) } },
        stay: { type: "string", enum: ["any", "rooms", "camping"] },
        only_country: COUNTRY,
        avoid_country: COUNTRY,
        through: TOWN,
        trains: { type: "boolean" },
        gravel: { type: "string", enum: ["prefer", "ok", "avoid"] },
        no_rest: { type: "boolean" },
      },
    },
    decline,
    unclear,
  ];
}

export const kindsOf = (phase: PhaseName, ctx: DreamContext | PlanContext): Kind[] => (phase === "dream" ? dreamKinds(ctx as DreamContext) : PLAN_KINDS);

/** The request's schema: one shape per kind, each with only its own details, forced by the runtime (D99). */
export function requestSchema(kinds: Kind[]): object {
  return {
    anyOf: kinds.map((k) => ({
      type: "object",
      properties: { kind: { const: k.kind }, ...k.details },
      required: ["kind", ...(k.required ?? [])],
      additionalProperties: false,
    })),
  };
}

/** The kinds as the prompt lists them. */
export function kindLines(kinds: Kind[], ctx: DreamContext | PlanContext, phase: PhaseName): string {
  const themes = phase === "dream" ? (ctx as DreamContext).route.dream.themes.map((t) => `${t.id} (${t.title})`).join(", ") : "";
  return [
    ...kinds.map((k) => `- ${k.kind}: ${k.about}${k.details ? ` Details: ${Object.keys(k.details).join(", ")}.` : ""}`),
    ...(themes ? [`Scenery (themes): ${themes}.`] : []),
  ].join("\n");
}

/** What the conversation remembers between turns: the day or stretch last talked about, and how far the list has gone. */
export interface Memory {
  day?: number;
  number?: number;
  shown?: number;
}

/** What our code did with a request: the tools' results, and any sentences of our own. */
export interface Acted {
  results: ToolResult<unknown>[];
  said: string[];
}

type Call = (tool: string, args: Record<string, unknown>) => ToolResult<unknown>;

const str = (r: Request, k: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim() : undefined);
const int = (r: Request, k: string) => (typeof r[k] === "number" && Number.isInteger(r[k]) ? (r[k] as number) : undefined);
const list = (r: Request, k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);

/** "4pm", "4 pm", "16", "16:00" to "16:00". */
export function clockOf(text: string | undefined): string | undefined {
  const m = text && /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
  return h <= 23 ? `${String(h).padStart(2, "0")}:${m[2] ?? "00"}` : undefined;
}

/** Our sentence for each decline (D84's voice): what we can't do, and what we can do instead. */
function declined(reason: Reason, phase: PhaseName): string {
  const days = phase === "plan" ? "each day of your plan" : "any stretch";
  const lines: Record<Reason, string> = {
    kit: `I can't help with kit or packing, but I can tell you about the surfaces and the usual weather on ${days}.`,
    booking: "I can't book anything for you, but I can show you the places to stay and the booking searches for each night.",
    medical: `I can't give medical advice: a doctor or medical professional is the one to ask. I can tell you what ${days} asks, in km and climbing.`,
    safety: "I can't tell you whether a place or a road is safe, but I can tell you about busy roads and what to look out for.",
    reviews: "I can't give reviews or rankings of places to eat or stay, but I can tell you what's at each night's stop.",
    other_routes: "I can only help with this route, not other routes, but I can find the parts of it that suit you best.",
    history: "I can't tell you the history of places, but I can tell you about the riding: the km, the climbing and the usual weather.",
    wildlife: "I can't tell you about wildlife on the route: local park or trail sites are the place to check.",
    fire: "I can't tell you about fire bans: check the local fire service close to your dates.",
    forecast: "I can't give a forecast, only the usual weather for the time of year: check a forecast closer to the day.",
    directions: "I can't give turn-by-turn directions, but you can take the plan's GPX into your bike computer or a navigation app.",
    cost: "I can't tell you what the trip will cost: prices for places to stay are on the booking sites.",
    insurance: "I can't advise on travel insurance: an insurer can tell you what covers a cycling trip.",
    visa: "I can't tell you whether you need a visa: check your government's official travel advice.",
    strikes: "I can't tell you about strikes or other travel news: check with the rail operator closer to the time.",
    water_quality: "I can't tell you about water quality for swimming: local signs and authorities will say.",
    availability: "I can't check availability at places to stay: the place itself or the booking sites can tell you.",
    repairs: "I can't help with bike repairs: a bike shop near your route can sort that out.",
    other: `I can't help with that, but I can tell you about ${days}, the nights and the usual weather.`,
  };
  return lines[reason];
}

const UNCLEAR = {
  plan: "I'm not sure what you'd like. You can ask me about a day, a night, the weather or what's left to sort out, or for a change to the plan.",
  dream: "I'm not sure what you'd like. You can ask me about the route, the stretches that fit, the weather, or for a change to your question.",
};
const NOTHING_NEW = "I can't see a change to what you're asking Dream for. You can ask for a level, days, a month, scenery, places to stay or a country.";

/** Turn a request into the tools' calls and options, and our own sentences (D99). */
export function act(phase: PhaseName, ctx: DreamContext | PlanContext, r: Request, memory: Memory, call: Call): Acted {
  return phase === "dream" ? actDream(ctx as DreamContext, r, memory, call) : actPlan(ctx as PlanContext, r, memory, call);
}

/** Details that are only ever said when on: off is the same as not said. */
const FLAGS = new Set(["smoke", "no_rest"]);

/**
 * A request as our code reads it (D100): nothing empty, no flag that's off, the plan's towns as it names them, and no
 * detail that only repeats what's already there (the stretch on screen, the trip's own month, what Dream is already
 * asking, a number our code would take anyway) or that the kind doesn't use. Each is dropped only where our code would
 * do the same without it, so a request acts as before; the harness compares requests after this, the expected ones too.
 */
export function tidy(phase: PhaseName, ctx: DreamContext | PlanContext, r: Request, memory: Memory): Request {
  const t: Request = { kind: r.kind };
  for (const [k, v0] of Object.entries(r)) {
    const v = typeof v0 === "string" ? v0.trim() : Array.isArray(v0) ? [...new Set(v0)] : v0;
    if (k === "kind" || v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (FLAGS.has(k) && v === false)) continue;
    t[k] = v;
  }
  return phase === "dream" ? tidyDream(ctx as DreamContext, t, memory) : tidyPlan(ctx as PlanContext, t);
}

function tidyPlan(ctx: PlanContext, r: Request): Request {
  const p = ctx.planFor(ctx.state);
  for (const k of ["town", "to_town", "instead_of"]) if (str(r, k)) r[k] = townOf(ctx, str(r, k)!);
  if (Array.isArray(r.towns)) r.towns = list(r, "towns").map((x) => townOf(ctx, x));
  const night = str(r, "town") ? nightDay(p, str(r, "town")!) : undefined;
  switch (r.kind) {
    case "weather": {
      const own = p.days.find((d) => d.number === int(r, "day"))?.date ?? ctx.state.inputs.startDate;
      if (r.other_month === r.month) delete r.other_month;
      if (r.other_month === undefined && monthIndex(str(r, "month")) === monthOf(own)) delete r.month;
      break;
    }
    case "more_days":
      if (r.count === 1) delete r.count;
      break;
    case "rest_in": {
      const resting = p.days.filter((d) => d.kind === "rest" && matchNames(str(r, "town") ?? "", [d], (x) => x.endName).length).length;
      if (r.days === (resting ? resting + 1 : 1)) delete r.days;
      break;
    }
    case "booked":
    case "to_do":
      // The night at the town they name, not a day number.
      if (night !== undefined) delete r.day;
      break;
    case "decline":
      if (r.reason === "booking" || r.reason === "availability") {
        if (night !== undefined) delete r.day;
        else delete r.town;
      } else {
        delete r.day;
        delete r.town;
      }
      if (r.reason !== "reviews") delete r.place;
      break;
  }
  return r;
}

function tidyDream(ctx: DreamContext, r: Request, memory: Memory): Request {
  const a = ctx.ask;
  const list0 = stretchesFor(ctx.route, a);
  const onScreen = ctx.screen?.stretch ? list0.findIndex((s) => keyOf(s) === ctx.screen!.stretch) + 1 || undefined : undefined;
  const asked = a.month === null ? "any" : MONTHS_ENUM[a.month];
  switch (r.kind) {
    case "weather":
    case "best_months":
    case "plan_this":
      if (r.number !== undefined && r.number === (memory.number ?? onScreen)) delete r.number;
      if (r.kind === "weather" && r.month === asked) delete r.month;
      break;
    case "question": {
      const now: Record<string, unknown> = {
        level: a.level ? LEVELS[a.level - 1] : undefined, days: a.days ?? undefined, month: asked, pace: a.pace, stay: a.stay,
        trains: a.trainBothEnds, gravel: a.surfaces.gravel, through: a.through ?? undefined,
      };
      for (const [k, v] of Object.entries(now)) if (r[k] === v) delete r[k];
      if (Array.isArray(r.themes)) {
        r.themes = list(r, "themes").filter((x) => !a.themes.includes(x));
        if (!(r.themes as string[]).length) delete r.themes;
      }
      for (const [k, pref] of [["only_country", "only"], ["avoid_country", "avoid"]] as const) {
        const cc = codeOf(ctx, str(r, k));
        if (cc && a.countries[cc] === pref) delete r[k];
      }
      if (r.no_rest === true && a.pace === "moving") delete r.no_rest;
      break;
    }
    case "decline":
      for (const k of Object.keys(r)) if (k !== "kind" && k !== "reason") delete r[k];
      break;
  }
  return r;
}

/** A country's code on the route, by its name. */
function codeOf(ctx: DreamContext, name: string | undefined): string | undefined {
  return name ? countryRows(sectionsOf(ctx.route)).find((x) => country(x.cc) === name)?.cc : undefined;
}

function actPlan(ctx: PlanContext, r: Request, memory: Memory, call: Call): Acted {
  const p = ctx.planFor(ctx.state);
  const results: ToolResult<unknown>[] = [];
  const said: string[] = [];
  const run = (tool: string, args: Record<string, unknown>) => results.push(call(tool, args));
  const offer = (...changes: Record<string, unknown>[]) => run("offer_options", { changes });
  const set = (k: string, v: unknown) => offer({ do: "set", [k]: v });
  const day = int(r, "day") ?? memory.day ?? ctx.screen?.day;
  if (int(r, "day") !== undefined) memory.day = int(r, "day");
  const town = str(r, "town") ? townOf(ctx, str(r, "town")!) : undefined;

  switch (r.kind) {
    case "trip":
      run("the_trip", {});
      break;
    case "day": {
      const d = p.days.find((x) => x.number === day);
      if (d?.kind === "rest") run("rest_day", { day });
      else {
        run("days", day ? { day } : {});
        if (day) run("items", { day });
      }
      break;
    }
    case "day_why":
      run("days", day ? { day } : {});
      if (day) run("night", { after_day: day });
      break;
    case "water_between":
      run("days", { from_town: townOf(ctx, str(r, "town") ?? ""), to_town: townOf(ctx, str(r, "to_town") ?? "") });
      break;
    case "night": {
      const at = town ? nightDay(p, town) : day;
      if (at !== undefined) memory.day = at;
      run("night", at !== undefined ? { after_day: at } : town ? { town } : {});
      break;
    }
    case "rest_day": {
      const first = p.days.find((d) => d.kind === "rest")?.number;
      run("rest_day", town ? { town } : int(r, "day") ? { day: int(r, "day") } : first ? { day: first } : {});
      break;
    }
    case "weather": {
      const months = [str(r, "month"), str(r, "other_month")].filter((m): m is string => !!m);
      said.push(TYPICAL);
      for (const month of months.length ? months : [undefined]) run("usual_weather", { ...(month ? { month } : {}), ...(int(r, "day") ? { day: int(r, "day") } : {}) });
      if (r.smoke === true) said.push(NO_SMOKE);
      break;
    }
    case "best_months":
      run("usual_weather", { best: true });
      if (r.smoke === true) said.push(NO_SMOKE);
      break;
    case "left_to_do":
      run("items", { left: true });
      break;
    case "decisions":
      run("items", { kind: "call" });
      break;
    case "heads_up":
    case "note":
      run("items", { ...(int(r, "day") ? { day: int(r, "day") } : {}), kind: r.kind === "heads_up" ? "headsup" : "note" });
      break;
    case "to_do": {
      const at = (town ? nightDay(p, town) : undefined) ?? int(r, "day");
      run("items", { ...(at ? { day: at } : {}), kind: "todo" });
      break;
    }
    case "find":
      run("find_stop", { name: town ?? "" });
      break;
    case "add_rest":
      run("night", { after_day: day });
      offer({ do: "add_rest", after_day: day });
      offer({ do: "add_rest", after_day: day }, { do: "set", total_days: p.days.length + 1 });
      break;
    case "rest_in": {
      // A town they already rest in: a longer stay there (D80). Either way, the same end date or a longer trip.
      const resting = p.days.filter((d) => d.kind === "rest" && town && matchNames(town, [d], (x) => x.endName).length).length;
      const days = int(r, "days") ?? (resting ? resting + 1 : 1);
      const base = resting ? { do: "rest_length", town, days } : { do: "rest_in", town, ...(days > 1 ? { days } : {}) };
      offer(base);
      offer({ ...base, longer: true });
      break;
    }
    case "move_rest": {
      const from = p.days.find((d) => d.kind === "rest")?.number;
      const to = town ? nightDay(p, town) : undefined;
      offer({ do: "move_rest", ...(from ? { rest_day: from } : {}), ...(to ? { after_day: to } : {}) });
      break;
    }
    case "stop_at": {
      const instead = str(r, "instead_of");
      const at = int(r, "day") ?? (instead ? nightDay(p, townOf(ctx, instead)) : undefined);
      offer({ do: "stop_at", town, ...(at ? { after_day: at } : {}) });
      break;
    }
    case "stop_at_towns":
      offer(...list(r, "towns").slice(0, 3).map((t) => ({ do: "stop_at", town: townOf(ctx, t) })));
      break;
    case "easier_day":
    case "longer_day": {
      // The day card's other stops for the night before the day (easier) or after it (further), best first (D80).
      const d = p.days.find((x) => x.number === day);
      const before = r.kind === "easier_day";
      const rideDay = before ? p.days.filter((x) => x.kind === "ride" && d && x.number < d.number).at(-1) : d;
      const n = rideDay && p.nights.find((x) => x.afterRide === rideDay.ride);
      if (!d || !rideDay || !n) {
        run("days", day ? { day } : {});
        break;
      }
      run("night", { after_day: rideDay.number });
      const picks = before
        ? n.alternatives.filter((a) => a.nextKm !== null && a.nextKm < d.km).sort((a, b) => a.nextKm! - b.nextKm!)
        : n.alternatives.filter((a) => a.dayKm > d.km).sort((a, b) => b.dayKm - a.dayKm);
      for (const a of picks.slice(0, 2)) offer({ do: "stop_at", after_day: rideDay.number, town: stopName(a.stop) });
      break;
    }
    case "be_in_by":
      offer({ do: "be_in_by", time: clockOf(str(r, "time")) ?? str(r, "time") });
      break;
    case "more_days":
      set("total_days", p.days.length + (int(r, "count") ?? 1));
      break;
    case "day_off":
      set("total_days", p.days.length - 1);
      offer({ do: "rest_days", count: p.days.filter((d) => d.kind === "rest").length + 1 });
      break;
    case "level":
      set("level", LEVELS.indexOf(str(r, "level") ?? "") + 1);
      break;
    case "another_month": {
      const [y, , dd] = ctx.state.inputs.startDate.split("-");
      const m = MONTHS_ENUM.indexOf(str(r, "month") ?? "") + 1;
      if (m) set("start_date", `${y}-${String(m).padStart(2, "0")}-${dd}`);
      break;
    }
    case "bike":
    case "sleep":
      set(r.kind, str(r, r.kind));
      break;
    case "other_way":
      set("direction", ctx.state.inputs.direction === "forward" ? "reverse" : "forward");
      break;
    case "trains":
      set("trains_there_and_back", r.on !== false);
      break;
    case "bail_out":
      set("stations_for_going_home", true);
      break;
    case "booked": {
      const at = (town ? nightDay(p, town) : undefined) ?? int(r, "day");
      offer({ do: "booked", ...(at ? { after_day: at } : {}) });
      break;
    }
    case "wild_camp":
      offer({ do: "stay_at", after_day: day, place: "wild camp" });
      said.push("Check that a wild camp is allowed and feasible there before you go.");
      break;
    case "decline": {
      const reason = (REASONS as readonly string[]).includes(str(r, "reason") ?? "") ? (str(r, "reason") as Reason) : "other";
      said.push(declined(reason, "plan"));
      // A booking or a place's room: the night's own searches, where the rider books for themselves (D41).
      if (reason === "booking" || reason === "availability") {
        const at = (town ? nightDay(p, town) : undefined) ?? int(r, "day");
        if (at) run("night", { after_day: at });
      }
      // A place they ask about: the night it's listed at, with what we know of it.
      if (reason === "reviews" && str(r, "place") && ctx.data.full) {
        const n = p.nights.find((x) => {
          const o = nightOptions(ctx.data, p, x);
          return matchNames(str(r, "place")!, [...o.here, ...o.others.map((y) => y.place)], (pl) => placeTitle(pl, null)).length;
        });
        if (n) run("night", { town: stopName(n.stop) });
      }
      break;
    }
    default:
      said.push(UNCLEAR.plan);
  }
  return { results, said };
}

/** A town on the plan's stretch by the rider's name for it, as the plan names it. */
function townOf(ctx: PlanContext, name: string): string {
  const { fromM, toM } = ctx.state.inputs;
  const all = ctx.data.stops.stops.filter((s) => s.at_m > Math.min(fromM, toM) && s.at_m < Math.max(fromM, toM));
  return matchNames(name, all, (s) => s.name)[0]?.name ?? name;
}

/** The day whose night is at a town, by its number on screen. */
function nightDay(p: PlanResult, town: string): number | undefined {
  const n = matchNames(town, p.nights, (x) => stopName(x.stop))[0];
  return n ? p.days.find((d) => d.ride === n.afterRide)?.number : undefined;
}

function actDream(ctx: DreamContext, r: Request, memory: Memory, call: Call): Acted {
  const results: ToolResult<unknown>[] = [];
  const said: string[] = [];
  const run = (tool: string, args: Record<string, unknown>) => results.push(call(tool, args));
  const list0 = stretchesFor(ctx.route, ctx.ask);
  const onScreen = ctx.screen?.stretch ? list0.findIndex((s) => keyOf(s) === ctx.screen!.stretch) + 1 || undefined : undefined;
  if (int(r, "number") !== undefined) memory.number = int(r, "number");
  const number = int(r, "number") ?? memory.number ?? onScreen;

  switch (r.kind) {
    case "overview":
      run("route_overview", {});
      break;
    case "fit":
      run("stretches", {});
      run("route_overview", {});
      break;
    case "stretches":
      run("stretches", {});
      memory.shown = 3;
      break;
    case "more":
      run("stretches", { from: (memory.shown ?? 3) + 1 });
      memory.shown = (memory.shown ?? 3) + 5;
      break;
    case "sleep_choice":
      said.push("Where to sleep comes in Plan: it lists the places to stay at every night's stop once you plan a stretch.");
      run("stretches", {});
      break;
    case "weather":
      said.push(TYPICAL);
      run("usual_weather", { ...(number ? { number } : {}), ...(str(r, "month") ? { month: str(r, "month") } : {}) });
      if (r.smoke === true) said.push(NO_SMOKE);
      break;
    case "best_months":
      run("usual_weather", { best: true, ...(number ? { number } : {}) });
      if (r.smoke === true) said.push(NO_SMOKE);
      break;
    case "describe":
      run("describe_stretch", { from: str(r, "town") ?? "", to: str(r, "to_town") ?? "" });
      break;
    case "compare":
      run("compare", { a: int(r, "number"), b: int(r, "other_number") });
      break;
    case "find":
      run("find_town", { name: str(r, "town") ?? "" });
      break;
    case "plan_this":
      run("plan_this", number ? { number } : {});
      break;
    case "question":
      // Nothing left that Dream isn't already asking (see tidy): no option that changes nothing.
      if (Object.keys(r).length === 1) said.push(NOTHING_NEW);
      else for (const args of questionOptions(ctx, r)) run("set_question", args);
      // Days in a town along the way come in Plan, with its own "Rest in…" (D80).
      if (str(r, "through")) said.push(`Once you plan a stretch, "Rest in…" on Plan's day cards gives you days in ${str(r, "through")}.`);
      break;
    case "decline": {
      const reason = (REASONS as readonly string[]).includes(str(r, "reason") ?? "") ? (str(r, "reason") as Reason) : "other";
      said.push(declined(reason, "dream"));
      // Not whether it's safe, but what the stretches say to look out for.
      if (reason === "safety") run("stretches", {});
      break;
    }
    default:
      said.push(UNCLEAR.dream);
  }
  return { results, said };
}

/**
 * Dream's question as options (D77, D99): what the rider said, once; a level they named; or, from how they ride, the
 * two levels that may suit, an option each. Harder than now is a level up, or the same riding in fewer days.
 */
function questionOptions(ctx: DreamContext, r: Request): Record<string, unknown>[] {
  const base: Record<string, unknown> = {};
  for (const k of ["days", "month", "pace", "stay", "through"]) if (r[k] !== undefined) base[k] = r[k];
  if (Array.isArray(r.themes)) base.themes = r.themes;
  if (r.no_rest === true) base.pace = "moving";
  if (typeof r.trains === "boolean") base.train_both_ends = r.trains;
  if (str(r, "gravel")) base.surfaces = { gravel: str(r, "gravel") };
  const countries: Record<string, string> = {};
  for (const [k, pref] of [["only_country", "only"], ["avoid_country", "avoid"]] as const) {
    const cc = codeOf(ctx, str(r, k));
    if (cc) countries[cc] = pref;
  }
  if (Object.keys(countries).length) base.countries = countries;

  const named = LEVELS.indexOf(str(r, "level") ?? "") + 1;
  if (named) return [{ level: named, ...base }];
  const now: Ask = ctx.ask;
  const riding = str(r, "riding");
  const levels = (a: number, b: number) => [a, b].filter((l) => l >= 1 && l <= 5).map((level) => ({ level, ...base }));
  if (riding === "easier" && now.level) return levels(now.level - 1, now.level - 2);
  if (riding === "harder" && now.level) return [{ level: Math.min(5, now.level + 1), ...base }, ...(now.days && now.days > 2 ? [{ days: now.days - 2, ...base }] : [])];
  if (riding === "gentle" || riding === "easier") return levels(1, 2);
  if (riding === "fit") return levels(2, 3);
  if (riding === "strong" || riding === "harder") return levels(4, 5);
  return [base];
}

/** A conversation beside Dream or Plan in the new shape (D99). */
export interface UnderstandChat {
  phase: PhaseName;
  /** The understand step's prompt, with the phase's kinds listed. */
  prompt: string;
  schema: object;
  /** The rewording step's prompt (`prompts/<language>/words.md`), or none: the answer is the tools' lines. */
  words?: string;
  memory: Memory;
  last?: { rider: string; request: Request };
  /** What an answer may draw on (D81): every tool result so far, our own words, and the rider's. */
  results: ToolResult<unknown>[];
  rider: string[];
}

export function startUnderstanding(phase: PhaseName, ctx: DreamContext | PlanContext, prompts: { understand: string; words?: string }): UnderstandChat {
  const kinds = kindsOf(phase, ctx);
  return {
    phase,
    prompt: `${prompts.understand.trim()}\n\nThe kinds of request:\n${kindLines(kinds, ctx, phase)}`,
    schema: requestSchema(kinds),
    ...(prompts.words ? { words: prompts.words } : {}),
    memory: {},
    results: [],
    rider: [],
  };
}

export interface UnderstandOut {
  text: string;
  /** The tools' lines with our sentences, or the model's rewording of them, or the lines after a rewording failed. */
  from: "lines" | "words" | "lines after words";
  /** The model's rewording before the check, if any (D77 scores honesty on the first answer). */
  first: string;
  /** The request as our code read it (tidy), and as the model wrote it. */
  request: Request;
  raw: Request;
  said: string[];
  results: ToolResult<unknown>[];
  unsupported: string[];
  ms: { understand: number; firstWords: number; full: number };
  steps: StepStats[];
}

/** One turn: the rider's words understood, our code acting on them, and the answer (D99). */
export async function understandTurn(
  model: Model,
  chat: UnderstandChat,
  input: { rider: string; screen: string; ctx: DreamContext | PlanContext; call: Call; signal?: AbortSignal },
): Promise<UnderstandOut> {
  const start = performance.now();
  const earlier = chat.last ? `Before this, the rider asked: "${chat.last.rider}" (understood as ${JSON.stringify(chat.last.request)}).\n` : "";
  const understood = await model.json(
    { prompt: chat.prompt, tools: [], messages: [{ role: "user", text: `[${input.screen}]\n${earlier}The rider: ${input.rider}` }] },
    chat.schema,
    input.signal,
  );
  const raw: Request = understood.value && typeof understood.value === "object" && typeof (understood.value as Request).kind === "string" ? (understood.value as Request) : { kind: "unclear" };
  const request = tidy(chat.phase, input.ctx, raw, chat.memory);
  const understandMs = performance.now() - start;
  const steps = [understood.stats];

  chat.rider.push(input.rider);
  const done = act(chat.phase, input.ctx, request, chat.memory, input.call);
  chat.results.push({ lines: [input.screen, ...done.said], facts: {} }, ...done.results);
  chat.last = { rider: input.rider, request };
  const lines = [...done.said, toolLines(done.results)].filter(Boolean).join("\n");

  if (!chat.words || !done.results.length) {
    const full = performance.now() - start;
    return { text: lines, from: "lines", first: lines, request, raw, said: done.said, results: done.results, unsupported: [], ms: { understand: understandMs, firstWords: full, full }, steps };
  }
  const worded = await model.next({ prompt: chat.words, tools: [], messages: [{ role: "user", text: `The rider: ${input.rider}\n\nThe lines:\n${lines}` }] }, undefined, input.signal);
  steps.push(worded.stats);
  const check = checkAnswer(worded.text, { results: chat.results, rider: chat.rider });
  const full = performance.now() - start;
  const firstWords = understandMs + (worded.stats.firstTextMs ?? worded.stats.ms);
  return {
    text: check.ok && worded.text.trim() ? worded.text.trim() : lines,
    from: check.ok && worded.text.trim() ? "words" : "lines after words",
    first: worded.text,
    request,
    raw,
    said: done.said,
    results: done.results,
    unsupported: check.unsupported.map((u) => u.text),
    ms: { understand: understandMs, firstWords, full },
    steps,
  };
}
