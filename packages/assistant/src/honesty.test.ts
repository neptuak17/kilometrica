import { describe, expect, it } from "vitest";
import { checkAnswer, retryNote, toolLines } from "./honesty";
import { PLAN_TOOLS } from "./plan";
import { testPlan } from "./testdata";
import type { ToolResult } from "./tool";

const day3: ToolResult = {
  lines: [
    "Day 3, Sun 17 Oct: Benicarló → l'Ampolla. 76 km, 444 m of climbing; within your level.",
    "Riding 5 h 13, about 7 h 16 with stops; off at 09:00, in by 16:16, sunset 19:16.",
    "Steepest 2 km: 7% at km 31.",
    "Typically 15–23 °C, rain 1 day in 4, little wind along the way.",
    "Night at l'Ampolla: 3 campsites, 11 hotels, 1 guest house and 1 other place to stay nearby, check ahead if they're open.",
  ],
  facts: { day: 3, km: "76", climbM: "444", total: { km: "1,463" } },
};
const night: ToolResult = {
  lines: ["Here: Camping Vizmar (campsite); Sant Adrià de Besòs; Castelló de la Plana / Castellón de la Plana (hotel)."],
  facts: {},
};
const check = (answer: string, rider: string[] = []) => checkAnswer(answer, { results: [day3, night], rider });
const failing = (answer: string, rider: string[] = []) => check(answer, rider).unsupported.map((u) => u.text);

describe("the honesty check (D38, D77, D81)", () => {
  it("passes an answer that says only what the tools said, as they wrote it", () => {
    expect(check("Day 3 is 76 km with 444 m of climbing, so you'd be in around 16:16, well before sunset at 19:16.").ok).toBe(true);
    expect(check("Sure! Day 3 runs from Benicarló to l'Ampolla. There are 3 campsites and 11 hotels at l'Ampolla.").ok).toBe(true);
    expect(check("It's usually 15–23 °C in October, with rain about 1 day in 4.").ok).toBe(true);
    // The same number written another way, and a time with or without its leading zero.
    expect(check("The whole route is 1463 km; you leave at 9:00.").ok).toBe(true);
    // Number words for numbers the tools gave; "one" never needs a source.
    expect(check("Three campsites, and one guest house.").ok).toBe(true);
    // A gradient, as the tools gave it; names from the tools, with or without accents.
    expect(check("The steepest part is 7% at km 31. Camping Vizmar is a campsite near Sant Adria de Besos.").ok).toBe(true);
  });

  it("passes our own words: months, weekdays, levels, the Trip Pass and the sites we hand off to", () => {
    expect(check("On Sunday in October, at Moderate, it's within your level. Search Booking.com or Expedia, or see it in Google Maps.").ok).toBe(true);
    expect(check("Where to sleep comes with a Trip Pass; Plan lists it on the day card.").ok).toBe(true);
  });

  it("passes what the rider said themselves", () => {
    expect(check("You can't book Barcelona through us, but Spain's trains carry bikes.", ["Can I stay in Barcelona? I'm flying to Spain."]).ok).toBe(true);
    expect(failing("You can't book Barcelona through us.", ["Can I stay in Barcelona?"])).toEqual([]);
    expect(failing("Your 14 days work.", ["I have 14 days"])).toEqual([]);
  });

  it("catches a changed, rounded, summed or converted number", () => {
    expect(failing("Day 3 is about 75 km and you'll arrive before 4:30.")).toEqual(["4:30", "75"]);
    expect(failing("Day 3 is about 80 km.")).toEqual(["80"]);
    expect(failing("Days 1 to 3 add up to 210 km.")).toEqual(["210"]);
    expect(failing("That's 47 miles.")).toEqual(["47"]);
    expect(failing("You'll arrive at 17:00.")).toEqual(["17:00"]);
    expect(failing("Eight hotels are open.")).toEqual(["Eight"]);
  });

  it("catches a percentage that isn't a gradient the tools gave", () => {
    expect(failing("About 40% of the day is on roads.")).toEqual(["40%"]);
  });

  it("catches a name the tools never gave: invented, or known from elsewhere", () => {
    expect(failing("Try the Hotel du Port in l'Ampolla.")).toEqual(["Hotel du Port"]);
    expect(failing("Barcelona is worth a day.")).toEqual(["Barcelona"]);
    expect(failing("The Ebro delta is lovely in October.")).toEqual(["Ebro"]);
  });

  it("reads ordinary words as words: I'll, and a sentence's first word ending -ing, -ly or -ed; a possessive keeps the name", () => {
    const shop: ToolResult = { lines: ["To eat: Lola's Tortas (open that day). Avoid Greece."], facts: {} };
    const ok = (a: string) => checkAnswer(a, { results: [shop], rider: [] }).unsupported.map((u) => u.text);
    expect(ok("Choose one and I'll show you. Whether that's you is your call.")).toEqual([]);
    expect(ok("Avoiding Greece, it fits. Usually it's quiet.")).toEqual([]);
    expect(ok("Lola's Tortas is open that day.")).toEqual([]);
    // Counting what the tools showed is working a number out (D81).
    expect(ok("Two ways to do it.")).toEqual(["Two"]);
  });

  it("isn't fooled by a list's own numbers", () => {
    expect(check("Two ways:\n1. Ride to l'Ampolla, 76 km.\n2. Stop at Benicarló.").ok).toBe(true);
  });

  it("tells the model what failed, and falls back to the tools' own lines", () => {
    const c = check("Day 3 is about 75 km.");
    expect(retryNote(c)).toMatch(/^These words in your answer don't come from the tools or the rider: "75"\./);
    expect(toolLines([day3])).toBe(day3.lines.join("\n"));
  });

  it("passes every line a real tool gives, read back as an answer", () => {
    const ctx = testPlan();
    for (const tool of PLAN_TOOLS.filter((t) => t.name !== "offer_options")) {
      const r = tool.run({ ...ctx, screen: { day: 2 } }, { after_day: 2 });
      const c = checkAnswer(r.lines.join(" "), { results: [r], rider: [] });
      expect({ tool: tool.name, unsupported: c.unsupported }).toEqual({ tool: tool.name, unsupported: [] });
    }
  });
});
