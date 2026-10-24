import type { DreamFile, DreamSection } from "@dpg/contracts";
import { describe, expect, it } from "vitest";
import { watchLines } from "./ask";
import { type CountryPref, describeStretch, type DreamQuery, findStretches, gradeFor, type StretchResult } from "./matchmaker";

const LEVELS = [
  { level: 1, name: "Leisurely", km_min: 20, km_max: 40, climb_max_m: 300 },
  { level: 2, name: "Easy-moderate", km_min: 40, km_max: 60, climb_max_m: 500 },
  { level: 3, name: "Moderate", km_min: 50, km_max: 80, climb_max_m: 850 },
  { level: 4, name: "Challenging", km_min: 70, km_max: 100, climb_max_m: 1200 },
  { level: 5, name: "Tough", km_min: 90, km_max: 130, climb_max_m: 1500 },
];
const twelve = <T>(v: T) => Array.from({ length: 12 }, () => v);

function section(n: number, over: Partial<DreamSection> = {}): DreamSection {
  return {
    number: n,
    from_m: (n - 1) * 50_000,
    to_m: n * 50_000,
    length_m: 50_000,
    country: "XX",
    ascent_fwd_m: 300,
    ascent_rev_m: 300,
    ascent_known_fwd_m: null,
    ascent_known_rev_m: null,
    climb_unknown_m: 0,
    max_grade_500m: 4,
    steepest_fwd: { "2": 3, "5": 2 },
    steepest_rev: { "2": 3, "5": 2 },
    grade_fwd: 2,
    grade_rev: 2,
    surfaces: { road: 0.5, cycle_path: 0.5, gravel: 0, unknown: 0 },
    busy_share: 0,
    themes: { coast: { score: n <= 3 ? 0.9 : 0.1, note: "" }, wine: { score: 0.2, note: "" } },
    remote_share: 0,
    longest_remote_m: 0,
    climate: null,
    daylight_h: twelve(12),
    crowding: { country: "XX", school_days: twelve(null), school_year: null, public_holidays: twelve(null), tourism_index: twelve(null), tourism_years: null },
    campsites: { counted: 1, published: 0, open: twelve(0), partly: twelve(0) },
    accommodation: { campsite: 1, hostel: 0, hotel: 2 },
    services: {},
    longest_gap_m: {},
    station_start: `station ${n}a`,
    station_end: `station ${n}b`,
    findings: {},
    comfort: twelve(60),
    best_time: Array.from({ length: 12 }, (_, m) => (m === 9 ? 80 : 50)),
    partial: twelve([]),
    direction: twelve({ advice: "either", wind_along_ms: 0, climb_diff_m: 0 }),
    check: [],
    ...over,
  } as DreamSection;
}

function dream(sections: DreamSection[], breaks: DreamFile["breaks"] = []): DreamFile {
  return {
    profile: "dream-v0",
    season_year: 2027,
    climate_source: "test",
    levels: LEVELS,
    themes: [
      { id: "coast", title: "Coast & beaches", measures: "" },
      { id: "wine", title: "Vineyards & wine", measures: "" },
    ],
    sections,
    breaks,
  };
}

const base: DreamQuery = {
  level: 3,
  days: 4,
  month: 9,
  surfaces: { road: "ok", cycle_path: "prefer", gravel: "avoid" },
  themes: [],
  trainBothEnds: false,
  stay: "any",
  avoidBusy: false,
  direction: "forward",
};

describe("gradeFor", () => {
  it("picks the lowest level covering distance and climbing", () => {
    expect(gradeFor(LEVELS, 55, 200)).toBe(2);
    expect(gradeFor(LEVELS, 55, 700)).toBe(3);
    expect(gradeFor(LEVELS, 140, 100)).toBe(5);
  });
});

