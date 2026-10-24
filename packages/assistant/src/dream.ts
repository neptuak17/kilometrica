/**
 * Dream's tools (D77): the chat beside Dream, whose state is the rider's question (the chips). Each answers from the
 * same functions as Dream's page; setting the question and planning a stretch are options the rider chooses.
 */
import {
  and,
  type Ask,
  bestMonths,
  compareRows,
  countriesText,
  countryRows,
  daysNote,
  nightsNote,
  type DreamRoute,
  factsText,
  keyOf,
  PACE,
  pickedStretch,
  planLink,
  routeDescription,
  routePoints,
  sectionsOf,
  STAY,
  stretchesFor,
  stretchName,
  type StretchResult,
  surfacesText,
  WAY,
  watchLines,
  whenText,
  whole,
  whyLines,
} from "@dpg/dream";
import type { DreamSection } from "@dpg/contracts";
import { country, MONTHS_LONG, plural, usualWeather } from "@dpg/planner";
import { closeNames, matchNames } from "./names";
import { arg, monthIndex, MONTHS_ENUM, problem, schema, type Tool, type ToolOption, type ToolResult } from "./tool";

export interface DreamContext {
  route: DreamRoute;
  ask: Ask;
  /** What the rider is looking at (D77): the stretch on screen, by its key, for "this one". */
  screen?: { stretch?: string };
}

/** What a Dream option applies: a new question (the chips), or Plan opened on a stretch. */
export type DreamApply = { ask: Ask } | { plan: string };

/** Dream shows three stretches first, then five more at a time. */
const SHOWN = 3;
const MORE = 5;

const dailyOf = (ctx: DreamContext) => new Map(ctx.route.daily.map((d) => [d.number, d]));
const levelName = (ctx: DreamContext, n: number | null) => ctx.route.dream.levels.find((l) => l.level === n)?.name ?? null;

/** A stretch in the card's own words. */
function stretchFacts(ctx: DreamContext, r: StretchResult, rank?: number) {
  return {
    ...(rank !== undefined ? { number: rank } : {}),
    name: stretchName(dailyOf(ctx), r),
    facts: factsText(r, ctx.route.dream.levels, ctx.ask),
    when: whenText(r, ctx.ask) ?? null,
    why: whyLines(r).slice(0, 4),
    lookOut: watchLines(r),
    checkYourself: r.check.length,
  };
}

function stretchLines(f: ReturnType<typeof stretchFacts>): string[] {
  return [
    `${f.number !== undefined ? `${f.number}. ` : ""}${f.name}: ${f.facts}.${f.when ? ` ${f.when}.` : ""}`,
    ...(f.why.length ? [`Why it fits: ${f.why.join("; ")}.`] : []),
    ...(f.lookOut.length ? [`Look out: ${f.lookOut.join("; ")}.`] : []),
    ...(f.checkYourself ? [`${plural(f.checkYourself, "thing")} to check yourself.`] : []),
  ];
}

/** A town where a stretch can start or end (the towns between daily sections), by the rider's name for it. */
function findPoint(ctx: DreamContext, name: string): { i: number; name: string } | ToolResult<never> {
  const points = routePoints(ctx.route).map((p, i) => ({ ...p, i }));
  const found = matchNames(name, points, (p) => p.name);
  if (found[0]) return { i: found[0].i, name: found[0].name };
  const close = closeNames(name, points.map((p) => p.name));
  return problem(
    `No stretch of ${ctx.route.name} starts or ends at "${name}"${close.length ? `. Close names: ${and(close)}` : ""}. Stretches start and end at the towns between daily sections.`,
    { close },
  );
}

