import type { DreamSection, EffortFile, Highlight, Place, ServiceType, Stop } from "@dpg/contracts";
import { describe, expect, it } from "vitest";
import { applyAction, optionOutcome, type PlanState } from "./actions";
import { TripAxis } from "./axis";
import { planChanges } from "./changes";
import { choicesOf, parseDocument, toDocument } from "./document";
import { calendarFile, dayGpx, tripGpx } from "./exports";
import { bearing, type Geometry } from "./geometry";
import { bookingSearches, dayItems, mapsSearch, nightStay, streetPhotos, wikiLinks } from "./items";
import { LEVEL_FLAT_KMH, riderFor, speed, usualDay } from "./pace";
import { makePlan } from "./plan";
import { fromUtf8, itineraryOf, readFragment, shareFragment, utf8 } from "./share";
import { bedsFor } from "./stages";
import { addDays, clock, sunTimes, weekday } from "./sun";
import { bedsKnown, stayDates } from "./text";
import { NO_CHOICES, type NightPlan, type PlanData, type PlanInputs } from "./types";

const LEVELS = [
  { level: 1, name: "Leisurely", km_min: 20, km_max: 40, climb_max_m: 300 },
  { level: 2, name: "Easy-moderate", km_min: 40, km_max: 60, climb_max_m: 500 },
  { level: 3, name: "Moderate", km_min: 50, km_max: 80, climb_max_m: 850 },
  { level: 4, name: "Challenging", km_min: 70, km_max: 100, climb_max_m: 1200 },
  { level: 5, name: "Tough", km_min: 90, km_max: 130, climb_max_m: 1500 },
];
const twelve = <T>(v: T) => Array.from({ length: 12 }, () => v);
const LAT = 43.5;
const DEG_PER_M = 1 / 80_700; // roughly, at this latitude

function section(n: number, from: number, to: number): DreamSection {
  return {
    number: n,
    from_m: from,
    to_m: to,
    length_m: to - from,
    country: "FR",
    climate: {
      point: [0, LAT],
      distance_m: 0,
      tmax_c: twelve(21),
      tmin_c: twelve(12),
      rain_days: twelve(0.2),
      rain_mm: twelve(1),
      heat_days: twelve(0),
      windy_days: twelve(0.1),
      wind_along_ms: twelve(0),
      headwind_days_fwd: twelve(0),
      headwind_days_rev: twelve(0),
    },
    themes: { coast: { score: 0.9, note: "" } },
    crowding: { country: "FR", school_days: twelve(0), school_year: 2027, public_holidays: twelve(0), public_year: 2027, tourism_index: twelve(1), tourism_years: "x" },
    findings: { warning: 2 },
  } as unknown as DreamSection;
}

function stop(km: number, over: Partial<Stop> = {}): Stop {
  return {
    id: `s${km}`,
    name: `Town ${km}`,
    place_kind: "town",
    at_m: km * 1000,
    lon: km * 1000 * DEG_PER_M,
    lat: LAT,
    country: "FR",
    detour_m: 200,
    beds: [
      { kind: "hotel", count: 2, seasons: [["????????????", 2]] },
      { kind: "campsite", count: 1, seasons: [["oooooooooooo", 1]] },
    ],
    services: { food: 2, water: 1 },
    station: km % 50 === 0 ? `Gare ${km}` : null,
    station_at_m: km % 50 === 0 ? km * 1000 : null,
    ...over,
  };
}

interface Opts {
  lengthKm?: number;
  hill?: number;
  gapAtKm?: number;
  gapType?: string;
  stopsEvery?: number;
  stops?: Stop[];
}

