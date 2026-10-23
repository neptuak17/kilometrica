/**
 * Dream's question and its wording (11.7, D48): the rider's answers, kept in the address so a search can be shared
 * or reopened, and the lines a stretch is described with. Level and days start unset: nothing is assumed.
 */
import type { DailySection, DreamFile, DreamSection } from "@dpg/contracts";
import type { DreamQuery, Pref, StretchResult, SurfaceKind } from "./matchmaker";
import { km, MONTHS_LONG } from "@dpg/planner";

export type Level = DreamFile["levels"][number];

/** How the rider likes to travel (D74): it sets how many of their days are rest days. */
export type Pace = "relaxed" | "steady" | "moving";
export const PACE: Record<Pace, string> = { relaxed: "Relaxed", steady: "Steady", moving: "Keep moving" };

/** Rest days for so many riding days (D74): about one per 4 riding days relaxed, one per 6 steady, none moving. */
export const restFor = (riding: number, pace: Pace) =>
  pace === "moving" ? 0 : pace === "relaxed" ? (riding >= 4 ? Math.floor(riding / 4) : 0) : riding >= 7 ? Math.floor(riding / 6) : 0;

/** The riding days in so many days in all (D74): the days left over are rest days, so the total always holds. */
export function ridingDays(total: number, pace: Pace): number {
  let r = total;
  while (r > 1 && r + restFor(r, pace) > total) r--;
  return r;
}

/** The rider's answers. Level and days start unset: no stretch is shown until the rider gives them. `days` is the
 * whole trip, rest days included (D74). */
export interface Ask extends Omit<DreamQuery, "level" | "days" | "limit"> {
  level: number | null;
  days: number | null;
  pace: Pace;
}

/** A stretch's rest days: the rider's days in all less its riding days, or by pace for a stretch of its own length. */
export const restIn = (r: { days: number }, a: Ask) =>
  a.days !== null && r.days === ridingDays(a.days, a.pace) ? a.days - r.days : restFor(r.days, a.pace);

/** "14 days: 12 riding, 2 rest", or "7 days" with none. */
export function daysText(r: { days: number }, a: Ask): string {
  const rest = restIn(r, a);
  return rest ? `${r.days + rest} days: ${r.days} riding, ${rest} rest` : `${r.days} days`;
}

export const EMPTY: Ask = {
  level: null,
  days: null,
  pace: "steady",
  month: null,
  surfaces: { road: "ok", cycle_path: "ok", gravel: "ok" },
  themes: [],
  trainBothEnds: false,
  stay: "any",
  avoidBusy: false,
  direction: "either",
};

/** Starting points: a whole question in one tap, changed from there. */
export const EXAMPLES: { title: string; sub: string; q: Partial<Ask> }[] = [
  {
    title: "A week of coast and villages",
    sub: "Easy-moderate, rooms, quiet roads, a train at both ends",
    q: { level: 2, days: 7, themes: ["coast", "heritage"], trainBothEnds: true, stay: "rooms", avoidBusy: true, surfaces: { road: "ok", cycle_path: "prefer", gravel: "ok" } },
  },
  { title: "A long weekend by the sea", sub: "Easy-moderate, three days, a train at both ends", q: { level: 2, days: 3, themes: ["coast"], trainBothEnds: true } },
  { title: "A week along the river", sub: "Easy, rooms, cycle paths", q: { level: 1, days: 7, themes: ["water"], stay: "rooms", surfaces: { road: "ok", cycle_path: "prefer", gravel: "ok" } } },
  { title: "Ten days of wine and towns", sub: "Moderate, rooms", q: { level: 3, days: 10, themes: ["wine", "culture"], stay: "rooms" } },
  { title: "Two weeks in the hills", sub: "Challenging, mountains and viewpoints", q: { level: 4, days: 14, themes: ["mountains", "viewpoints"] } },
];

/** A route has a theme when this much of it is strong in it (a section scores 0.5 or more): a few days' worth. */
const THEME_ENOUGH_M = 150_000;

/** The examples whose scenery the route has: no seaside weekend on the Rhine. */
export function examplesFor(sections: { length_m: number; themes: Record<string, { score: number | null } | undefined> }[]) {
  const strong = (id: string) => sections.reduce((a, s) => a + ((s.themes[id]?.score ?? 0) >= 0.5 ? s.length_m : 0), 0);
  return EXAMPLES.filter((e) => (e.q.themes ?? []).every((id) => strong(id) >= THEME_ENOUGH_M));
}

export const SURFACES: { key: SurfaceKind; label: string; url: string }[] = [
  { key: "cycle_path", label: "cycle paths", url: "paths" },
  { key: "road", label: "roads", url: "road" },
  { key: "gravel", label: "gravel", url: "gravel" },
];
export const PREFS: Pref[] = ["prefer", "ok", "avoid"];
export const STAY = { any: "Rooms or camping", rooms: "Rooms", camping: "Camping" } as const;
export const WAY = { either: "Either way", forward: "With the route", reverse: "Against the route" } as const;

// --- the question in the address ---------------------------------------------------------------------------