/** The stretch the rider means: a number from the list, a pair of towns, or the one on screen. */
function stretchOf(ctx: DreamContext, args: Record<string, unknown>): StretchResult | ToolResult<never> {
  const results = stretchesFor(ctx.route, ctx.ask);
  const n = arg.int(args, "number");
  if (n !== undefined) return results[n - 1] ?? problem(`There's no stretch ${n} in the list: ${plural(results.length, "stretch", "stretches")} fit.`);
  const from = arg.str(args, "from");
  const to = arg.str(args, "to");
  if (from && to) {
    const a = findPoint(ctx, from);
    if ("lines" in a) return a;
    const b = findPoint(ctx, to);
    if ("lines" in b) return b;
    if (ctx.ask.level === null) return problem("Dream needs your level first.");
    return pickedStretch(ctx.route, ctx.ask, a.i, b.i) ?? problem(`${a.name} to ${b.name} isn't a stretch: pick two different towns.`);
  }
  const shown = ctx.screen?.stretch ? results.find((r) => keyOf(r) === ctx.screen!.stretch) : undefined;
  return shown ?? results[0] ?? problem("Which stretch? Give its number in the list, or the towns it runs between.");
}

const routeOverview: Tool<DreamContext> = {
  name: "route_overview",
  description:
    "The route as a whole: its description (where it runs, terrain, landscapes, sights, best months, surface and what to know), its length, daily sections and countries, when each country is good to ride (best-time scores out of 100 by month), and the rider levels.",
  parameters: () => schema({}),
  run(ctx) {
    const secs = sectionsOf(ctx.route);
    const total = secs.reduce((a, s) => a + s.length_m, 0) / 1000;
    const countries = countryRows(secs).map((row) => {
      const known = row.best.map((b, m) => ({ m, v: b?.v ?? null })).filter((x): x is { m: number; v: number } => x.v !== null);
      const top = known.length ? Math.max(...known.map((x) => x.v)) : null;
      const best = top === null ? [] : known.filter((x) => x.v >= top - 3).map((x) => MONTHS_LONG[x.m]!);
      return { country: country(row.cc), km: whole(row.length / 1000), best, bestTime: top === null ? null : Math.round(top) };
    });
    const levels = ctx.route.dream.levels.map((l) => ({
      level: l.level,
      name: l.name,
      perDay: `${l.km_min}–${l.km_max} km a day with luggage, up to about ${l.climb_max_m.toLocaleString("en-GB")} m of climbing`,
    }));
    // The same words as the route picker's card (D89).
    const description = ctx.route.overview ? routeDescription(ctx.route.overview) : [];
    return {
      lines: [
        ...(description.length ? [`About the route: ${description.join(" ")}`] : []),
        `${ctx.route.name}: ${whole(total)} km in ${plural(secs.length, "daily section")}, through ${and(countries.map((c) => c.country))}.`,
        ...countries.map((c) => `${c.country}, ${c.km} km: ${c.best.length ? `best in ${and(c.best)} (best-time ${c.bestTime} of 100)` : "no data on when it's best"}.`),
        `Levels: ${levels.map((l) => `${l.level} ${l.name} (${l.perDay})`).join("; ")}.`,
      ],
      facts: { route: ctx.route.name, km: whole(total), sections: secs.length, countries, levels, ...(description.length ? { description } : {}) },
    };
  },
};

const findTown: Tool<DreamContext> = {
  name: "find_town",
  description: "Where a town the rider names is on the route, among the towns where stretches start and end.",
  parameters: () => schema({ name: { type: "string", description: "The town, as the rider said it." } }, ["name"]),
  run(ctx, args) {
    const name = arg.str(args, "name");
    if (!name) return problem("Which town?");
    const points = routePoints(ctx.route);
    const found = matchNames(name, points, (p) => p.name);
    if (!found.length) {
      const close = closeNames(name, points.map((p) => p.name));
      return problem(`No town called "${name}" on ${ctx.route.name} where a stretch can start or end${close.length ? `. Close names: ${and(close)}` : ""}.`, { close });
    }
    const towns = found.map((p) => ({ name: p.name, km: whole(p.m / 1000) }));
    return { lines: towns.map((t) => `${t.name} is at km ${t.km} of ${ctx.route.name}.`), facts: { ok: true, towns } };
  },
};