function data({ lengthKm = 300, hill = 0, gapAtKm, gapType = "missing", stopsEvery = 10, stops }: Opts = {}): PlanData {
  const L = lengthKm * 1000;
  const mk = (from: number, to: number) => {
    const n = Math.ceil((to - from) / 100);
    const ele = Array.from({ length: n + 1 }, (_, i) => Math.round(100 + hill * Math.sin((from + i * 100) / 4000)));
    return { from_m: from, to_m: to, ele, surface: "c".repeat(n) };
  };
  const gap = gapAtKm !== undefined ? gapAtKm * 1000 : null;
  const effort: EffortFile = {
    step_m: 100,
    parts: gap === null ? [mk(0, L)] : [mk(0, gap), mk(gap, L)],
    gaps: gap === null ? [] : [{ at_m: gap, after_section: 1, type: gapType, straight_distance_m: 20_000, basis: null, confidence: "medium" }],
  };
  const all = stops ?? Array.from({ length: Math.floor(lengthKm / stopsEvery) - 1 }, (_, i) => stop((i + 1) * stopsEvery));
  return {
    route: { network: "test", ref: "t1", runId: "20270101T000000Z_0000000000", name: "Test route" },
    dream: {
      profile: "dream-v0",
      season_year: 2027,
      climate_source: "test",
      levels: LEVELS,
      themes: [{ id: "coast", title: "Coast & beaches", measures: "" }],
      sections: Array.from({ length: Math.ceil(lengthKm / 50) }, (_, i) => section(i + 1, i * 50_000, Math.min(L, (i + 1) * 50_000))),
      breaks: [],
    },
    stops: { season_year: 2027, reach_m: 2500, stops: all },
    effort,
    calendar: {
      season_year: 2027,
      countries: [{ country: "FR", public_year: 2027, public: [{ date: "2027-11-01", name: "All Saints' Day", nationwide: true, regions: [] }], school_year: 2027, school: [] }],
    },
    daily: [],
    full: null,
  };
}

const inputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  fromM: 0,
  toM: 300_000,
  direction: "forward",
  startDate: "2027-10-13",
  days: 5,
  level: 3,
  bike: "touring",
  sleep: "rooms",
  startMinutes: 9 * 60,
  stopStyle: "normal",
  restAfter: [],
  avoidGravel: false,
  avoidBusy: false,
  ...over,
});

describe("pace", () => {
  it("rides each level's flat speed on a touring bike, slower uphill, faster down", () => {
    for (const level of [1, 3, 5]) {
      const r = riderFor(level, "touring");
      expect(speed(r, 0, "paved") * 3.6).toBeCloseTo(LEVEL_FLAT_KMH[level]!, 1);
    }
    const r = riderFor(3, "touring");
    expect(speed(r, 0.05, "paved")).toBeLessThan(speed(r, 0, "paved") / 2);
    expect(speed(r, -0.05, "paved")).toBeGreaterThan(speed(r, 0, "paved"));
    expect(speed(r, 0, "gravel")).toBeLessThan(speed(r, 0, "paved"));
    expect(speed(r, 0, "paved", 3)).toBeGreaterThan(speed(r, 0, "paved", 0)); // tailwind
  });

  it("assists an e-bike up to 25 km/h, never beyond on the flat", () => {
    const e = riderFor(3, "ebike");
    expect(speed(e, 0.06, "paved")).toBeGreaterThan(speed(riderFor(3, "touring"), 0.06, "paved") * 1.5);
    expect(speed(e, 0, "paved") * 3.6).toBeLessThanOrEqual(25.01);
  });

  it("makes a Moderate usual day roughly 4-5 hours of riding", () => {
    const m = LEVELS[2]!;
    const u = usualDay(riderFor(3, "touring"), m.km_min, m.km_max, m.climb_max_m);
    expect(u.hours).toBeGreaterThan(3.6);
    expect(u.hours).toBeLessThan(5.2);
  });
});

describe("sun", () => {
  it("gives local sunset times through the country's time zone", () => {
    const s = sunTimes("2027-10-13", 43.6, 3.88, "FR"); // Montpellier
    expect(s.approximate).toBe(false);
    expect(s.sunset!).toBeGreaterThan(18 * 60 + 50);
    expect(s.sunset!).toBeLessThan(19 * 60 + 20);
    expect(s.sunrise!).toBeLessThan(8 * 60 + 15);
    expect(sunTimes("2027-10-13", 43.6, 3.88, null).approximate).toBe(true);
    expect(clock(19 * 60 + 5)).toBe("19:05");
    expect(weekday("2027-10-17")).toBe(6); // a Sunday
  });
});

