import type {
  CalendarFile,
  Climb,
  DailySection,
  DreamFile,
  EffortFile,
  Finding,
  Highlight,
  Place,
  ServiceType,
  Stop,
  StopsFile,
  UserPlace,
} from "@dpg/contracts";

export type Direction = "forward" | "reverse";
export type Bike = "road" | "touring" | "gravel" | "ebike" | "bikepacking";
export type Sleep = "camping" | "rooms" | "mix";
export type StopStyle = "short" | "normal" | "long";

/** What the rider tells Plan (11.6). Dream suggests the stretch, time frame, days and level (D48). */
export interface PlanInputs {
  /** Route measures of the stretch's ends (from < to); `direction` says which way it is ridden. */
  fromM: number;
  toM: number;
  direction: Direction;
  /** The first riding day, YYYY-MM-DD. */
  startDate: string;
  /** Riding days; rest days come on top. */
  days: number;
  /** D36 level 1-5. */
  level: number;
  bike: Bike;
  sleep: Sleep;
  /** Leaving time each morning, minutes after local midnight. */
  startMinutes: number;
  stopStyle: StopStyle;
  /** The rider's own rest days (D74): one follows each of these riding days (1-based), a second night at that stop. */
  restAfter: number[];
  /**
   * How many rest days in all (D74): the rider's own and the planner's, placed where they help. The trip lasts
   * `days` riding days plus these; unset means the rider's own only.
   */
  restDays?: number;
  /** From Dream: avoid gravel, avoid busy roads. */
  avoidGravel: boolean;
  avoidBusy: boolean;
  /** Show each day's stations for taking a train home, and the long stretches without one (D75). Off by default. */
  bailouts?: boolean;
  /**
   * Whose nights (D70): "own" takes the nights the rider's route file marks, and the days follow from them; "ours"
   * plans the stops. Unset means the file's when it marks any.
   */
  stops?: "own" | "ours";
}

export interface RouteRef {
  network: string;
  ref: string;
  runId: string;
  name: string;
}

/** The free bundle files (D45): enough to plan days and real stops, never naming a bed, water point or finding. */
export interface FreeData {
  route: RouteRef;
  dream: DreamFile;
  stops: StopsFile;
  effort: EffortFile;
  calendar: CalendarFile | null;
  daily: DailySection[];
  /** Waypoints from the rider's own file (D24), for the nights it marks (D70). */
  userPlaces?: UserPlace[];
}

/** Route metres from fromM to toM. */
export interface MRange {
  fromM: number;
  toM: number;
}

/** What the Trip Pass adds: the places, findings, highlights and climbs on the stretch. */
export interface FullData {
  findings: Finding[];
  /** Places on the stretch (any service), from the filtered places endpoint. */
  places: Place[];
  /**
   * Parts of the stretch whose places didn't load. Nothing there is "none": the plan says nothing about water, food
   * or beds there (D37). Empty when everything loaded.
   */
  placesMissing: MRange[];
  highlights: Highlight[];
  climbs: Climb[];
  serviceTypes: ServiceType[];
}

/** The parts of [lo, hi] whose places didn't load, clipped to it. */
export function placesMissing(full: FullData, lo: number, hi: number): MRange[] {
  return full.placesMissing
    .filter((r) => r.toM > lo && r.fromM < hi)
    .map((r) => ({ fromM: Math.max(r.fromM, lo), toM: Math.min(r.toM, hi) }));
}

export interface PlanData extends FreeData {
  /** Null in the teaser. */
  full: FullData | null;
}

/** The rider's own choices kept with a plan: stops, locks, beds and the state of its items. */
export interface PlanChoices {
  /** Stop id per night (night i follows riding day i + 1); when given, the plan keeps these nights. */
  nights?: string[];
  /** Nights the rider fixed (booked or chosen): night index -> stop id. */
  locked: Record<number, string>;
  /** Chosen bed per night: night index -> place id. */
  beds: Record<number, string>;
  booked: number[];
  /** The date each booked night was booked for (D74): a booking whose night moves goes back on the to-do. */
  bookedOn?: Record<number, string>;
  done: string[];
  dismissed: string[];
}

export const NO_CHOICES: PlanChoices = { locked: {}, beds: {}, booked: [], done: [], dismissed: [] };

export type Effort = "within" | "harder" | "beyond";

