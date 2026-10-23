/**
 * A small made-up route for the tools' unit tests: 300 km in six daily sections from Alpha to Golf, a stop every 10 km
 * ("Town 10" … "Town 290", with Saint-Jean at 120 km), the usual weather, and with the Trip Pass a few places to stay.
 */
import type { DailySection, DreamFile, DreamSection, Place, Stop } from "@dpg/contracts";
import type { DreamRoute } from "@dpg/dream";
import { makePlan, NO_CHOICES, type PlanData, type PlanInputs, type PlanResult, type PlanState } from "@dpg/planner";

const LAT = 43.5;
const DEG_PER_M = 1 / 80_700;
const twelve = <T>(v: T) => Array.from({ length: 12 }, () => v);
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];

const LEVELS = [
  { level: 1, name: "Leisurely", km_min: 20, km_max: 40, climb_max_m: 300 },
  { level: 2, name: "Easy-moderate", km_min: 40, km_max: 60, climb_max_m: 500 },
  { level: 3, name: "Moderate", km_min: 50, km_max: 80, climb_max_m: 850 },
  { level: 4, name: "Challenging", km_min: 70, km_max: 100, climb_max_m: 1200 },
  { level: 5, name: "Tough", km_min: 90, km_max: 130, climb_max_m: 1500 },
];

function section(n: number): DreamSection {
  return {
    number: n,
    from_m: (n - 1) * 50_000,
    to_m: n * 50_000,
    length_m: 50_000,
    country: "FR",
    ascent_fwd_m: 300,
    ascent_rev_m: 300,
    ascent_known_fwd_m: null,
    ascent_known_rev_m: null,
    climb_unknown_m: 0,
    max_grade_500m: 4,
    grade_fwd: 2,
    grade_rev: 2,
    surfaces: { road: 0.5, cycle_path: 0.5, gravel: 0, unknown: 0 },
    busy_share: 0,
    themes: { coast: { score: n <= 3 ? 0.9 : 0.1, note: "" } },
    remote_share: 0,
    longest_remote_m: 0,
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
    daylight_h: twelve(12),
    crowding: { country: "FR", school_days: twelve(0), school_year: 2027, public_holidays: twelve(0), public_year: 2027, tourism_index: twelve(1), tourism_years: "x" },
    campsites: { counted: 1, published: 0, open: twelve(0), partly: twelve(0) },
    accommodation: { campsite: 1, hotel: 2 },
    services: {},
    longest_gap_m: {},
    station_start: `Gare ${NAMES[n - 1]}`,
    station_end: `Gare ${NAMES[n]}`,
    findings: { rider: n === 2 ? 1 : 0 },
    comfort: twelve(60),
    best_time: Array.from({ length: 12 }, (_, m) => (m === 9 ? 80 : 50)),
    partial: twelve([]),
    direction: twelve({ advice: "either", wind_along_ms: 0, climb_diff_m: 0 }),
    check: [],
  } as unknown as DreamSection;
}

function daily(n: number): DailySection {
  return {
    id: `d${n}`,
    number: n,
    title: `${NAMES[n - 1]} – ${NAMES[n]}`,
    start_name: NAMES[n - 1]!,
    end_name: NAMES[n]!,
    from_m: (n - 1) * 50_000,
    to_m: n * 50_000,
    length_m: 50_000,
    status: { development: "developed", signage: "signed", label: "" },
    reversed_in_source: false,
    point_count: 2,
    start: [0, LAT],
    end: [0, LAT],
  } as unknown as DailySection;
}

function stop(km: number): Stop {
  return {
    id: `s${km}`,
    name: km === 120 ? "Saint-Jean" : `Town ${km}`,
    near: null,
    place_kind: km % 60 === 0 ? "town" : "village",
    at_m: km * 1000,
    lon: km * 1000 * DEG_PER_M,
    lat: LAT,
    country: "FR",
    time_zone: null,
    detour_m: 200,
    beds: [
      { kind: "hotel", count: 2, seasons: [["????????????", 2]] },
      { kind: "campsite", count: 1, seasons: [["oooooooooooo", 1]] },
    ],
    services: { food: 2, water: 1 },
    station: km % 50 === 0 ? `Gare ${km}` : null,
    station_at_m: km % 50 === 0 ? km * 1000 : null,
  } as Stop;
}

/** A place to stay at every stop (a hotel and a campsite open all year), and water at km 25 and 35. */
function places(): Place[] {
  const water = [25, 35].map((km) => ({ id: `w${km}`, name: null, kind: "drinking_water", service: "water", counts: true, access_at_m: km * 1000, access_m: 20, lat: LAT, lon: km * 1000 * DEG_PER_M, months: "aaaaaaaaaaaa", detail: {} }));
  return [...water, ...Array.from({ length: 29 }, (_, i) => (i + 1) * 10).flatMap((km) => [
    { id: `h${km}`, name: `Hôtel du ${km}`, kind: "hotel", service: "accommodation", counts: true, access_at_m: km * 1000, access_m: 100, lat: LAT, lon: km * 1000 * DEG_PER_M, months: "????????????", detail: { website: "example.org" } },
    { id: `c${km}`, name: `Camping ${km}`, kind: "campsite", service: "accommodation", counts: true, access_at_m: km * 1000 + 50, access_m: 300, lat: LAT, lon: km * 1000 * DEG_PER_M, months: "oooooooooooo", detail: { phone: "+33 1 23 45 67 89" } },
  ])] as unknown as Place[];
}

const dreamFile = (): DreamFile =>
  ({ profile: "dream-v0", season_year: 2027, climate_source: "test", levels: LEVELS, themes: [{ id: "coast", title: "Coast & beaches", measures: "" }], sections: Array.from({ length: 6 }, (_, i) => section(i + 1)), breaks: [] }) as unknown as DreamFile;

export function testRoute(): DreamRoute {
  return { id: "test/t1", name: "Test route", dream: dreamFile(), daily: Array.from({ length: 6 }, (_, i) => daily(i + 1)), userPlaces: [], own: false };
}

export function testData(full = true): PlanData {
  const L = 300_000;
  const n = L / 100;
  return {
    route: { network: "test", ref: "t1", runId: "20270101T000000Z_0000000000", name: "Test route" },
    dream: dreamFile(),
    stops: { season_year: 2027, reach_m: 2500, stops: Array.from({ length: 29 }, (_, i) => stop((i + 1) * 10)) },
    effort: { step_m: 100, parts: [{ from_m: 0, to_m: L, ele: Array.from({ length: n + 1 }, () => 100), surface: "c".repeat(n) }], gaps: [] },
    calendar: { season_year: 2027, countries: [{ country: "FR", public_year: 2027, public: [], school_year: 2027, school: [] }] },
    daily: Array.from({ length: 6 }, (_, i) => daily(i + 1)),
    userPlaces: [],
    full: full ? { findings: [], places: places(), placesMissing: [], highlights: [], climbs: [], serviceTypes: [] } : null,
  } as unknown as PlanData;
}

export const testInputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
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

/** A plan context as the screen holds one: its state, and its planner with a cache. */
export function testPlan(over: Partial<PlanInputs> = {}, full = true) {
  const data = testData(full);
  const cache = new WeakMap<PlanState, PlanResult>();
  const planFor = (s: PlanState) => {
    let p = cache.get(s);
    if (!p) cache.set(s, (p = makePlan(data, s.inputs, s.choices)));
    return p;
  };
  return { data, state: { inputs: testInputs(over), choices: NO_CHOICES } as PlanState, planFor };
}
