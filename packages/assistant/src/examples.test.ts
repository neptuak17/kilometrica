import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { closest, indexExamples, wordsOf } from "./examples";
import { readCases } from "./harness/cases";
import { checkExamples, loadExamples } from "./harness/examples";

describe("the closest examples (D101)", () => {
  it("reads numbers, months and towns alike, and a town only as a whole word", () => {
    expect(wordsOf("2 days off in Saint-Jean in June?", ["Saint-Jean", "Jean"])).toEqual(["#", "days", "off", "in", "town", "in", "month"]);
    expect(wordsOf("Is the campsite nice?", ["Nice"])).toContain("town");
    expect(wordsOf("Is the campsite niceish?", ["Nice"])).not.toContain("town");
  });

  it("picks examples of the kind the message is, at most three of one kind", () => {
    const index = indexExamples(loadExamples("plan"));
    const picked = closest(index, "Could I have two rest days in Koblenz?", ["Koblenz"]);
    expect(picked.at(-1)!.request.kind).toBe("rest_in");
    expect(picked.filter((e) => e.request.kind === "rest_in").length).toBeLessThanOrEqual(3);
  });

  it("each is a request our code takes, every kind has enough, and none is too close to a case", () => {
    const sets = resolve(import.meta.dirname, "../sets/en");
    const cases = ["dream", "plan"].flatMap((p) => readCases(JSON.parse(readFileSync(resolve(sets, `${p}.json`), "utf8")), `${p}.json`).cases);
    expect(checkExamples(cases).problems).toEqual([]);
  });
});