describe("findStretches", () => {
  const ten = Array.from({ length: 10 }, (_, i) => section(i + 1));

  it("returns stretches that fit the level and never cross a hard break", () => {
    const d = dream(ten, [{ after_section: 5, type: "missing", straight_distance_m: 30_000, hard: true }]);
    const results = findStretches(d, base);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.kmPerDay).toBeGreaterThanOrEqual(35);
      expect(r.kmPerDay).toBeLessThanOrEqual(88);
      expect(r.first <= 5 && r.last >= 6).toBe(false);
    }
  });

  it("counts an unfilled gap as ridden, with its terrain unknown (D50)", () => {
    const d = dream(ten, [{ after_section: 5, type: "missing", straight_distance_m: 30_000, hard: false }]);
    const [across] = findStretches(d, { ...base, days: 3, direction: "forward" }).filter((r) => r.first <= 5 && r.last >= 6);
    expect(across).toBeDefined();
    const sections = across!.last - across!.first + 1;
    expect(across!.km).toBe(sections * 50 + 30);
    expect(across!.gradeAtLeast).toBe(true);
    expect(across!.climbUnknownKm).toBe(30);
    expect(across!.watch.some((w) => w.includes("30 km gap in the route") && w.includes("counted as ridden"))).toBe(true);
  });

  it("favours the chosen themes", () => {
    const [top] = findStretches(dream(ten), { ...base, themes: ["coast"] });
    expect(top?.first).toBe(1);
    expect(top?.why.some((w) => w.includes("Coast"))).toBe(true);
  });

  it("filters on train at both ends and busy roads", () => {
    const noStation = ten.map((s) => (s.number <= 4 ? section(s.number, { station_start: null, station_end: null }) : s));
    expect(findStretches(dream(noStation), { ...base, trainBothEnds: true }).every((r) => r.first > 4)).toBe(true);
    const busy = ten.map((s) => section(s.number, { busy_share: s.number <= 6 ? 0.5 : 0 }));
    const calm = findStretches(dream(busy), { ...base, avoidBusy: true });
    expect(calm.length).toBeGreaterThan(0);
    expect(calm.every((r) => r.busyShare <= 0.15)).toBe(true);
  });

  it("picks the best month when none is given", () => {
    const [top] = findStretches(dream(ten), { ...base, month: null });
    expect(top?.month).toBe(9);
  });

  it("does not rank down missing data, but lists it to check", () => {
    const gaps = ten.map((s) =>
      section(s.number, { partial: twelve(["school holidays"]), check: ["School holidays: no data."] }),
    );
    const [withGaps] = findStretches(dream(gaps), base);
    const [complete] = findStretches(dream(ten), base);
    expect(withGaps?.score).toBeCloseTo(complete!.score, 6);
    expect(withGaps?.check.some((c) => c.includes("school holidays"))).toBe(true);
    expect(complete?.check).toEqual([]);
  });

  it("skips unknown theme data instead of scoring it as 0, and lists it to check", () => {
    const unknown = ten.map((s) => section(s.number, { themes: { ...s.themes, wine: { score: null, note: "unknown" } } }));
    const [top] = findStretches(dream(unknown), { ...base, themes: ["coast", "wine"] });
    const [coastOnly] = findStretches(dream(ten), { ...base, themes: ["coast"] });
    expect(top?.score).toBeCloseTo(coastOnly!.score, 6);
    expect(top?.check).toContain(`Vineyards & wine: no data for ${top?.km} km of this stretch: judge it yourself.`);
  });

  it("shows partly unknown climbing as a minimum, and rules runs out when even that is too much", () => {
    const placeholder = { ascent_fwd_m: null, ascent_rev_m: null, ascent_known_fwd_m: 100, ascent_known_rev_m: 100, climb_unknown_m: 30_000 };
    const partly = ten.map((s) => (s.number === 3 ? section(3, placeholder) : s));
    const across = findStretches(dream(partly), { ...base, limit: 50 }).filter((r) => r.first <= 3 && r.last >= 3);
    expect(across.length).toBeGreaterThan(0);
    for (const r of across) {
      expect(r.climbPerDay).toBeNull();
      expect(r.climbMinPerDay).toBe(Math.round(((r.last - r.first) * 300 + 100) / r.days));
      expect(r.gradeAtLeast).toBe(true);
      expect(r.climbUnknownKm).toBe(30);
      expect(r.check).toContain("Climbing is unknown for 30.0 km of this stretch, so the climbing and grade shown are minimums: check the real road.");
    }
    const steep = ten.map((s) => (s.number === 3 ? section(3, { ...placeholder, ascent_known_fwd_m: 9000 }) : s));
    const ok = findStretches(dream(steep), { ...base, limit: 50 });
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((r) => r.first <= 3 && r.last >= 3)).toBe(false);
  });

  it("never shows NaN when a bundle lacks the known-climbing fields", () => {
    const old = ten.map((s) => {
      if (s.number !== 3) return s;
      const { ascent_known_fwd_m: _f, ascent_known_rev_m: _r, climb_unknown_m: _u, ...rest } = section(3, { ascent_fwd_m: null, ascent_rev_m: null });
      return rest as DreamSection;
    });
    const across = findStretches(dream(old), { ...base, limit: 50 }).filter((r) => r.first <= 3 && r.last >= 3);
    expect(across.length).toBeGreaterThan(0);
    for (const r of across) {
      expect(r.climbMinPerDay).toBe(Math.round(((r.last - r.first) * 300) / r.days));
      expect(r.climbUnknownKm).toBe(50); // the whole section counts as unknown
      expect(r.why.join(" ")).not.toContain("NaN");
    }
  });

  it("evaluates the reverse direction with the reverse climbing", () => {
    const hilly = ten.map((s) => section(s.number, { ascent_fwd_m: 1500, ascent_rev_m: 200 }));
    // Forward, only stretches short enough for the climbing are within the level: easier days (D76).
    const fwd = findStretches(dream(hilly), { ...base, days: 4, direction: "forward" });
    expect(fwd.every((r) => r.easier)).toBe(true);
    expect(findStretches(dream(hilly), { ...base, days: 4, direction: "reverse" }).some((r) => !r.easier)).toBe(true);
  });

  it("treats the level as a ceiling: a route shorter than the days fits, as an easier trip (D76)", () => {
    const short = Array.from({ length: 4 }, (_, i) => section(i + 1)); // 200 km
    const r = findStretches(dream(short), { ...base, days: 8 });
    expect(r[0]).toMatchObject({ first: 1, last: 4, easier: true, kmPerDay: 25 });
  });
});

