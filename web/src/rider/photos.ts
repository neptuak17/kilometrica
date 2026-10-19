/**
 * Street-level photos on tap (D58). Mapillary and Panoramax open on a photo only by its id, so when the rider taps,
 * the nearest photo to the link's route point is looked up: the point only, never the rider's position (D41), and
 * nothing before the tap. Photos facing the way the rider rides come first. With none within 50 m, a failed or slow
 * lookup, or no Mapillary token, the link opens their map at that point instead.
 */
import type { Handoff } from "@dpg/planner";

type At = NonNullable<Handoff["photoAt"]>;

const RADIUS_M = 50;
const TIMEOUT_MS = 4000;
/** A Mapillary client token (public and read-only by design), from web/.env.local; never committed. */
const MAPILLARY_TOKEN: string | undefined = import.meta.env.VITE_MAPILLARY_TOKEN || undefined;

interface Candidate {
  id: string;
  at: [number, number];
  facing: number | null;
}

function box(at: At): string {
  const dLat = RADIUS_M / 111_320;
  const dLon = RADIUS_M / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return [at.lon - dLon, at.lat - dLat, at.lon + dLon, at.lat + dLat].map((v) => v.toFixed(6)).join(",");
}

/** Metres between two points; flat-earth is exact enough at these distances. */
function apart(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_320;
}

/** Degrees between two compass bearings, 0 to 180. */
const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** The nearest photo within the radius, those facing within 60° of the way the rider rides first. */
function nearest(found: Candidate[], at: At): Candidate | null {
  const here: [number, number] = [at.lon, at.lat];
  const score = (c: Candidate) => {
    const d = apart(here, c.at);
    const away = at.heading !== null && c.facing !== null && turn(at.heading, c.facing) > 60;
    return d + (away ? 1000 : 0);
  };
  const near = found.filter((c) => apart(here, c.at) <= RADIUS_M).sort((x, y) => score(x) - score(y));
  return near[0] ?? null;
}

async function mapillary(at: At, signal: AbortSignal): Promise<string | null> {
  if (!MAPILLARY_TOKEN) return null;
  const q = new URLSearchParams({ access_token: MAPILLARY_TOKEN, fields: "id,geometry,computed_geometry,computed_compass_angle", bbox: box(at), limit: "100" });
  const res = await fetch(`https://graph.mapillary.com/images?${q}`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: { id: string; geometry?: { coordinates: [number, number] }; computed_geometry?: { coordinates: [number, number] }; computed_compass_angle?: number }[];
  };
  const found = (body.data ?? []).flatMap((i) => {
    const where = i.computed_geometry?.coordinates ?? i.geometry?.coordinates;
    return where ? [{ id: i.id, at: where, facing: i.computed_compass_angle ?? null }] : [];
  });
  const best = nearest(found, at);
  return best ? `https://www.mapillary.com/app/?pKey=${best.id}&focus=photo` : null;
}

async function panoramax(at: At, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`https://api.panoramax.xyz/api/search?bbox=${box(at)}&limit=100`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as { features?: { id: string; geometry?: { coordinates: [number, number] }; properties?: Record<string, unknown> }[] };
  const found = (body.features ?? []).flatMap((f) => {
    const facing = f.properties?.["view:azimuth"];
    return f.geometry ? [{ id: f.id, at: f.geometry.coordinates, facing: typeof facing === "number" ? facing : null }] : [];
  });
  const best = nearest(found, at);
  return best ? `https://explore.panoramax.fr/#focus=pic&pic=${best.id}` : null;
}

/** The photo to open for a link, or null to open its map. */
async function photoFor(at: At): Promise<string | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    return await (at.service === "mapillary" ? mapillary(at, stop.signal) : panoramax(at, stop.signal));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a link looks up its photo on tap; the others are plain links. */
export const looksUp = (link: Handoff) => !!link.photoAt && (link.photoAt.service === "panoramax" || !!MAPILLARY_TOKEN);

/**
 * Opens a link that looks up its photo. The tab opens at once, while the tap still counts as the rider's, so no
 * browser blocks it, and goes to the photo, or to the map, when the lookup ends. False if no tab could be opened,
 * so the link opens its map the ordinary way.
 */
export function openPhoto(link: Handoff): boolean {
  const at = link.photoAt;
  if (!at) return false;
  const tab = window.open("about:blank", "_blank");
  if (!tab) return false;
  tab.opener = null;
  void photoFor(at).then((photo) => tab.location.replace(photo ?? link.url));
  return true;
}
