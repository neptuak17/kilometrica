import { EMPTY } from "@dpg/dream";
import { restInAction } from "@dpg/planner";
import { describe, expect, it } from "vitest";
import { DREAM_TOOLS, type DreamContext } from "./dream";
import { PLAN_TOOLS, type PlanContext } from "./plan";
import { testPlan, testRoute } from "./testdata";

const dream = (name: string) => DREAM_TOOLS.find((t) => t.name === name)!;
const plan = (name: string) => PLAN_TOOLS.find((t) => t.name === name)!;
const ask = (over: Partial<DreamContext["ask"]> = {}): DreamContext => ({ route: testRoute(), ask: { ...EMPTY, ...over } });

describe("the tools (A2, D77)", () => {
  it("each has a name, a description and an object schema the model's call is held to", () => {
    const names = [...DREAM_TOOLS, ...PLAN_TOOLS].map((t) => t.name);
    expect(new Set(names).size).toBe(15);
    for (const t of DREAM_TOOLS) expect(t.parameters(ask())).toMatchObject({ type: "object", additionalProperties: false });
    for (const t of PLAN_TOOLS) expect(t.parameters(testPlan())).toMatchObject({ type: "object", additionalProperties: false });
  });
});

describe("Dream's tools", () => {
  it("give the route as a whole, its countries' best months and the levels", () => {
    const r = dream("route_overview").run(ask(), {});
    expect(r.lines[0]).toBe("Test route: 300 km in 6 daily sections, through France.");
    expect(r.lines[1]).toBe("France, 300 km: best in October (best-time 80 of 100).");
    expect(r.lines[2]).toContain("3 Moderate (50–80 km a day with luggage, up to about 850 m of climbing)");
  });

  it("find a town by the rider's name for it, or say which names are close", () => {
    expect(dream("find_town").run(ask(), { name: "charlie" }).lines).toEqual(["Charlie is at km 100 of Test route."]);
    const miss = dream("find_town").run(ask(), { name: "Charly" });
    expect(miss.facts).toMatchObject({ ok: false, close: ["Charlie"] });
  });

  it("show stretches only once the level and days are known, nothing assumed", () => {
    expect(dream("stretches").run(ask(), {}).lines[0]).toBe("Dream shows stretches once it knows your level and how many days you have: nothing is assumed.");
    const r = dream("stretches").run(ask({ level: 3, days: 3 }), {});
    expect(r.lines[0]).toMatch(/^\d+ stretches fit/);
    expect(r.lines[1]).toMatch(/^1\. \w+ → \w+: 3 days · \d+ km · \d+ km a day/);
  });

  it("offer the question's changes as options, changing nothing until one is chosen", () => {
    const ctx = ask();
    const r = dream("set_question").run(ctx, { options: [{ level: 3, days: 4, month: "October" }] });
    expect(r.options).toHaveLength(1);
    expect(r.options![0]!.label).toBe("Use these: Level: Moderate · 4 days · October");
    expect(r.options![0]!.changes.at(-1)).toMatch(/^\d+ stretches fit$/);
    expect(r.options![0]!.apply).toMatchObject({ ask: { level: 3, days: 4, month: 9 } });
    expect(ctx.ask.level).toBeNull();
    // Levels offered side by side, each its own option.
    expect(dream("set_question").run(ctx, { options: [{ level: 2 }, { level: 3 }] }).options!.map((o) => o.label)).toEqual(["Level: Easy-moderate", "Level: Moderate"]);
    expect(dream("set_question").run(ctx, { options: [{ stay: "any" }] }).facts.ok).toBe(false);
  });

  it("describe a stretch between two towns, compare two, give the usual weather and offer to plan one", () => {
    const ctx = ask({ level: 3, days: 3 });
    expect(dream("describe_stretch").run(ctx, { from: "Alpha", to: "delta" }).lines[0]).toMatch(/^Alpha → Delta: /);
    const cmp = dream("compare").run(ctx, { a: 1, b: 2 });
    expect((cmp.facts.rows as unknown[]).length).toBe(10);
    expect(dream("usual_weather").run(ctx, { month: "October" }).lines).toEqual([
      "In October on Test route: typically 12–21 °C, rain 1 day in 5 (the usual weather, not a forecast).",
    ]);
    const p = dream("plan_this").run(ctx, { number: 1 });
    expect(p.options![0]!.apply).toMatchObject({ plan: expect.stringMatching(/^\/plan\?route=test%2Ft1&first=\d+&last=\d+/) });
  });
});