/** The chips in words, for what changed between two questions. */
function askChanges(ctx: DreamContext, a: Ask, b: Ask): string[] {
  const out: string[] = [];
  if (a.level !== b.level) out.push(`Level: ${levelName(ctx, b.level) ?? "not set"}`);
  if (a.days !== b.days) out.push(b.days === null ? "Days: not set" : plural(b.days, "day"));
  if (a.pace !== b.pace) out.push(PACE[b.pace]);
  if (a.month !== b.month) out.push(b.month === null ? "Any month" : MONTHS_LONG[b.month]!);
  if (JSON.stringify(a.surfaces) !== JSON.stringify(b.surfaces)) out.push(surfacesText(b));
  if (a.themes.join() !== b.themes.join()) {
    const titles = Object.fromEntries(ctx.route.dream.themes.map((t) => [t.id, t.title]));
    out.push(b.themes.length ? and(b.themes.map((t) => titles[t] ?? t)) : "Any scenery");
  }
  if (a.trainBothEnds !== b.trainBothEnds) out.push(b.trainBothEnds ? "Train at both ends" : "No need for trains");
  if (a.stay !== b.stay) out.push(STAY[b.stay]);
  if (a.avoidBusy !== b.avoidBusy) out.push(b.avoidBusy ? "Avoid busy roads" : "Busy roads are fine");
  if (a.direction !== b.direction) out.push(WAY[b.direction]);
  if (JSON.stringify(a.countries) !== JSON.stringify(b.countries)) out.push(countriesText(b));
  if (a.through !== b.through) out.push(b.through ? `Through ${b.through}` : "Passing anywhere");
  return out;
}

/** The best three stretches a question would bring, for an option to name before it is chosen, with why each fits. */
function bestFor(ctx: DreamContext, a: Ask) {
  if (a.level === null || (a.days === null && !ctx.route.own)) return [];
  return stretchesFor(ctx.route, a)
    .slice(0, SHOWN)
    .map((r) => ({ name: stretchName(dailyOf(ctx), r), facts: factsText(r, ctx.route.dream.levels, a), why: whyLines(r).slice(0, 2), when: whenText(r, a) ?? null }));
}

function fitCount(ctx: DreamContext, a: Ask): string {
  if (a.level === null || (a.days === null && !ctx.route.own)) return "Dream shows stretches once your level and days are set";
  const n = stretchesFor(ctx.route, a).length;
  return ctx.route.own ? "your route, ready to plan" : n ? `${plural(n, "stretch", "stretches")} fit` : "nothing fits";
}

const PREF = { type: "string", enum: ["prefer", "ok", "avoid"] };

