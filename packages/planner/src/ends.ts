/**
 * Where a trip starts and ends (D104): the towns a rider can start or end in, a trip between two of them, and the
 * towns nearby with a station, for a rider coming and going by train when their start or end has none.
 */
import type { Stop } from "@dpg/contracts";
import type { FreeData, PlanInputs } from "./types";

/** A station counts for getting to the start and home from the end within this many metres (as the to-do says). */
export const STATION_NEAR_M = 10_000;
/** A town to start or end in instead is offered within this many metres along the route. */
export const OTHER_END_M = 30_000;
/** A stop is the same town as a stage town this close to it, by either of its names. */
const SAME_TOWN_M = 5_000;

export interface PlanTown {
  /** A stop's id, or "stage:<m>" for a town where stages meet. */
  id: string;
  name: string;
  /** Its other name, where it has one: the English (OSM name:en), or the stop's own beside a stage's. */
  alt: string | null;
  /** Its route measure: where its stop leaves the route, or where the stages meet. */
  m: number;
  /** A bike-carrying station within STATION_NEAR_M. */
  station: string | null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The bike-carrying station nearest a route measure, within STATION_NEAR_M, as the to-do finds it. */
export function stationNear(stops: Stop[], m: number): Stop | null {
  return (
    stops
      .filter((s) => s.station && s.station_at_m !== null && Math.abs(s.station_at_m - m) <= STATION_NEAR_M)
      .sort((a, b) => Math.abs(a.station_at_m! - m) - Math.abs(b.station_at_m! - m))[0] ?? null
  );
}

/**
 * Every town and village with beds on the route, and the towns where stages meet, in route order (D104). A stop that
 * is a stage town by name, within 5 km, is that stage town, so Dream's stretches start and end where Plan's do.
 */
export function planTowns(data: Pick<FreeData, "daily" | "stops">): PlanTown[] {
  const stops = data.stops.stops;
  const stages = new Map<string, PlanTown>();
  for (const d of data.daily) {
    for (const [name, m] of [
      [d.start_name, d.from_m],
      [d.end_name, d.to_m],
    ] as const) {
      const id = `stage:${Math.round(m)}`;
      if (name && !stages.has(id)) stages.set(id, { id, name, alt: null, m, station: null });
    }
  }
  const towns = [...stages.values()];
  for (const s of stops) {
    if (!s.name) continue;
    const names = [s.name, s.name_en].filter((n): n is string => !!n).map(fold);
    const stage = towns.find((t) => t.id.startsWith("stage:") && Math.abs(t.m - s.at_m) <= SAME_TOWN_M && names.includes(fold(t.name)));
    if (stage) {
      if (!stage.alt && fold(s.name) !== fold(stage.name)) stage.alt = s.name;
      continue;
    }
    towns.push({ id: s.id, name: s.name, alt: s.name_en ?? null, m: s.at_m, station: null });
  }
  for (const t of towns) t.station = stationNear(stops, t.m)?.station ?? null;
  return towns.sort((a, b) => a.m - b.m || a.name.localeCompare(b.name));
}

/** Where the trip starts and ends, in route metres. */
export const startOf = (i: Pick<PlanInputs, "fromM" | "toM" | "direction">) => (i.direction === "forward" ? i.fromM : i.toM);
export const endOf = (i: Pick<PlanInputs, "fromM" | "toM" | "direction">) => (i.direction === "forward" ? i.toM : i.fromM);

/** A trip from one point on the route to another, ridden from the first (D104): the direction follows from the two. */
export function withEnds(inputs: PlanInputs, start: number, end: number): PlanInputs {
  return { ...inputs, fromM: Math.min(start, end), toM: Math.max(start, end), direction: start <= end ? "forward" : "reverse" };
}

/**
 * The towns with a station nearest an end of the trip (D104), one each side within OTHER_END_M: `km` is how much
 * longer (more than 0) or shorter the trip becomes by starting or ending there instead.
 */
export function otherEnds(data: Pick<FreeData, "daily" | "stops">, inputs: PlanInputs, which: "start" | "end"): { town: PlanTown; km: number }[] {
  const at = which === "start" ? startOf(inputs) : endOf(inputs);
  const other = which === "start" ? endOf(inputs) : startOf(inputs);
  // Only the towns, and the stations, that could count: a plan is made often, and a long route has thousands.
  const near = (m: number | null) => m !== null && Math.abs(m - at) <= OTHER_END_M + STATION_NEAR_M + SAME_TOWN_M;
  const towns = planTowns({
    daily: data.daily.filter((d) => near(d.from_m) || near(d.to_m)),
    stops: { ...data.stops, stops: data.stops.stops.filter((s) => near(s.at_m) || near(s.station_at_m)) },
  });
  const out: { town: PlanTown; km: number }[] = [];
  for (const side of [-1, 1]) {
    const t = towns
      .filter((x) => x.station && Math.sign(x.m - at) === side && Math.abs(x.m - at) <= OTHER_END_M)
      // Never past the trip's other end, and never on top of it.
      .filter((x) => Math.sign(other - at) !== side || Math.abs(x.m - at) < Math.abs(other - at) - 1000)
      .sort((a, b) => Math.abs(a.m - at) - Math.abs(b.m - at))[0];
    if (t) out.push({ town: t, km: (Math.abs(t.m - other) - Math.abs(at - other)) / 1000 });
  }
  return out;
}