describe("Plan's tools", () => {
  it("give the trip brief and the days as the screen says them, with totals for a run", () => {
    const ctx = testPlan();
    const trip = plan("the_trip").run(ctx, {});
    expect(trip.lines[0]).toMatch(/^Alpha → Golf: 5 days, Wed 13 – Sun 17 Oct 2027, 300 km, /);
    const day = plan("days").run(ctx, { day: 1 });
    expect(day.lines[0]).toMatch(/^Day 1, Wed 13 Oct: Alpha → (Town \d+|Saint-Jean)\. \d+ km, /);
    expect(day.lines).toContain("Typically 12–21 °C, rain 1 day in 5, little wind along the way.");
    expect(plan("days").run(ctx, { day: 1, to: 3 }).lines.at(-1)).toMatch(/^Days 1–3 together: \d+ km, \d+ m of climbing, about .+ riding\.$/);
    // "This day": the one on screen.
    expect(plan("days").run({ ...ctx, screen: { day: 2 } }, {}).lines[0]).toMatch(/^Day 2, /);
  });

  it("say where to sleep on a night, and in the teaser that the places come with a Trip Pass", () => {
    const n = plan("night").run(testPlan(), { after_day: 1 });
    expect(n.lines[0]).toMatch(/^The night after day 1 \(13–14 October\): Town \d+: 2 hotels nearby, check ahead if they're open\.$/);
    expect(n.lines.some((l) => l.startsWith("Here: "))).toBe(true);
    expect(plan("night").run(testPlan({}, false), { after_day: 1 }).lines).toContain("The places to stay and their links comes with a Trip Pass.");
  });

  it("find a stop by name, accents and Saint/St aside", () => {
    const r = plan("find_stop").run(testPlan(), { name: "St Jean" });
    expect(r.lines[0]).toMatch(/^Saint-Jean: km 120 of the trip, on day \d at km \d+/);
    expect(plan("find_stop").run(testPlan(), { name: "Nowhere" }).facts.ok).toBe(false);
  });

  it("offer changes as options built with the screen's own actions, applying none of them", () => {
    const ctx: PlanContext = testPlan();
    const more = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "set", total_days: 6 }] }] });
    expect(more.options![0]!.changes[0]).toBe("One riding day more (6)");
    expect(more.options![0]!.apply.state.inputs.days).toBe(6);
    expect(ctx.state.inputs.days).toBe(5);
    // "Rest in Saint-Jean": the same action as the screen's "Rest in…".
    const rest = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "rest_in", town: "saint-jean" }] }] });
    const stop = ctx.data.stops.stops.find((s) => s.name === "Saint-Jean")!;
    expect(rest.options![0]!.apply.actions).toEqual([restInAction(ctx.planFor(ctx.state), stop)]);
    const after = ctx.planFor(rest.options![0]!.apply.state);
    expect(after.days.find((d) => d.kind === "rest")?.endName).toBe("Saint-Jean");
    // A rest day's tool then has it.
    expect(plan("rest_day").run({ ...ctx, state: rest.options![0]!.apply.state }, { town: "Saint-Jean" }).lines[0]).toMatch(/^Day \d, .+: rest day at Saint-Jean\./);
    // What can't be built is said, and no option is made of it.
    const bad = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "rest_in", town: "Atlantis" }] }] });
    expect(bad.facts).toMatchObject({ ok: false });
    expect(bad.lines[0]).toBe('"Atlantis" isn\'t a town on this stretch.');
  });

  it("choose a place for a night by its name, and say a wild camp needs a tent", () => {
    const ctx = testPlan({ sleep: "camping" });
    const night = ctx.planFor(ctx.state).nights[0]!;
    const km = night.stop.at_m / 1000;
    const r = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "stay_at", after_day: 1, place: `camping ${km}` }] }] });
    expect(r.options![0]!.apply.actions).toEqual([{ type: "bed", night: 0, place: `c${km}` }]);
    const rooms = testPlan();
    expect(plan("offer_options").run(rooms, { options: [{ changes: [{ do: "stay_at", after_day: 1, place: "wild camp" }] }] }).lines[0]).toBe(
      "A wild camp needs a tent: you sleep in rooms.",
    );
  });
});