const setQuestion: Tool<DreamContext, DreamApply> = {
  name: "set_question",
  description:
    "Offer the rider changes to Dream's question (the chips), as up to four options to choose from; nothing changes until they choose. Set a level only when the rider names one; otherwise offer the levels as options.",
  parameters: (ctx) =>
    schema(
      {
        options: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: schema({
            label: { type: "string" },
            level: { type: "integer", minimum: 1, maximum: 5 },
            days: { type: "integer", minimum: 1, maximum: 60, description: "Days in all, rest days included." },
            pace: { type: "string", enum: ["relaxed", "steady", "moving"] },
            month: { type: "string", enum: [...MONTHS_ENUM, "any"] },
            surfaces: schema({ road: PREF, cycle_path: PREF, gravel: PREF }),
            themes: { type: "array", items: { type: "string", enum: ctx.route.dream.themes.map((t) => t.id) } },
            train_both_ends: { type: "boolean" },
            stay: { type: "string", enum: ["any", "rooms", "camping"] },
            avoid_busy: { type: "boolean" },
            direction: { type: "string", enum: ["either", "forward", "reverse"] },
            countries: {
              ...schema(Object.fromEntries(countryRows(sectionsOf(ctx.route)).map((r) => [r.cc, { type: "string", enum: ["only", "avoid", "ok"] }]))),
              description: `The route's countries: ${countryRows(sectionsOf(ctx.route)).map((r) => `${r.cc} ${country(r.cc)}`).join(", ")}. "only": stay within those; "avoid": never enter.`,
            },
            through: { type: "string", description: "A town the stretch must pass, or 'anywhere'." },
          }),
        },
      },
      ["options"],
    ),
  run(ctx, args) {
    const given = (arg.list(args, "options") ?? []).filter((o): o is Record<string, unknown> => !!o && typeof o === "object").slice(0, 4);
    const options: ToolOption<DreamApply>[] = [];
    for (const o of given) {
      const b: Ask = { ...ctx.ask, surfaces: { ...ctx.ask.surfaces } };
      const level = arg.int(o, "level");
      if (level !== undefined && level >= 1 && level <= 5) b.level = level;
      const days = arg.int(o, "days");
      if (days !== undefined && days >= 1 && days <= 60) b.days = days;
      const pace = arg.str(o, "pace");
      if (pace === "relaxed" || pace === "steady" || pace === "moving") b.pace = pace;
      const month = arg.str(o, "month");
      if (month === "any") b.month = null;
      else if (monthIndex(month) !== null) b.month = monthIndex(month);
      const surfaces = arg.obj(o, "surfaces");
      for (const k of ["road", "cycle_path", "gravel"] as const) {
        const v = surfaces?.[k];
        if (v === "prefer" || v === "ok" || v === "avoid") b.surfaces[k] = v;
      }
      const themes = arg.list(o, "themes");
      if (themes) b.themes = themes.filter((t): t is string => typeof t === "string" && ctx.route.dream.themes.some((x) => x.id === t));
      const train = arg.bool(o, "train_both_ends");
      if (train !== undefined) b.trainBothEnds = train;
      const stay = arg.str(o, "stay");
      if (stay === "any" || stay === "rooms" || stay === "camping") b.stay = stay;
      const busy = arg.bool(o, "avoid_busy");
      if (busy !== undefined) b.avoidBusy = busy;
      const way = arg.str(o, "direction");
      if (way === "either" || way === "forward" || way === "reverse") b.direction = way;
      const countries = arg.obj(o, "countries");
      if (countries) {
        b.countries = { ...b.countries };
        for (const [cc, v] of Object.entries(countries)) {
          if (v === "only" || v === "avoid") b.countries[cc] = v;
          else if (v === "ok") delete b.countries[cc];
        }
      }
      const through = arg.str(o, "through");
      if (through) {
        if (/^any(where)?$/i.test(through)) b.through = null;
        else {
          const p = findPoint(ctx, through);
          if ("lines" in p) return p;
          b.through = p.name;
        }
      }
      const changes = askChanges(ctx, ctx.ask, b);
      if (!changes.length) continue;
      const label = arg.str(o, "label") ?? `${given.length === 1 ? "Use these: " : ""}${changes.join(" · ")}`;
      options.push({ id: `ask:${options.length + 1}`, label, changes: [...changes, fitCount(ctx, b)], apply: { ask: b } });
    }
    if (!options.length) return problem("Those answers are already Dream's question: nothing to change.");
    // What each would bring, so the rider can choose knowing (D80); nothing changes until they do.
    const best = options.map((o) => bestFor(ctx, (o.apply as { ask: Ask }).ask));
    return {
      // A label made of the changes says them already; then only what the option would bring follows it.
      lines: options.flatMap((o, i) => [
        `${o.label}: ${o.label.endsWith(o.changes.slice(0, -1).join(" · ")) ? o.changes.at(-1) : o.changes.join("; ")}.`,
        ...best[i]!.map((s, k) => `  ${k + 1}. ${s.name} (${s.facts})${s.why.length ? `. Why it fits: ${s.why.join("; ")}` : ""}${s.when ? `. ${s.when}` : ""}.`),
      ]),
      facts: { ok: true, options: options.map((o, i) => ({ label: o.label, changes: o.changes, best: best[i] })) },
      options,
    };
  },
};