export function readAsk(p: URLSearchParams): Ask {
  const int = (k: string, lo: number, hi: number) => {
    const raw = p.get(k);
    const v = Number(raw);
    return raw !== null && raw !== "" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  };
  const pref = (k: string): Pref => (PREFS.includes(p.get(k) as Pref) ? (p.get(k) as Pref) : "ok");
  const stay = p.get("stay");
  const way = p.get("way");
  return {
    level: int("level", 1, 5),
    days: int("days", 1, 60),
    pace: p.get("pace") === "relaxed" || p.get("pace") === "moving" ? (p.get("pace") as Pace) : "steady",
    month: int("month", 0, 11),
    surfaces: { road: pref("road"), cycle_path: pref("paths"), gravel: pref("gravel") },
    themes: (p.get("themes") ?? "").split(",").filter(Boolean),
    trainBothEnds: p.get("train") === "1",
    stay: stay === "rooms" || stay === "camping" ? stay : "any",
    avoidBusy: p.get("busy") === "1",
    direction: way === "forward" || way === "reverse" ? way : "either",
  };
}

export function addressOf(route: string, a: Ask): string {
  const p = new URLSearchParams({ route });
  if (a.level !== null) p.set("level", String(a.level));
  if (a.days !== null) p.set("days", String(a.days));
  if (a.pace !== "steady") p.set("pace", a.pace);
  if (a.month !== null) p.set("month", String(a.month));
  for (const s of SURFACES) if (a.surfaces[s.key] !== "ok") p.set(s.url, a.surfaces[s.key]);
  if (a.themes.length) p.set("themes", a.themes.join(","));
  if (a.trainBothEnds) p.set("train", "1");
  if (a.stay !== "any") p.set("stay", a.stay);
  if (a.avoidBusy) p.set("busy", "1");
  if (a.direction !== "either") p.set("way", a.direction);
  return `/dream?${p}`;
}

// --- wording ------------------------------------------------------------------------------------------------

export const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function surfacesText(a: Ask): string {
  const of = (p: Pref) => SURFACES.filter((s) => a.surfaces[s.key] === p).map((s) => s.label);
  const parts = [of("prefer").length ? `Prefer ${and(of("prefer"))}` : "", of("avoid").length ? `avoid ${and(of("avoid"))}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "Any surface";
}

/** A point between daily sections: a town, else its km. */
export interface Point {
  name: string;
  m: number;
}

export function pointsOf(sections: DreamSection[], daily: Map<number, DailySection>): Point[] {
  const name = (n: string | null | undefined, m: number) => n ?? `km ${Math.round(m / 1000)}`;
  const out = sections.map((s) => ({ name: name(daily.get(s.number)?.start_name, s.from_m), m: s.from_m }));
  const last = sections[sections.length - 1];
  if (last) out.push({ name: name(daily.get(last.number)?.end_name, last.to_m), m: last.to_m });
  return out;
}

export function stretchName(daily: Map<number, DailySection>, r: StretchResult): string {
  const a = daily.get(r.first);
  const b = daily.get(r.last);
  const start = r.way === "forward" ? { name: a?.start_name, m: a?.from_m } : { name: b?.end_name, m: b?.to_m };
  const end = r.way === "forward" ? { name: b?.end_name, m: b?.to_m } : { name: a?.start_name, m: a?.from_m };
  const label = (e: { name?: string | null; m?: number }) => e.name ?? (e.m === undefined ? "?" : `km ${Math.round(e.m / 1000)}`);
  return `${label(start)} → ${label(end)}`;
}

export const keyOf = (r: StretchResult) => `${r.first}-${r.last}-${r.way}`;

/** The matchmaker's why lines, less the two the card already shows as facts: the grade and the month's scores. */
export const whyLines = (r: StretchResult) => r.why.filter((w) => !/: grade (at least )?\d/.test(w) && !/best-time \d+$/.test(w));

export const climbText = (r: StretchResult) =>
  r.climbPerDay !== null ? `↑ ${r.climbPerDay} m a day` : r.climbMinPerDay !== null ? `↑ at least ${r.climbMinPerDay} m a day` : "climbing unknown";

export const gradeText = (r: StretchResult, levels: Level[]) => `${r.gradeAtLeast ? "at least " : ""}${levels.find((l) => l.level === r.grade)?.name ?? `level ${r.grade}`}`;

export const factsText = (r: StretchResult, levels: Level[], a: Ask) =>
  `${daysText(r, a)} · ${km(r.km)} km · ${r.kmPerDay} km a day${r.easier ? ", easier than your usual" : ""} · ${climbText(r)} · ${gradeText(r, levels)}`;

export function whenText(r: StretchResult, a: Ask): string | undefined {
  if (r.month === null) return undefined;
  const score = r.bestTime === null ? "" : `: best-time ${r.bestTime} of 100`;
  return a.month === null ? `Best in ${MONTHS_LONG[r.month]}${score}` : `In ${MONTHS_LONG[r.month]}${score}`;
}

/** Plan opens the stretch with the rider's answers (D48): the days in all and the rest days among them (D74). */
export function planHref(route: string, r: StretchResult, a: Ask, level: number): string {
  const rest = restIn(r, a);
  return `/plan?${new URLSearchParams({
    route,
    first: String(r.first),
    last: String(r.last),
    way: r.way,
    days: String(r.days + rest),
    rest: String(rest),
    month: String(a.month ?? r.month ?? ""),
    level: String(level),
    gravel: a.surfaces.gravel,
    busy: a.avoidBusy ? "1" : "0",
    stay: a.stay,
  })}`;
}

/** "7,347" */
export const whole = (k: number) => Math.round(k).toLocaleString("en-GB");
