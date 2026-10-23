/**
 * The trip brief (11.6): one screen saying what the rider is taking on, in five fixed lines, one per question:
 * Can I do it? Where will I sleep? What should I look out for? What do I sort out before I go? What will it be like?
 * Each shows the most important item for its question, plus how many more there are.
 */
import type { PlanCore } from "./plan";
import { monthOf } from "./sun";
import { foodOnDay, isNightLine, toDo } from "./items";
import { dayList, hours, KNOWN_ENOUGH, km, MONTHS_LONG, numberList, plural, range, shareOf, sleepNoun } from "./text";
import type { Brief, BriefLine, DayPlan, PlanData, PlanItem } from "./types";
import { usualWeather } from "./weather";

const THEME_PHRASE: Record<string, string> = {
  coast: "along the coast",
  mountains: "in the mountains",
  water: "by lakes and rivers",
  forest: "through forest and nature",
  wine: "among vineyards",
  heritage: "past villages and heritage",
  viewpoints: "with views",
  culture: "through towns",
};

/**
 * One line of character for a day, from templates over the data (11.6): every phrase traces to a number we hold.
 * D38's assistant may later rephrase it, under the same rule.
 */
export function dayStory(data: PlanData, d: DayPlan, items: PlanItem[]): string {
  if (d.kind === "rest") return `A rest day at ${d.endName}.`;
  const s = d.surfaces;
  const surface =
    s.c >= 0.6 ? "Mostly cycle paths" : s.r >= 0.6 ? "Mostly roads" : s.g >= 0.3 ? "A good share of gravel" : "Roads and cycle paths";
  const perKm = d.km > 0 ? d.climbM / d.km : 0;
  const terrain = perKm < 5 ? "flat" : perKm < 12 ? "rolling" : perKm < 20 ? "hilly" : "mountainous";
  let theme = "";
  let best = 0.6;
  for (const n of d.sections) {
    const sec = data.dream.sections.find((x) => x.number === n);
    for (const [id, t] of Object.entries(sec?.themes ?? {})) {
      if (t.score !== null && t.score >= best && THEME_PHRASE[id]) {
        best = t.score;
        theme = THEME_PHRASE[id]!;
      }
    }
  }
  const extras: string[] = [];
  const busy = items
    .filter((i) => i.day === d.number && i.id.startsWith("finding:") && i.title.includes("busy roads"))
    .reduce((a, i) => a + Math.abs((i.toM ?? 0) - (i.fromM ?? 0)) / 1000, 0);
  if (busy >= 2) extras.push(`${Math.round(busy)} km on busy roads`);
  // Ferries are counted, not listed: the Dutch delta has four in a day.
  const ferries = d.gaps.filter((g) => g.type === "ferry").length;
  if (ferries) extras.push(ferries === 1 ? "a ferry crossing" : `${ferries} ferry crossings`);
  for (const g of d.gaps) {
    if ((g.type === "missing" || g.type === "unclassified") && g.km >= 1) extras.push(`a ${km(g.km)} km gap in the route`);
  }
  if (d.unknownKm >= 1 && !d.gaps.length) extras.push(`terrain unknown for ${km(d.unknownKm)} km`);
  return `${surface}, ${terrain}${theme ? `, ${theme}` : ""}${extras.length ? `; ${extras.join(", ")}` : ""}.`;
}

function weather(data: PlanData, core: PlanCore): string {
  const month = monthOf(core.inputs.startDate);
  const secs = new Set(core.days.flatMap((d) => d.sections));
  const winds = core.days.filter((d) => d.tailwindMs !== null).map((d) => d.tailwindMs!);
  const wind = winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null;
  const text = usualWeather(data.dream.sections.filter((s) => secs.has(s.number)), month, wind);
  return text ? `In ${MONTHS_LONG[month]}: ${text}.` : "Typical weather: no data for these days.";
}