const stretches: Tool<DreamContext> = {
  name: "stretches",
  description: "The stretches that fit the rider's question, best first, each with why it fits, what to look out for and what to check; or why nothing fits. Use 'from' for more of the list.",
  parameters: () => schema({ from: { type: "integer", minimum: 1, description: "Start the list at this number, for more." } }),
  run(ctx, args) {
    const a = ctx.ask;
    if (a.level === null || (a.days === null && !ctx.route.own)) {
      const needs = [a.level === null ? "your level" : null, a.days === null && !ctx.route.own ? "how many days you have" : null].filter((x): x is string => !!x);
      return problem(`Dream shows stretches once it knows ${and(needs)}: nothing is assumed.`, { needs });
    }
    const results = stretchesFor(ctx.route, a);
    if (!results.length) {
      return problem(
        "Nothing fits: every stretch is more than your level can do in these days, or misses something you asked for (trains at both ends, avoiding busy roads). More days, a higher level or fewer needs would help, or pick your own stretch.",
        { fit: 0 },
      );
    }
    const from = Math.max(1, arg.int(args, "from") ?? 1);
    const shown = results.slice(from - 1, from - 1 + (from === 1 ? SHOWN : MORE));
    const list = shown.map((r, i) => stretchFacts(ctx, r, from + i));
    const head = ctx.route.own ? "Your route:" : `${plural(results.length, "stretch", "stretches")} fit${from === 1 && results.length > SHOWN ? `; the best ${SHOWN}` : ""}:`;
    // A rider's own route: where its days come from, the file's nights beside a usual day at the level (D80), and
    // which nights have a place to stay of the rider's kind (D86).
    const note = ctx.route.own && a.days === null && results[0] ? [daysNote(ctx.route, a, results[0])] : [];
    const nights = results[0] ? nightsNote(ctx.route, a, results[0]) : null;
    return {
      lines: [head, ...list.flatMap(stretchLines), ...note, ...(nights ? [nights] : [])],
      facts: { ok: true, fit: results.length, stretches: list, ...(note.length ? { days: note[0] } : {}), ...(nights ? { nights } : {}) },
    };
  },
};

