/**
 * Data for the rider view (11.6). The teaser reads only the free files (D45). With the Trip Pass, the places on the
 * stretch are fetched by 50 km block (D31), so the server learns at most which blocks were looked at.
 */
import type {
  BundleManifest,
  CalendarFile,
  DreamFile,
  EffortFile,
  FindingsFile,
  HighlightsFile,
  Place,
  ScoresFile,
  SectionsFile,
  ServicesFile,
  StopsFile,
} from "@dpg/contracts";
import type { FreeData, FullData, Geometry, MRange } from "@dpg/planner";
import type { PathCollection } from "../api";

export const BLOCK_M = 50_000;
/** Beds, water and food that count (D17), and stations within bail-out reach (10 km). */
const COUNTED_SERVICES = ["accommodation", "food", "water"];
const BAIL_OUT_M = 10_000;
/** Blocks fetched at once (browsers open about six connections to a server anyway). */
const PARALLEL = 6;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

export interface RouteFiles {
  manifest: BundleManifest;
  free: FreeData;
  geometry: Geometry;
  sections: SectionsFile;
}

export function geometryOf(path: PathCollection): Geometry {
  const geo: Geometry = { lines: [], gaps: [] };
  for (const f of path.features) {
    const p = f.properties;
    if (p.kind === "ride") geo.lines.push({ coords: f.geometry.coordinates, m: p.m });
    else {
      const [a, b] = f.geometry.coordinates;
      if (a && b) geo.gaps.push({ atM: p.at_m, type: p.gap_type ?? "unclassified", km: p.straight_distance_m / 1000, start: a, end: b });
    }
  }
  geo.lines.sort((x, y) => (x.m[0] ?? 0) - (y.m[0] ?? 0));
  return geo;
}

export async function loadRoute(network: string, ref: string): Promise<RouteFiles> {
  const base = `/v1/routes/${network}/${ref.toLowerCase()}`;
  const manifest = await get<BundleManifest>(base);
  if (!("stops" in manifest.files) || !("effort" in manifest.files) || !("dream" in manifest.files)) {
    throw new Error("This route's audit predates Plan (M4): re-run its audit to plan it.");
  }
  const [dream, stops, effort, calendar, sections, path] = await Promise.all([
    get<DreamFile>(`${base}/dream`),
    get<StopsFile>(`${base}/stops`),
    get<EffortFile>(`${base}/effort`),
    "calendar" in manifest.files ? get<CalendarFile>(`${base}/calendar`) : Promise.resolve(null),
    get<SectionsFile>(`${base}/sections`),
    get<PathCollection>(`${base}/path`),
  ]);
  return {
    manifest,
    sections,
    geometry: geometryOf(path),
    free: {
      route: { network, ref: ref.toLowerCase(), runId: manifest.run_id, name: manifest.route.name },
      dream,
      stops,
      effort,
      calendar,
      daily: sections.daily,
    },
  };
}

export interface FullFiles {
  full: FullData;
}

interface BlockPlaces {
  places: Place[];
  missing: MRange[];
}

/** Run tasks a few at a time. */
async function inTurn<T>(tasks: (() => Promise<T>)[], parallel: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, tasks.length) }, worker));
  return out;
}

/**
 * One block's places, tried twice. What didn't come is reported as missing, never passed on as empty (D37): a failed
 * request misses the whole block, a cut-off answer (over the server's limit) everything past its last place.
 */
async function blockPlaces(url: string, fromM: number, toM: number): Promise<BlockPlaces> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await get<{ places: Place[]; truncated: boolean }>(url);
      if (!r.truncated) return { places: r.places, missing: [] };
      const last = r.places[r.places.length - 1]?.access_at_m ?? fromM;
      return { places: r.places, missing: [{ fromM: last, toM }] };
    } catch {
      // tried once more
    }
  }
  return { places: [], missing: [{ fromM, toM }] };
}

/** Sorted, with touching ranges joined: "km 1,200–1,800" rather than twelve blocks. */
export function joinRanges(ranges: MRange[]): MRange[] {
  const out: MRange[] = [];
  for (const r of [...ranges].sort((a, b) => a.fromM - b.fromM)) {
    const prev = out[out.length - 1];
    if (prev && r.fromM <= prev.toM) prev.toM = Math.max(prev.toM, r.toM);
    else out.push({ ...r });
  }
  return out;
}

/**
 * The Trip Pass detail for a stretch. Places come by whole 50 km blocks (D31), each its own request: no stretch is
 * too long to load, and a block already fetched for this run comes from the browser's cache.
 */
export async function loadFull(network: string, ref: string, runId: string, fromM: number, toM: number): Promise<FullFiles> {
  const base = `/v1/routes/${network}/${ref.toLowerCase()}`;
  const lo = Math.floor(Math.min(fromM, toM) / BLOCK_M) * BLOCK_M;
  const hi = Math.max(lo + BLOCK_M, Math.ceil(Math.max(fromM, toM) / BLOCK_M) * BLOCK_M);
  const blocks: (() => Promise<BlockPlaces>)[] = [];
  for (let m = lo; m < hi; m += BLOCK_M) {
    const query = (extra: Record<string, string>) =>
      new URLSearchParams({ run: runId, from_km: String(m / 1000), to_km: String((m + BLOCK_M) / 1000), limit: "20000", ...extra });
    blocks.push(
      () => blockPlaces(`${base}/places?${query({ service: COUNTED_SERVICES.join(","), counting: "1" })}`, m, m + BLOCK_M),
      () => blockPlaces(`${base}/places?${query({ service: "station", max_detour_m: String(BAIL_OUT_M) })}`, m, m + BLOCK_M),
    );
  }
  const [findings, highlights, scores, services, loaded] = await Promise.all([
    get<FindingsFile>(`${base}/findings?run=${runId}`),
    get<HighlightsFile>(`${base}/highlights?run=${runId}`).catch(() => ({ highlights: [] })),
    get<ScoresFile>(`${base}/scores?run=${runId}`),
    get<ServicesFile>(`${base}/services?run=${runId}`),
    inTurn(blocks, PARALLEL),
  ]);
  // A place on a block's edge comes with both blocks.
  const places = new Map<string, Place>();
  for (const b of loaded) for (const p of b.places) places.set(p.id, p);
  return {
    full: {
      findings: findings.findings,
      places: [...places.values()],
      placesMissing: joinRanges(loaded.flatMap((b) => b.missing)),
      highlights: highlights.highlights,
      climbs: scores.climbs,
      serviceTypes: services.types,
    },
  };
}