describe("what the owner's questions asked of the tools (D80)", () => {
  it("names the best stretches each option of Dream's question would bring, and keeps to a town to pass through", () => {
    const r = dream("set_question").run(ask({ level: 3, days: 3 }), { options: [{ through: "charlie" }] });
    expect(r.options![0]!.label).toBe("Use these: Through Charlie");
    const best = (r.facts.options as { best: { name: string }[] }[])[0]!.best;
    expect(best.length).toBeGreaterThan(0);
    // Every stretch it brings passes Charlie, at km 100.
    for (const s of best) expect(s.name).toMatch(/^(Alpha|Bravo|Charlie) → (Charlie|Delta|Echo|Foxtrot|Golf)$/);
    expect(dream("set_question").run(ask(), { options: [{ through: "Atlantis" }] }).facts.ok).toBe(false);
  });

  it("gives the best months when no month is asked, in Dream and in Plan", () => {
    expect(dream("usual_weather").run(ask(), {}).lines[0]).toBe("Best on Test route: October (best-time 80 of 100: comfort, crowds and what's open).");
    expect(plan("usual_weather").run(testPlan(), { best: true }).lines[0]).toBe("Best on Alpha → Golf: October (best-time 80 of 100: comfort, crowds and what's open).");
    expect(plan("usual_weather").run(testPlan(), { month: "May" }).lines).toEqual(["In May on Alpha → Golf: typically 12–21 °C, rain 1 day in 5 (the usual weather, not a forecast)."]);
  });

  it("gives a night's other stops, and the water and food between two towns", () => {
    const n = plan("night").run(testPlan(), { after_day: 1 });
    expect(n.lines.find((l) => l.startsWith("Other stops for this night: "))).toMatch(/Town \d+: this day \d+ km, next day \d+ km \(/);
    expect(plan("days").run(testPlan(), { from_town: "Town 10", to_town: "Town 50" }).lines).toEqual([
      "Water and food from Town 10 to Town 50 (40 km): at km 15 · 25 from Town 10; longest stretch without 15 km.",
    ]);
    expect(plan("days").run(testPlan(), { from_town: "Town 60", to_town: "Town 90" }).lines).toEqual(["No water or food we know of from Town 60 to Town 90 (30 km): you judge what to carry."]);
  });

  it("offers a longer stay, being in by a time, and a night at a town without naming its day", () => {
    const ctx = testPlan({ days: 7, toM: 300_000 });
    const stay = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "rest_in", town: "Saint-Jean", days: 2 }] }] });
    const after = ctx.planFor(stay.options![0]!.apply.state);
    expect(after.days.filter((d) => d.kind === "rest").map((d) => d.endName)).toEqual(["Saint-Jean", "Saint-Jean"]);
    const longer = plan("offer_options").run({ ...ctx, state: stay.options![0]!.apply.state }, { options: [{ changes: [{ do: "rest_length", town: "Saint-Jean", days: 3 }] }] });
    expect(longer.options![0]!.changes).toContain("3 rest days in a row at Saint-Jean (was 2)");
    const early = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "be_in_by", time: "13:00" }] }] });
    expect(early.options![0]!.changes[0]).toMatch(/^Leave at \d\d:\d\d \(was 09:00\)$/);
    expect(early.options![0]!.changes.at(-1)).toMatch(/^(Every day in by 13:00|Days? .+ still ends? after 13:00)$/);
    const night = plan("offer_options").run(ctx, { options: [{ changes: [{ do: "stop_at", town: "Saint-Jean" }] }] });
    expect(ctx.planFor(night.options![0]!.apply.state).nights.some((n) => n.stop.name === "Saint-Jean")).toBe(true);
  });
});