describe("trip axis", () => {
  const r = riderFor(3, "touring");
  const secs = data().dream.sections;
  it("measures the same distance either way, and counts an unfilled gap as ridden (D50)", () => {
    const d = data({ gapAtKm: 155 });
    const fwd = new TripAxis(d.effort, 0, 300_000, "forward", r, secs, () => 0);
    const rev = new TripAxis(d.effort, 0, 300_000, "reverse", r, secs, () => 0);
    expect(fwd.length).toBeCloseTo(320_000, 0);
    expect(rev.length).toBeCloseTo(320_000, 0);
    expect(fwd.tOf(200_000)).toBeCloseTo(220_000, 0);
    expect(rev.tOf(200_000)).toBeCloseTo(100_000, 0);
    const st = fwd.stats(140_000, 180_000);
    expect(st.gaps).toEqual([{ type: "missing", km: 20, atM: 155_000 }]);
    expect(st.unknownKm).toBeCloseTo(20, 1);
  });

  it("leaves a ferry out of the ridden distance", () => {
    const d = data({ gapAtKm: 155, gapType: "ferry" });
    const axis = new TripAxis(d.effort, 0, 300_000, "forward", r, secs, () => 0);
    expect(axis.length).toBeCloseTo(300_000, 0);
  });
});

describe("makePlan", () => {
  it("plans days close to the rider's usual day, with a stop each night", () => {
    const p = makePlan(data(), inputs());
    expect(p.days).toHaveLength(5);
    expect(p.nights).toHaveLength(4);
    expect(p.days.every((d) => d.effort === "within")).toBe(true);
    expect(p.days.map((d) => d.date)).toEqual(["2027-10-13", "2027-10-14", "2027-10-15", "2027-10-16", "2027-10-17"]);
    expect(p.days.reduce((a, d) => a + d.km, 0)).toBeCloseTo(300, 0);
    for (const d of p.days) expect(d.km).toBeGreaterThan(45);
    expect(p.brief.lines.map((l) => l.question)).toEqual([
      "Can I do it?",
      "Where will I sleep?",
      "What could go wrong?",
      "What do I sort out before I go?",
      "What will it be like?",
    ]);
    expect(p.mode).toBe("free");
  });

  it("asks for a call when the days are too few, and offers a day more", () => {
    const p = makePlan(data(), inputs({ days: 3 }));
    expect(p.items.some((i) => i.kind === "call" && i.id.startsWith("effort:beyond:"))).toBe(true);
    expect(p.offers.some((o) => o.days === 4)).toBe(true);
    expect(p.brief.lines[0]!.answer).toMatch(/beyond your level/);
  });

  it("inserts rest days and keeps locked nights", () => {
    const base = makePlan(data(), inputs());
    const lockedId = "s120";
    const p = makePlan(data(), inputs({ restAfter: [2] }), { ...NO_CHOICES, locked: { 1: lockedId } });
    expect(p.days).toHaveLength(6);
    expect(p.days[2]!.kind).toBe("rest");
    expect(p.days[3]!.date).toBe("2027-10-16");
    expect(p.nights[1]!.stop.id).toBe(lockedId);
    expect(base.nights.map((n) => n.stop.id)).not.toContain(undefined);
  });

  it("keeps a locked night with no bed of the rider's kind, and plans the rest around it", () => {
    const stops = Array.from({ length: 29 }, (_, i) =>
      stop((i + 1) * 10, (i + 1) * 10 === 120 ? { beds: [{ kind: "hotel", count: 1, seasons: [["????????????", 1]] }] } : {}),
    );
    const p = makePlan(data({ stops }), inputs({ sleep: "camping" }), { ...NO_CHOICES, locked: { 1: "s120" } });
    expect(p.nights[1]!.stop.id).toBe("s120");
    expect(p.nights.every((n) => !n.stop.id.startsWith("none-"))).toBe(true);
    expect(p.items.some((i) => i.id === "bed:none:1")).toBe(true);
  });

  it("checks beds whose season is unknown, and knows when no bed of the rider's kind exists", () => {
    const rooms = makePlan(data(), inputs({ sleep: "rooms" }));
    expect(rooms.items.filter((i) => i.id.startsWith("bed:check:"))).toHaveLength(4); // hotels publish no dates
    const camping = makePlan(data(), inputs({ sleep: "camping" }));
    expect(camping.items.some((i) => i.id.startsWith("bed:check:"))).toBe(false); // campsites publish theirs
    const noCamps = data({ stops: Array.from({ length: 29 }, (_, i) => stop((i + 1) * 10, { beds: [{ kind: "hotel", count: 1, seasons: [["????????????", 1]] }] })) });
    const p = makePlan(noCamps, inputs({ sleep: "camping" }));
    expect(p.items.some((i) => i.id.startsWith("bed:none:"))).toBe(true);
    expect(bedsFor(stop(10), "camping", 9)).toEqual({ count: 1, open: 1, partly: 0, closed: 0, unknown: 0 });
  });

  it("highlights an unfilled gap and counts it as ridden; a ferry becomes a check (D50)", () => {
    const gap = makePlan(data({ gapAtKm: 155 }), inputs({ toM: 300_000 }));
    expect(gap.items.some((i) => i.id === "gap:155000" && i.kind === "headsup")).toBe(true);
    expect(gap.days.reduce((a, d) => a + d.km, 0)).toBeCloseTo(320, 0);
    const ferry = makePlan(data({ gapAtKm: 155, gapType: "ferry" }), inputs());
    expect(ferry.items.some((i) => i.id === "ferry:155000" && i.kind === "todo")).toBe(true);
  });

  it("flags a day that ends after sunset at the rider's pace", () => {
    const p = makePlan(data(), inputs({ days: 4, startMinutes: 14 * 60 }));
    expect(p.items.some((i) => i.id.startsWith("sunset:"))).toBe(true);
  });

  it("plans the reverse direction from the far end", () => {
    const p = makePlan(data(), inputs({ direction: "reverse" }));
    expect(p.days[0]!.fromM).toBe(300_000);
    expect(p.days[p.days.length - 1]!.toM).toBe(0);
    expect(p.nights.map((n) => n.stop.at_m)).toEqual([...p.nights.map((n) => n.stop.at_m)].sort((a, b) => b - a));
  });

  it("says nothing about water or food where places didn't load (D37)", () => {
    const service = (id: string): ServiceType => ({ id, title: id, count_m: 5000, count_min: null, show_m: 5000, costing: "bicycle", gap_m: 20_000, gap_also: [] });
    // One café at km 5, with known hours; no water anywhere else.
    const cafe = { id: "cafe", service: "food", kind: "cafe", name: "Café", access_at_m: 5000, counts: true, months: "????????????", opening_hours: null, detail: { days: "o".repeat(366) } } as unknown as Place;
    const withFull = (placesMissing: { fromM: number; toM: number }[]): PlanData => ({
      ...data(),
      full: { findings: [], places: [cafe], placesMissing, highlights: [], climbs: [], serviceTypes: [service("water"), service("food")] },
    });
    const all = makePlan(withFull([]), inputs());
    const part = makePlan(withFull([{ fromM: 150_000, toM: 300_000 }]), inputs());
    const gapDays = (p: typeof all) => p.items.filter((i) => i.id.startsWith("water:gap:")).map((i) => i.day);
    expect(gapDays(all)).toEqual(all.days.map((d) => d.number));
    // Days touching the part that didn't load make no claim; the others still do.
    expect(gapDays(part)).toEqual(part.days.filter((d) => Math.max(d.fromM, d.toM) <= 150_000).map((d) => d.number));
    expect(gapDays(part).length).toBeGreaterThan(0);
    expect(all.brief.confidence).toContain("All the food places along the way are open on your days");
    expect(part.brief.confidence.some((c) => c.includes("food places"))).toBe(false);
  });

  it("keeps a day's heads-ups and highlights within the attention budget", () => {
    const p = makePlan(data(), inputs());
    for (const d of p.days) {
      const mine = dayItems(p.items, d.number);
      expect(mine.headsups.shown.length).toBeLessThanOrEqual(3);
      expect(mine.highlights.shown.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("plan actions and what changed (11.7)", () => {
  const state = (over: Partial<PlanInputs> = {}): PlanState => ({ inputs: inputs(over), choices: { ...NO_CHOICES, nights: ["s60", "s120", "s180", "s240"] } });

  it("re-plans on new answers and nights, and keeps the nights for a bed or a tick", () => {
    const s = state();
    const more = applyAction(s, { type: "add-day" });
    expect(more.inputs.days).toBe(6);
    expect(more.choices.nights).toBeUndefined();
    const bed = applyAction(s, { type: "bed", night: 1, place: "p1" });
    expect(bed.choices.beds).toEqual({ 1: "p1" });
    expect(bed.choices.nights).toEqual(s.choices.nights);
    expect(applyAction(bed, { type: "bed", night: 1, place: null }).choices.beds).toEqual({});
    expect(applyAction(s, { type: "set", inputs: { days: 0 } }).inputs.days).toBe(1);
    expect(applyAction(state({ startMinutes: 5 * 60 + 10 }), { type: "start-earlier", minutes: 30 }).inputs.startMinutes).toBe(5 * 60);
  });

  it("sets rather than toggles, so an action twice changes nothing more", () => {
    const once = applyAction(state({ restAfter: [3] }), { type: "rest", afterRide: 1, on: true });
    expect(once.inputs.restAfter).toEqual([1, 3]);
    expect(applyAction(once, { type: "rest", afterRide: 1, on: true }).inputs.restAfter).toEqual([1, 3]);
    expect(applyAction(once, { type: "rest", afterRide: 1, on: false }).inputs.restAfter).toEqual([3]);
    const booked = applyAction(state(), { type: "booked", night: 2, stop: "s170", on: true });
    expect(booked.choices.booked).toEqual([2]);
    expect(booked.choices.locked).toEqual({ 2: "s170" });
    const released = applyAction(booked, { type: "release-night", night: 2 });
    expect(released.choices.locked).toEqual({});
    expect(released.choices.booked).toEqual([]);
    const done = applyAction(state(), { type: "done", item: "x", on: true });
    expect(applyAction(done, { type: "done", item: "x", on: true }).choices.done).toEqual(["x"]);
  });

  it("turns a call's options into actions", () => {
    const call = { id: "effort:beyond:2" } as never;
    expect(optionOutcome(call, "keep")).toEqual({ action: { type: "dismiss", item: "effort:beyond:2" } });
    expect(optionOutcome(call, "add-day")).toEqual({ action: { type: "add-day" } });
    expect(optionOutcome(call, "days:6")).toEqual({ action: { type: "set", inputs: { days: 6 } } });
    expect(optionOutcome(call, "earlier:30")).toEqual({ action: { type: "start-earlier", minutes: 30 } });
    expect(optionOutcome(call, "rest:2")).toEqual({ action: { type: "rest", afterRide: 2, on: true } });
    expect(optionOutcome(call, "move:3")).toEqual({ showDay: 3 });
    expect(optionOutcome(call, "fly:1")).toBeNull();
  });

  it("says what changed, most important first", () => {
    const plan = (s: PlanState) => makePlan(data(), s.inputs, s.choices);
    const s = { inputs: inputs({ days: 3 }), choices: NO_CHOICES };
    const before = plan(s);
    expect(planChanges(before, before)).toMatchObject({ lines: [], summary: "", days: [] });
    const after = plan(applyAction(s, { type: "add-day" }));
    const c = planChanges(before, after);
    expect(c.lines[0]).toBe("One riding day more (4)");
    expect(c.days).toContain(4);
    expect(c.settled.length).toBeGreaterThan(0);
    expect(c.summary).toMatch(/^One riding day more \(4\); /);
    // A night kept at another stop moves that day's end, and the next day's start.
    const base = plan({ inputs: inputs(), choices: NO_CHOICES });
    const moved = plan({ inputs: inputs(), choices: { ...NO_CHOICES, locked: { 0: "s40" } } });
    const m = planChanges(base, moved);
    expect(m.lines.some((l) => l.startsWith("Day 1 now ends at Town 40, 40 km"))).toBe(true);
    expect(m.days).toContain(1);
  });
});

describe("plan document and share links", () => {
  it("round-trips a plan through its link, and the nights stay put", () => {
    const d = data();
    const p = makePlan(d, inputs());
    const doc = toDocument(p, { name: "Lagoons → Arles" });
    const frag = shareFragment(doc);
    expect(frag.startsWith("p=")).toBe(true);
    const read = readFragment(`#${frag}`);
    expect(read && "plan" in read).toBe(true);
    const back = (read as { plan: typeof doc }).plan;
    expect(back.name).toBe("Lagoons → Arles");
    const again = makePlan(d, back.inputs, choicesOf(back));
    expect(again.nights.map((n) => n.stop.id)).toEqual(p.nights.map((n) => n.stop.id));
    expect(frag.length).toBeLessThan(2500); // small enough for a QR code
  });

  it("shares an itinerary with dates and stops only", () => {
    const p = makePlan(data(), inputs());
    const read = readFragment(shareFragment(itineraryOf(p)));
    expect(read && "itinerary" in read && read.itinerary.days).toHaveLength(5);
    expect(JSON.stringify(read)).not.toContain("level");
  });

  it("rejects damaged links and foreign documents", () => {
    expect(readFragment("#p=!!!")).toBeNull();
    expect(readFragment("#p=e30")).toEqual({ error: "not a Kilometrica plan" }); // "{}"
    expect(parseDocument({ kind: "kilometrica-plan", version: 9 })).toMatch(/version/);
    expect(fromUtf8(utf8("Étang → Aigues-Mortes 🚲"))).toBe("Étang → Aigues-Mortes 🚲");
  });
});

describe("links", () => {
  const h = (over: Partial<Highlight> = {}): Highlight => ({
    id: "osm:n1",
    kind: "castle",
    name: "Château de Bielle",
    lon: 0,
    lat: 0,
    at_m: 0,
    offset_m: 0,
    ele: null,
    wikidata: "Q1",
    wikipedia: "fr:Château de Bielle",
    articles: { fr: "Château de Bielle", en: "Bielle Castle", eu: "Bielleko gaztelua" },
    commons: "Category:Château de Bielle",
    unesco: false,
    rank: 0.5,
    ...over,
  });

  it("links Wikipedia in the rider's language, else English, else the local article, and adds photos", () => {
    const [wiki, photos] = wikiLinks(h(), ["de-DE", "en"]);
    expect(wiki).toEqual({ kind: "wiki", label: "Wikipedia (in English)", url: "https://en.wikipedia.org/wiki/Bielle_Castle" });
    expect(photos?.url).toBe("https://commons.wikimedia.org/wiki/Category:Ch%C3%A2teau_de_Bielle");
    expect(wikiLinks(h(), ["eu"])[0]?.label).toBe("Wikipedia");
    const french = wikiLinks(h({ articles: { fr: "Château de Bielle", eu: "Bielleko gaztelua" } }), ["en-GB"]);
    expect(french[0]?.label).toBe("Wikipedia (in French)");
    expect(french[0]?.url).toContain("fr.wikipedia.org");
  });

  it("never links a bare Wikidata page", () => {
    expect(wikiLinks(h({ wikipedia: null, articles: {}, commons: null }), ["en"])).toEqual([]);
  });

  it("searches Google Maps by kind, name and town, else by coordinates", () => {
    const q = (url: string) => decodeURIComponent(url.split("query=")[1]!);
    expect(q(mapsSearch({ name: "La Corniche", kind: "campsite", lat: 43.37, lon: -1.73 }, "Hendaye"))).toBe("Camping La Corniche, Hendaye");
    expect(q(mapsSearch({ name: "Hôtel Lafon", kind: "hotel", lat: 43.37, lon: -1.77 }, "Hendaye"))).toBe("Hôtel Lafon, Hendaye");
    expect(q(mapsSearch({ name: "Camping Hendaye Plage", kind: "campsite", lat: 1, lon: 2 }, "Hendaye"))).toBe("Camping Hendaye Plage");
    expect(q(mapsSearch({ name: "Hotel Eaux Bonnes Gourette", kind: "hotel", lat: 1, lon: 2 }, "Eaux-Bonnes"))).toBe("Hotel Eaux Bonnes Gourette");
    expect(q(mapsSearch({ name: null, kind: "hotel", lat: 43.371181, lon: -1.781962 }, "Hendaye"))).toBe("43.371181,-1.781962");
    expect(q(mapsSearch({ name: "La Corniche", kind: "campsite", lat: 43.37, lon: -1.73 }, null))).toBe("43.370000,-1.730000");
    // The place's own town (named by the audit) wins over a stop's.
    expect(q(mapsSearch({ name: "chic&basic Born", kind: "hotel", lat: 41.38, lon: 2.18, detail: { town: "Barcelona" } }))).toBe(
      "Hotel chic&basic Born, Barcelona",
    );
  });
});

describe("exports", () => {
  const d = data({ gapAtKm: 155 });
  const geo: Geometry = {
    lines: [
      { coords: Array.from({ length: 156 }, (_, i) => [i * 1000 * DEG_PER_M, LAT] as [number, number]), m: Array.from({ length: 156 }, (_, i) => i * 1000) },
      { coords: Array.from({ length: 146 }, (_, i) => [(155 + 20 + i) * 1000 * DEG_PER_M, LAT] as [number, number]), m: Array.from({ length: 146 }, (_, i) => 155_000 + i * 1000) },
    ],
    gaps: [{ atM: 155_000, type: "missing", km: 20, start: [155_000 * DEG_PER_M, LAT], end: [175_000 * DEG_PER_M, LAT] }],
  };
  it("writes a starter GPX per day with the gap marked at both ends (D47)", () => {
    const p = makePlan(d, inputs());
    const withGap = p.days.find((x) => x.gaps.length)!;
    const gpx = dayGpx(p, geo, withGap);
    expect(gpx).toContain("<trkpt");
    expect(gpx).toContain("Gap start: 20 km");
    expect(gpx).toContain("Gap end");
    expect((gpx.match(/<trkseg>/g) ?? []).length).toBe(2);
    expect(tripGpx(p, geo)).toContain(`<name>Day ${p.days.length}:`);
  });

  it("links street-level photos where a heads-up about the way begins, facing the way the rider rides (D58)", () => {
    const street = (p: ReturnType<typeof makePlan>, prefix: string) =>
      p.items.find((i) => i.id.startsWith(prefix))!.handoffs.filter((h) => h.kind === "street");
    const fwd = makePlan(d, inputs(), NO_CHOICES, { geometry: geo });
    // The test route runs east through France, so Panoramax is offered too.
    expect(street(fwd, "gap:").map((h) => h.label)).toEqual(["Street View", "Mapillary", "Panoramax"]);
    expect(street(fwd, "gap:")[0]!.url).toContain("&heading=90");
    const rev = makePlan(d, inputs({ fromM: 300_000, toM: 0, direction: "reverse" }), NO_CHOICES, { geometry: geo });
    expect(street(rev, "gap:")[0]!.url).toContain("&heading=270");
    // Mapillary and Panoramax carry the point and heading to find their nearest photo by, on tap.
    expect(street(fwd, "gap:")[1]!.photoAt).toMatchObject({ service: "mapillary", lat: LAT });
    expect(street(fwd, "gap:")[1]!.photoAt!.heading).toBeCloseTo(90, 0);
    expect(street(fwd, "gap:")[2]!.photoAt?.service).toBe("panoramax");
    // None without the geometry, and none on items that aren't about the way.
    const has = (p: ReturnType<typeof makePlan>, f: (id: string) => boolean) =>
      p.items.filter((i) => f(i.id)).some((i) => i.handoffs.some((h) => h.kind === "street"));
    expect(has(makePlan(d, inputs()), () => true)).toBe(false);
    expect(has(fwd, (id) => id.startsWith("bed:") || id.startsWith("effort:") || id.startsWith("sunset:"))).toBe(false);
  });

  it("offers Panoramax in France only, and reads bearings clockwise from north", () => {
    expect(streetPhotos(geo, 10_000, "forward", "ES").map((h) => h.label)).toEqual(["Street View", "Mapillary"]);
    expect(streetPhotos(geo, 10_000, "forward", "ES")[1]!.url).toBe(`https://www.mapillary.com/app/?lat=${LAT.toFixed(6)}&lng=${(10_000 * DEG_PER_M).toFixed(6)}&z=17`);
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(bearing([0, 0], [0, 0])).toBeNull();
  });

  it("searches the big booking sites for each night, two nights before a rest day, never for campers (D60)", () => {
    const p = makePlan(d, inputs({ restAfter: [2], sleep: "mix" }));
    const [n1, n2] = p.nights as [NightPlan, NightPlan];
    const [booking, expedia] = bookingSearches(n1, p.inputs);
    const next = addDays(n1.date, 1);
    expect(booking!.url).toBe(`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${n1.stop.name}, France`)}&checkin=${n1.date}&checkout=${next}`);
    expect(expedia!.url).toBe(`https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(`${n1.stop.name}, France`)}&startDate=${n1.date}&endDate=${next}`);
    expect(nightStay(n2, p.inputs.restAfter).checkOut).toBe(addDays(n2.date, 2));
    expect(bookingSearches(n1, { ...p.inputs, sleep: "camping" })).toEqual([]);
    // A stop with no town name: by its position, nearest first.
    const unnamed = bookingSearches({ ...n1, stop: { ...n1.stop, name: null } }, p.inputs);
    expect(unnamed[0]!.url).toContain(`latitude=${LAT.toFixed(5)}&`);
    expect(unnamed[0]!.url).toContain("dest_type=latlong&order=distance_from_search");
    expect(unnamed[1]!.url).toContain("sort=DISTANCE");
    expect(stayDates("2027-05-14", "2027-05-15")).toBe("14–15 May");
    expect(stayDates("2027-05-31", "2027-06-02")).toBe("31 May – 2 June");
  });

  it("says once per night what we know of its places' opening (D61)", () => {
    const b = (count: number, open: number, partly = 0) => ({ count, open, partly });
    expect(bedsKnown(b(19, 0), "September")).toBe("19 places of your kind; we don't know which are open in September: check before you book");
    expect(bedsKnown(b(19, 3, 1), "September")).toBe("19 places of your kind, 4 known open in September: check the others before you book");
    expect(bedsKnown(b(2, 2), "May", "places to stay")).toBe("2 places to stay of your kind, all known open in May");
    expect(bedsKnown(b(1, 1), "May")).toBe("1 place of your kind, known open in May");
    expect(bedsKnown(b(0, 0), "May")).toBe("no known place of your kind");
  });

  it("writes one calendar event per day", () => {
    const p = makePlan(d, inputs({ restAfter: [2] }));
    const ics = calendarFile(p, "abc", new Date("2027-01-01T00:00:00Z"));
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(6);
    expect(ics).toContain("DTSTART;VALUE=DATE:20271013");
    expect(ics).toContain("rest day");
    const bytes = (l: string) => [...l].reduce((a, ch) => a + (ch.codePointAt(0)! < 0x80 ? 1 : ch.codePointAt(0)! < 0x800 ? 2 : 3), 0);
    expect(ics.split("\r\n").every((l) => bytes(l) <= 75)).toBe(true);
  });
});