function themes(data: PlanData, core: PlanCore): string[] {
  const secs = new Set(core.days.flatMap((d) => d.sections));
  const titles = Object.fromEntries(data.dream.themes.map((t) => [t.id, t.title]));
  const scores = new Map<string, number[]>();
  for (const s of data.dream.sections) {
    if (!secs.has(s.number)) continue;
    for (const [id, t] of Object.entries(s.themes)) if (t.score !== null) scores.set(id, [...(scores.get(id) ?? []), t.score]);
  }
  return [...scores.entries()]
    .map(([id, v]) => ({ id, s: v.reduce((a, b) => a + b, 0) / v.length }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => titles[x.id] ?? x.id);
}

export function makeBrief(data: PlanData, core: PlanCore, items: PlanItem[]): Brief {
  const { inputs, level, days, nights, usual } = core;
  const rides = days.filter((d) => d.kind === "ride");
  const total = rides.reduce((a, d) => a + d.km, 0);
  const climb = rides.reduce((a, d) => a + d.climbM, 0);
  const hardest = [...rides].sort((a, b) => b.hoursSlow - a.hoursSlow)[0]!;
  const beyond = rides.filter((d) => d.effort === "beyond");
  const harder = rides.filter((d) => d.effort === "harder");
  const byTopic = (t: PlanItem["topic"]) => items.filter((i) => i.topic === t);
  const lines: BriefLine[] = [];

  const ableCalls = byTopic("able").filter((i) => i.kind === "call" || i.kind === "headsup");
  lines.push({
    topic: "able",
    question: "Can I do it?",
    answer:
      (beyond.length
        ? `Mostly, at ${level.name}: ${beyond.length === 1 ? `day ${beyond[0]!.number} is` : `${beyond.length} days are`} beyond your level.`
        : `Yes, at ${level.name}${harder.length ? `, with ${plural(harder.length, "harder day")}` : ""}.`) +
      ` Day ${hardest.number} is the hardest: ${km(hardest.km)} km, about ${hours(hardest.hoursSlow)} riding.` +
      (core.restAfter.length ? ` ${plural(core.restAfter.length, "rest day")}, after riding ${core.restAfter.length === 1 ? "day" : "days"} ${numberList(core.restAfter)}.` : ""),
    more: ableCalls.length,
    moreIds: ableCalls.map((i) => i.id),
  });

  const month = MONTHS_LONG[monthOf(inputs.startDate)]!;
  const noBed = nights.filter((n) => n.beds.count === 0).length;
  const unknown = nights.filter((n) => n.beds.count > 0 && n.beds.open + n.beds.partly + n.beds.unmanaged === 0).length;
  // What's still to sort out, as the to-do shows it (D64).
  const open = toDo(items, core.choices).open;
  const sleepItems = open.filter(isNightLine);
  lines.push({
    topic: "sleep",
    question: "Where will I sleep?",
    answer: !nights.length
      ? "No night to plan: a one-day ride."
      : (noBed ? `No known ${sleepNoun(inputs.sleep)} on ${plural(noBed, "night")}.` : "A stop every night.") +
        (unknown ? ` ${unknown} of ${nights.length} rely on places with no ${month} dates.` : ""),
    more: sleepItems.length,
    moreIds: sleepItems.map((i) => i.id),
  });

  // Heads-ups and calls only: things to be aware of that need no action are in the note (D75).
  const risks = byTopic("risk").filter((i) => i.kind === "headsup" || i.kind === "call");
  const audit = data.full
    ? 0
    : [...new Set(rides.flatMap((d) => d.sections))].reduce(
        (a, n) => {
          // What a rider would be told about (D75); an older audit has only its own warnings.
          const f = data.dream.sections.find((s) => s.number === n)?.findings;
          return a + (f?.rider ?? f?.warning ?? 0);
        },
        0,
      );
  lines.push({
    topic: "risk",
    question: "What should I look out for?",
    // The teaser gives counts in place of detail (D45).
    answer: !data.full
      ? risks.length
        ? `${plural(risks.length + audit, "thing")} to look out for on these days: the details come with a Trip Pass.`
        : audit
          ? `${plural(audit, "thing")} to look out for on these days: the details come with a Trip Pass.`
          : "Nothing stands out in the outline."
      : risks[0]
      ? `${risks[0].day ? `Day ${risks[0].day}: ` : ""}${risks[0].title}${risks[0].kind === "call" ? ": your call" : ""}.` +
        ""
      : "Nothing stands out in our data for these days.",
    more: Math.max(0, risks.length - 1),
    moreIds: risks.slice(1).map((i) => i.id),
  });

  const calls = open.filter((i) => i.kind === "call").length;
  const travelItems = open.filter((i) => i.id.startsWith("travel:"));
  const trains = travelItems.filter((i) => !i.title.includes("no bike")).length;
  const checks = open.length - calls - sleepItems.length - travelItems.length;
  lines.push({
    topic: "prepare",
    question: "What do I sort out before I go?",
    answer: open.length
      ? [
          calls ? plural(calls, "call") : null,
          sleepItems.length ? `accommodation for ${plural(sleepItems.length, "night")}` : null,
          checks ? plural(checks, "check") : null,
          trains === 2 ? "trains both ends" : trains === 1 ? "a train at one end" : null,
          travelItems.length > trains ? "how to get there and back" : null,
        ]
          .filter(Boolean)
          .join(", ")
          .replace(/^./, (c) => c.toUpperCase()) + "."
      : "Nothing: everything is taken care of.",
    more: open.length,
    moreIds: open.map((i) => i.id),
  });

  const highlights = items.filter((i) => i.kind === "highlight" && i.id.startsWith("highlight:")).slice(0, 3);
  const moreLike = rides.flatMap((d) => items.filter((i) => i.kind === "highlight" && i.day === d.number).slice(0, 3)).filter((i) => !highlights.includes(i));
  const like = highlights.length ? highlights.map((h) => h.title).join(", ") : themes(data, core).join(", ");
  lines.push({
    topic: "like",
    question: "What will it be like?",
    answer: `${weather(data, core)}${like ? ` ${like}.` : ""}`,
    // Highlights shown on the day cards (3 a day), beyond the three named here.
    more: moreLike.length,
    moreIds: moreLike.map((i) => i.id),
  });

  const readiness = calls
    ? `${plural(calls, "thing")} ${calls === 1 ? "needs" : "need"} your call`
    : !open.length
      ? "Ready to go: everything is taken care of"
      : `Ready to go${noBed ? "" : ": a bed every night"}${beyond.length ? "" : `${noBed ? ": " : ", "}every day within your level`}, ${plural(open.length, "thing")} to sort out before you leave`;

  // Things to be aware of on the trip (D75; was "how well we know these days"): in words, never a percentage (D57).
  const confidence: string[] = [];
  const unknownDays = rides.filter((d) => d.surfaces.u * d.km >= 1);
  const unknownSurface = unknownDays.reduce((a, d) => a + d.surfaces.u * d.km, 0);
  confidence.push(
    unknownDays.length
      ? `The surface is unknown for ${km(unknownSurface)} km, on ${dayList(unknownDays.map((d) => d.number))}`
      : "We know the surface all the way",
  );
  const beds = nights.reduce(
    (a, n) => ({ all: a.all + n.beds.count + n.beds.closed, known: a.known + n.beds.count + n.beds.closed - n.beds.unknown, open: a.open + n.beds.open + n.beds.partly + n.beds.unmanaged }),
    { all: 0, known: 0, open: 0 },
  );
  if (beds.all) {
    confidence.push(
      beds.known / beds.all >= KNOWN_ENOUGH
        ? `${shareOf(beds.open / beds.known, "places to stay at your stops")} are open on your dates`
        : "We're not sure which places to stay will be open on your dates: check before you book",
    );
  }
  // Food only when every riding day's places loaded: not loaded isn't none (D37).
  const food = rides.map((d) => foodOnDay(data, d));
  if (food.length && food.every((f) => f !== null)) {
    const sum = food.reduce((a, f) => ({ all: a.all + f!.all, known: a.known + f!.known, open: a.open + f!.open }), { all: 0, known: 0, open: 0 });
    if (sum.all) {
      confidence.push(
        sum.known / sum.all >= KNOWN_ENOUGH
          ? `${shareOf(sum.open / sum.known, "food places along the way")} are open on your days`
          : "We're not sure when food places are open: check ahead",
      );
    }
  }

  // Things to be aware of that need no action (D75): route gaps, unknown terrain, missing holiday data.
  // Unknown terrain is said once for the trip, the rest one line each.
  const terrain = rides.filter((d) => d.unknownKm >= 1);
  if (terrain.length) {
    const unknownKm = terrain.reduce((a, d) => a + d.unknownKm, 0);
    confidence.push(`The terrain is unknown for ${km(unknownKm)} km, on ${dayList(terrain.map((d) => d.number))}: climbing and time there are minimums`);
  }
  for (const n of items.filter((i) => i.kind === "note" && !i.id.startsWith("terrain:"))) confidence.push(n.day ? `Day ${n.day}: ${n.title}` : n.title);

  const start = rides[0]!;
  const end = rides[rides.length - 1]!;
  return {
    title: `${start.startName} → ${end.endName}`,
    dates: range(days[0]!.date, days[days.length - 1]!.date),
    km: total,
    climbM: climb,
    direction: inputs.direction,
    // Every day, rest days too (no riding), so the chart reads as the trip is lived (D74).
    effort: days.map((d) => ({ day: d.number, hours: d.kind === "rest" ? 0 : d.hoursSlow, usual: usual.hours, effort: d.effort, rest: d.kind === "rest" })),
    lines,
    readiness,
    confidence,
  };
}