export interface DayPlan {
  /** 1-based calendar day (rest days included). */
  number: number;
  /** 1-based riding day; null on a rest day. */
  ride: number | null;
  date: string;
  kind: "ride" | "rest";
  /** Trip positions (ridden metres from the start, counting unfilled gaps). */
  fromT: number;
  toT: number;
  /** Route measures in the direction of travel. */
  fromM: number;
  toM: number;
  startName: string;
  /** The night's stop; null on the last day. */
  stop: Stop | null;
  endName: string;
  km: number;
  climbM: number;
  /** Km whose terrain is unknown (placeholders, unfilled gaps): climbing and time are then minimums. */
  unknownKm: number;
  /** Riding hours: planned on the slow end (D37). Equal when nothing is unknown. */
  hoursFast: number;
  hoursSlow: number;
  /** Stops and lunch, minutes. */
  stopsMin: number;
  startMinutes: number;
  endMinutes: number;
  sunrise: number | null;
  sunset: number | null;
  clockApprox: boolean;
  effort: Effort;
  /** Shares of road, cycle path, gravel, unknown (D36). */
  surfaces: { r: number; c: number; g: number; u: number };
  /** Gaps crossed: ferries and published links (not ridden) and unfilled gaps (counted as ridden). */
  gaps: { type: string; km: number; atM: number }[];
  tailwindMs: number | null;
  /** The steepest stretch of `lengthKm` (2 km at levels 1-3, 5 km at 4-5, D75) on known terrain, in the direction of
   * travel: grade (%) and km of the day. */
  steepest: { grade: number; atKm: number; lengthKm: number } | null;
  /** Dream sections the day touches. */
  sections: number[];
  /** A rest day's reason, and whether the rider placed it (D74). */
  rest?: { why: string; own: boolean };
}

/** `note`: something to be aware of on the trip that needs no action, shown once in the brief's note (D75). */
export type ItemKind = "call" | "todo" | "headsup" | "highlight" | "note";

export interface Handoff {
  kind: "website" | "phone" | "maps" | "rail" | "wiki" | "photos" | "ferry" | "street" | "booking";
  label: string;
  url: string;
  /**
   * Street-level photos that open on a photo only by its id (D58): the route point to find the nearest one from, when
   * the rider taps, and the way the rider faces there. `url` is their map at that point, for when there's none.
   */
  photoAt?: { service: "mapillary" | "panoramax"; lon: number; lat: number; heading: number | null };
}

export interface CallOption {
  id: string;
  label: string;
  /** What choosing it changes, in a few words. */
  effect: string;
}

/** A plan item (11.6): facts turned into something for this rider, with the evidence behind it (D38). */
export interface PlanItem {
  id: string;
  kind: ItemKind;
  /** Calendar day number, or null for the whole trip. */
  day: number | null;
  /** Route measure range, when it has one. */
  fromM: number | null;
  toM: number | null;
  title: string;
  /** Why it matters to this rider. */
  why: string;
  /** A name short enough for a bike computer's screen (GPX waypoints). */
  short?: string;
  /** Higher first: 50+ safety, 40+ a bed or water, 30+ effort, 20+ comfort, 10+ interest. */
  rank: number;
  /** Which of the brief's five questions it answers. */
  topic: "able" | "sleep" | "risk" | "prepare" | "like";
  evidence: { findings?: string[]; places?: string[]; highlights?: string[]; source?: string; date?: string };
  handoffs: Handoff[];
  options?: CallOption[];
  /**
   * A night's line in the to-do (D64): what settles it on the day card, "Chosen: La Gloriette" or "Booked"; absent
   * while the night is still to sort. Other to-dos are settled by the rider's tick, calls by an answer.
   */
  settled?: string;
}

export interface NightPlan {
  index: number;
  date: string;
  /** Riding day (1-based) this night follows. */
  afterRide: number;
  stop: Stop;
  locked: boolean;
  /** Places to stay of the rider's kind that night (D18): `count` leaves out the ones known closed. */
  beds: { count: number; open: number; partly: number; closed: number; unknown: number; unmanaged: number; kinds: { kind: string; count: number }[] };
  /** Other stops worth considering, best first. */
  alternatives: { stop: Stop; dayKm: number; nextKm: number | null }[];
  planB: { before: { stop: Stop; km: number } | null; after: { stop: Stop; km: number } | null };
  /** Why the planner stops here: "Stopping at Apt: 1 campsite and 2 hotels nearby, …; food; makes a 73 km day." */
  why: string;
  /** The same without the beds, for where they're said just above it (the day card, D62): "Stopping at Apt: food; …". */
  whyOther: string;
  /** A night the rider's file marks (D70), with the name it gives it. */
  own: { name: string | null } | null;
  /**
   * For a rider who camps, where no known campsite is in reach (D69, D70): wild camp if it's feasible and allowed,
   * push on to the next one, or change the plan.
   */
  wildCamp: string | null;
}

export interface BriefLine {
  topic: "able" | "sleep" | "risk" | "prepare" | "like";
  question: string;
  answer: string;
  more: number;
  /** The items behind "+N more", in the order to list them. */
  moreIds: string[];
}

export interface Brief {
  title: string;
  dates: string;
  km: number;
  climbM: number;
  direction: Direction;
  effort: { day: number; hours: number; usual: number; effort: Effort; rest: boolean }[];
  lines: BriefLine[];
  readiness: string;
  confidence: string[];
}
