import { EMPTY } from "@dpg/dream";
import { describe, expect, it } from "vitest";
import { DREAM_TOOLS, type DreamContext } from "./dream";
import type { Model } from "./model/model";
import { PLAN_TOOLS, type PlanContext } from "./plan";
import { testPlan, testRoute } from "./testdata";
import { act, clockOf, kindsOf, type Request, requestSchema, startUnderstanding, tidy, understandTurn } from "./understand";

const ask = (over: Partial<DreamContext["ask"]> = {}): DreamContext => ({ route: testRoute(), ask: { ...EMPTY, ...over } });

/** Our code acting on a request, with every call recorded. */
function acted(phase: "dream" | "plan", ctx: DreamContext | PlanContext, r: Request) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const tools = (phase === "dream" ? DREAM_TOOLS : PLAN_TOOLS) as { name: string; run: (c: unknown, a: Record<string, unknown>) => ReturnType<(typeof PLAN_TOOLS)[number]["run"]> }[];
  const done = act(phase, ctx, r, {}, (tool, args) => {
    calls.push({ tool, args });
    return tools.find((t) => t.name === tool)!.run(ctx, args);
  });
  return { calls, ...done };
}

describe("the request's schema (D99)", () => {
  it("has one shape per kind, each with only its own details", () => {
    const s = requestSchema(kindsOf("plan", testPlan())) as { anyOf: { properties: Record<string, unknown>; additionalProperties: boolean }[] };
    const night = s.anyOf.find((k) => (k.properties.kind as { const: string }).const === "night")!;
    expect(Object.keys(night.properties)).toEqual(["kind", "day", "town"]);
    expect(night.additionalProperties).toBe(false);
    // Dream's scenery and countries are the route's own.
    const q = (requestSchema(kindsOf("dream", ask())) as typeof s).anyOf.find((k) => (k.properties.kind as { const: string }).const === "question")!;
    expect(q.properties.only_country).toMatchObject({ enum: ["France"] });
  });

  it("reads a time the way riders write it", () => {
    expect(["4pm", "4 pm", "16:00", "16", "12am", "1:30pm", "25"].map(clockOf)).toEqual(["16:00", "16:00", "16:00", "16:00", "00:00", "13:30", undefined]);
  });
});

describe("our code acting on a request (D99)", () => {
  it("makes both options for a rest in a town: the same end date, and a day longer", () => {
    const r = acted("plan", testPlan({ days: 5 }), { kind: "rest_in", town: "saint-jean" });
    expect(r.calls.map((k) => k.args)).toEqual([{ changes: [{ do: "rest_in", town: "Saint-Jean" }] }, { changes: [{ do: "rest_in", town: "Saint-Jean", longer: true }] }]);
    expect(r.results.every((x) => x.options?.length === 1)).toBe(true);
  });

  it("says a decline in our own words, and gives a booking its night's searches", () => {
    const r = acted("plan", testPlan(), { kind: "decline", reason: "booking", day: 1 });
    expect(r.said).toEqual(["I can't book anything for you, but I can show you the places to stay and the booking searches for each night."]);
    expect(r.calls).toEqual([{ tool: "night", args: { after_day: 1 } }]);
    expect(acted("plan", testPlan(), { kind: "decline", reason: "medical" }).calls).toEqual([]);
  });

  it("offers Dream's levels from how the rider rides: easier than now is the two below", () => {
    const r = acted("dream", ask({ level: 3, days: 3 }), { kind: "question", riding: "easier" });
    expect(r.calls.map((k) => k.args)).toEqual([{ level: 2 }, { level: 1 }]);
    expect(acted("dream", ask(), { kind: "question", level: "Tough", only_country: "France" }).calls[0]!.args).toEqual({ level: 5, countries: { FR: "only" } });
  });
});

describe("a request as our code reads it (D100)", () => {
  it("drops what's empty, a flag that's off, and what Dream is already asking", () => {
    const ctx = ask({ level: 3, days: 7 });
    expect(tidy("dream", ctx, { kind: "question", level: "Moderate", days: 10, themes: [], smoke: false, through: " " }, {})).toEqual({ kind: "question", days: 10 });
    // Nothing new: our sentence, and no option that changes nothing.
    const r = acted("dream", ctx, tidy("dream", ctx, { kind: "question", level: "Moderate", days: 7 }, {}));
    expect(r.calls).toEqual([]);
    expect(r.said[0]).toMatch(/^I can't see a change/);
  });

  it("names the plan's towns as it does, and keeps a decline's town only where it's used", () => {
    const ctx = testPlan();
    expect(tidy("plan", ctx, { kind: "decline", reason: "safety", day: 2, town: "saint-jean" }, {})).toEqual({ kind: "decline", reason: "safety" });
    expect(tidy("plan", ctx, { kind: "find", town: "saint-jean" }, {})).toEqual({ kind: "find", town: "Saint-Jean" });
    expect(tidy("plan", ctx, { kind: "more_days", count: 1 }, {})).toEqual({ kind: "more_days" });
  });
});

describe("a turn in the new shape (D99)", () => {
  it("answers with the tools' lines when the model's request can't be read", async () => {
    const model: Model = {
      name: "scripted",
      next: async () => ({ calls: [], text: "", unreadable: [], stats: { ms: 1, firstTextMs: 0 } }),
      json: async () => ({ value: null, text: "{", stats: { ms: 1, firstTextMs: null } }),
    };
    const ctx = testPlan();
    const chat = startUnderstanding("plan", ctx, { understand: "U" });
    const out = await understandTurn(model, chat, { rider: "Hmm?", screen: "On screen: Plan.", ctx, call: () => ({ lines: [], facts: {} }) });
    expect(out.request).toEqual({ kind: "unclear" });
    expect(out.text).toMatch(/^I'm not sure what you'd like\./);
  });
});