const describeStretchTool: Tool<DreamContext> = {
  name: "describe_stretch",
  description: "Any stretch the rider names from one town to another, ridden in that order, described like the list's stretches but never ruled out.",
  parameters: () => schema({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
  run(ctx, args) {
    if (!arg.str(args, "from") || !arg.str(args, "to")) return problem("From which town to which?");
    const r = stretchOf(ctx, { from: args.from, to: args.to });
    if ("lines" in r) return r;
    const f = stretchFacts(ctx, r);
    return { lines: stretchLines(f), facts: { ok: true, stretch: f } };
  },
};

const compare: Tool<DreamContext> = {
  name: "compare",
  description: "Two stretches from the list side by side, by their numbers: days, climbing, grade, when, surfaces, busy roads, scenery, trains, what to look out for and check.",
  parameters: () => schema({ a: { type: "integer", minimum: 1 }, b: { type: "integer", minimum: 1 } }, ["a", "b"]),
  run(ctx, args) {
    const ra = stretchOf(ctx, { number: args.a });
    if ("lines" in ra) return ra;
    const rb = stretchOf(ctx, { number: args.b });
    if ("lines" in rb) return rb;
    const titles = Object.fromEntries(ctx.route.dream.themes.map((t) => [t.id, t.title]));
    const rows = compareRows(ctx.ask, ctx.route.dream.levels, titles).map((row) => ({ label: row.label, a: row.f(ra), b: row.f(rb) }));
    const [na, nb] = [stretchName(dailyOf(ctx), ra), stretchName(dailyOf(ctx), rb)];
    return {
      lines: [`${args.a}. ${na} against ${args.b}. ${nb}:`, ...rows.map((r) => `${r.label}: ${r.a} | ${r.b}`)],
      facts: { ok: true, a: na, b: nb, rows },
    };
  },
};

/**
 * The usual weather on some sections in a month; without one, their best months by best-time and the weather in the
 * first of them (D80). Shared with Plan's tool, so both phases say it alike.
 */
export function weatherIn(secs: DreamSection[], where: string, month: number | null): ToolResult<never> {
  const best = month === null ? bestMonths(secs) : null;
  const m = month ?? best?.months[0] ?? null;
  if (m === null) return problem(`We have no climate data for ${where}.`);
  const weather = usualWeather(secs, m);
  if (!weather) return problem(`We have no climate data for ${where}.`);
  const lines = [
    ...(best ? [`Best on ${where}: ${and(best.months.map((x) => MONTHS_LONG[x]!))} (best-time ${best.score} of 100: comfort, crowds and what's open).`] : []),
    `In ${MONTHS_LONG[m]} on ${where}: ${weather} (the usual weather, not a forecast).`,
  ];
  return { lines, facts: { ok: true, where, month: MONTHS_LONG[m], weather, ...(best ? { bestMonths: best.months.map((x) => MONTHS_LONG[x]), bestTime: best.score } : {}) } };
}

const usualWeatherTool: Tool<DreamContext> = {
  name: "usual_weather",
  description:
    "The usual weather (averages over past years, never a forecast) on a stretch in a month: night lows to day highs and how often it rains; without a month, the best months by Dream's best-time score. A stretch by its number in the list, or by two towns; without one, the whole route. There is no smoke or wildfire data.",
  parameters: () =>
    schema({
      number: { type: "integer", minimum: 1 },
      from: { type: "string" },
      to: { type: "string" },
      month: { type: "string", enum: MONTHS_ENUM },
      best: { type: "boolean", description: "The best months." },
    }),
  run(ctx, args) {
    // A stretch by number or towns, else the one on screen ("this route", D77), else the whole route.
    const named = arg.int(args, "number") !== undefined || (arg.str(args, "from") && arg.str(args, "to")) || !!ctx.screen?.stretch;
    const r = named ? stretchOf(ctx, args) : null;
    if (r && "lines" in r) return r;
    const secs = r ? ctx.route.dream.sections.filter((s) => s.number >= r.first && s.number <= r.last) : sectionsOf(ctx.route);
    const where = r ? stretchName(dailyOf(ctx), r) : ctx.route.name;
    return weatherIn(secs, where, arg.bool(args, "best") ? null : (monthIndex(arg.str(args, "month")) ?? ctx.ask.month));
  },
};

const planThis: Tool<DreamContext, DreamApply> = {
  name: "plan_this",
  description: "Offer to open Plan with a stretch, by its number in the list or two towns; Plan opens only when the rider chooses it.",
  parameters: () => schema({ number: { type: "integer", minimum: 1 }, from: { type: "string" }, to: { type: "string" } }),
  run(ctx, args) {
    if (ctx.ask.level === null) return problem("Plan needs your level first: set it in Dream's question.");
    const r = stretchOf(ctx, args);
    if ("lines" in r) return r;
    const f = stretchFacts(ctx, r);
    const option: ToolOption<DreamApply> = { id: `plan:${keyOf(r)}`, label: `Plan ${f.name}`, changes: [f.facts], apply: { plan: planLink(ctx.route, r, ctx.ask) } };
    return { lines: [`${option.label}: ${f.facts}.`], facts: { ok: true, stretch: f.name }, options: [option] };
  },
};

export const DREAM_TOOLS = [routeOverview, findTown, setQuestion, stretches, describeStretchTool, compare, usualWeatherTool, planThis] as Tool<DreamContext, DreamApply>[];