describe("describeStretch", () => {
  const ten = Array.from({ length: 10 }, (_, i) => section(i + 1));

  it("describes a stretch the rider picked, with the days of a middling day at the level", () => {
    const r = describeStretch(dream(ten), 2, 5, { ...base, days: null });
    expect(r).toMatchObject({ first: 2, last: 5, way: "forward", km: 200, days: 4 }); // 200 km at Moderate's 65 km
    expect(describeStretch(dream(ten), 5, 2, { ...base, days: null })?.way).toBe("reverse");
  });

  it("never rules it out, but says where it goes beyond the level or needs", () => {
    const noStation = ten.map((s) => section(s.number, { station_start: null, station_end: null }));
    const r = describeStretch(dream(noStation), 1, 10, { ...base, days: 2, trainBothEnds: true });
    expect(r).not.toBeNull();
    expect(r!.watch.some((w) => w.startsWith("250 km a day: more than Moderate's 80 km"))).toBe(true);
    expect(r!.watch).toContain("no bike-carrying station found at one end");
    // Said only to riders who asked for trains at both ends (D79).
    expect(describeStretch(dream(noStation), 1, 10, { ...base, days: 2 })!.watch).not.toContain("no bike-carrying station found at one end");
  });

  it("counts an unfilled gap it crosses as ridden (D50)", () => {
    const d = dream(ten, [{ after_section: 5, type: "missing", straight_distance_m: 30_000, hard: true }]);
    const r = describeStretch(d, 4, 7, { ...base, days: null });
    expect(r!.km).toBe(230);
    expect(r!.watch.some((w) => w.includes("30 km gap in the route"))).toBe(true);
  });
});

describe("mergeChecks", () => {
  it("sums opening-season gaps across sections and drops duplicates", async () => {
    const { mergeChecks } = await import("./matchmaker");
    expect(
      mergeChecks([
        "3 of 5 places to stay publish no opening season: check dates ahead.",
        "School holidays: no data.",
        "4 of 4 places to stay publish no opening season: check dates ahead.",
        "School holidays: no data.",
      ]),
    ).toEqual(["7 of 9 places to stay publish no opening season: check dates ahead.", "School holidays: no data."]);
  });
});

describe("a stretch's card", () => {
  it("keeps the count of things to look out for when the lines run over", () => {
    const count = "6 things to look out for: details with a Trip Pass";
    const r = { watch: ["104 km on busy roads", "up to 53 km between places to stay", "a steep 2 km at 9%", "no bike-carrying station found at one end", count], lookOut: 6 };
    expect(watchLines(r as StretchResult)).toEqual(["104 km on busy roads", "up to 53 km between places to stay", "a steep 2 km at 9%", count]);
    expect(watchLines({ watch: ["a", "b", "c", "d", "e"], lookOut: 0 } as StretchResult)).toEqual(["a", "b", "c", "d"]);
    expect(watchLines({ watch: ["a", count], lookOut: 6 } as StretchResult)).toEqual(["a", count]);
  });
});

describe("a long steep stretch (D75, D87)", () => {
  const hilly = Array.from({ length: 4 }, (_, i) =>
    section(i + 1, i === 1 ? { max_grade_500m: 14, steepest_fwd: { "2": 7.4, "5": 6.2 }, steepest_rev: { "2": 5, "5": 4 } } : {}),
  );
  const watch = (q: Partial<DreamQuery>) => describeStretch(dream(hilly), 1, 4, { ...base, days: 4, ...q })!;

  it("is raised at the selected level's length, in the direction ridden", () => {
    expect(watch({}).watch).toContain("a steep 2 km at 7%");
    expect(watch({}).steepest).toEqual({ km: 2, grade: 7.4 });
    // Riding back, the same stretch is a descent; the climb that way is gentler.
    expect(describeStretch(dream(hilly), 4, 1, { ...base, days: 4 })!.watch.join()).not.toContain("steep");
    // At levels 4-5 only 5 km over 8% counts; a short ramp of 14% never does.
    expect(watch({ level: 4 }).watch.join()).not.toContain("steep");
    expect(watch({ level: 4 }).steepest).toEqual({ km: 5, grade: 6.2 });
  });

  it("is unknown on an audit older than D87, and never guessed from the 500 m", () => {
    const old = hilly.map((s) => ({ ...s, steepest_fwd: undefined, steepest_rev: undefined }) as unknown as DreamSection);
    const r = describeStretch(dream(old), 1, 4, { ...base, days: 4 })!;
    expect(r.steepest).toEqual({ km: 2, grade: null });
    expect(r.watch.join()).not.toContain("steep");
  });
});

describe("countries and a town to pass through (D80)", () => {
  const two = Array.from({ length: 10 }, (_, i) => section(i + 1, { country: i < 5 ? "IT" : "GR" }));

  it("keeps a search within the countries marked only, and out of those to avoid", () => {
    for (const countries of [{ GR: "avoid" }, { IT: "only" }] as Record<string, CountryPref>[]) {
      const rs = findStretches(dream(two), { ...base, days: 2, countries, limit: 20 });
      expect(rs.length).toBeGreaterThan(0);
      expect(rs.every((r) => r.last <= 5)).toBe(true);
    }
  });

  it("never rules a picked stretch out, but says where it leaves them", () => {
    const r = describeStretch(dream(two), 3, 8, { ...base, days: 4, countries: { GR: "avoid" } });
    expect(r!.watch).toContain("enters Greece, which you'd rather avoid");
    const s = describeStretch(dream(two), 3, 8, { ...base, days: 4, countries: { IT: "only" } });
    expect(s!.watch).toContain("goes outside Italy, into Greece");
  });

  it("keeps to stretches that pass a town", () => {
    const rs = findStretches(dream(two), { ...base, days: 2, through: { m: 375_000, name: "Midway" }, limit: 20 });
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.first <= 8 && r.last >= 8)).toBe(true);
    expect(describeStretch(dream(two), 1, 3, { ...base, days: 2, through: { m: 375_000, name: "Midway" } })!.watch).toContain("doesn't pass Midway");
  });
});
