/**
 * A route in a few sentences, where riders pick one (D89): its countries, terrain, landscapes, sights, best months and
 * what to know about riding it. The audit keeps the facts in the manifest's summary; the words are written here each
 * time they are shown, so the page and the assistant say the same (D77). A sentence appears only when its fact matters
 * for this route; the thresholds stay here, and riders see km and words, never shares (D57).
 */
import type { RouteOverview } from "@dpg/contracts";
import { country } from "@dpg/planner";
import { and, whole } from "./ask";
import { bestIn } from "./glance";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Climbing per km: under 5 flat, under 10 rolling, under 15 hilly, else mountainous. */
const BANDS = [5, 10, 15];
type Band = 0 | 1 | 2 | 3;
const band = (perKm: number): Band => BANDS.filter((b) => perKm >= b).length as Band;
/** A country this long or longer is named when it is hillier or flatter than the rest. */
const COUNTRY_NOTE_M = 100_000;
/** Coast, lakes and rivers, and protected areas are named when they make up this much of the route. */
const LANDSCAPE_SHARE = 1 / 3;
const WINE_SHARE = 0.25;
const WINE_M = 300_000;
const GRAVEL_SOME = 0.15;
const GRAVEL_MOSTLY = 0.4;
const PAVED_THROUGHOUT = 0.02;
const UNKNOWN_SAY = 0.1;
const CYCLE_PATHS = 0.4;
const UNDEVELOPED_SAY = 0.1;
const REMOTE_SHARE = 0.25;
const REMOTE_STRETCH_M = 50_000;

const KINDS: Record<string, string> = {
  castle: "castles",
  museum: "museums",
  archaeological_site: "ancient sites",
  fort: "forts",
  ruins: "ruins",
  monument: "monuments",
  heritage: "historic sites",
  palace: "palaces",
  manor: "manor houses",
  city_gate: "old town gates",
  citywalls: "town walls",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "about 630 km", "about 1,050 km": to the nearest 10 km, or 50 km from 1,000 km. */
export const aboutKm = (m: number) => {
  const k = m / 1000;
  const step = k >= 1000 ? 50 : 10;
  return `about ${whole(Math.max(step, Math.round(k / step) * step))} km`;
};

/** A Wikipedia title as a name in a sentence: "Grande Île, Strasbourg" is "Grande Île in Strasbourg", and a
 * parenthesis, "Tombs of the Kings (Paphos)", is dropped. */
export const sightName = (title: string) => {
  const plain = title.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const [first, ...rest] = plain.split(", ");
  return rest.length ? `${first} in ${rest.join(", ")}` : plain;
};

/** Consecutive months as one: "April–June and September–October", "May", wrapping round the new year. */
export function monthRuns(months: number[]): string {
  const on = new Set(months);
  if (on.size === 12) return "every month";
  // Start after a month that isn't in, so a run across December and January stays whole.
  const start = [...Array(12).keys()].find((m) => !on.has(m))!;
  const runs: number[][] = [];
  for (let i = 1; i <= 12; i++) {
    const m = (start + i) % 12;
    if (!on.has(m)) continue;
    const last = runs[runs.length - 1];
    if (last && (last[last.length - 1]! + 1) % 12 === m) last.push(m);
    else runs.push([m]);
  }
  return and(runs.map((r) => (r.length === 1 ? MONTHS[r[0]!]! : `${MONTHS[r[0]!]}–${MONTHS[r[r.length - 1]!]}`)));
}

function where(o: RouteOverview): string {
  const names = o.countries.map((c) => country(c.cc));
  const ends = o.start && o.end && o.start !== o.end ? ` from ${o.start} to ${o.end}` : "";
  const through = names.length === 1 ? `, all in ${names[0]}` : names.length ? `, through ${and(names)}` : "";
  return `${whole(o.length_m / 1000)} km${ends}${through}.`;
}

function terrain(o: RouteOverview): string | null {
  const share = (k: string) => (o.strong_m[k] ?? 0) / o.length_m;
  const lands = [
    { k: "coast", text: "along the coast" },
    { k: "water", text: "beside lakes and rivers" },
    { k: "protected", text: "through protected nature areas" },
  ]
    .filter((l) => share(l.k) >= LANDSCAPE_SHARE)
    .sort((a, b) => share(b.k) - share(a.k))
    .map((l) => l.text);

  let character: string | null = null;
  if (o.climb_per_km !== null) {
    const b = band(o.climb_per_km);
    const climb = o.climb_m !== null ? `, with ${whole(o.climb_m)} m of climbing` : "";
    character = ["mostly flat", "mostly rolling", `hilly${climb}`, `mountainous${climb}`][b]!;
    if (b === 3 && o.passes.length) character += `, over ${and(o.passes.map((p) => p.name))}`;
    // Countries a band hillier than the route, or flat on a route that isn't.
    const big = o.countries.length > 1 ? o.countries.filter((c) => c.length_m >= COUNTRY_NOTE_M && c.climb_per_km !== null) : [];
    const hillier = big.filter((c) => band(c.climb_per_km!) > b).map((c) => country(c.cc));
    const flat = b > 0 ? big.filter((c) => band(c.climb_per_km!) === 0).map((c) => country(c.cc)) : [];
    const notes = [hillier.length ? `hillier in ${and(hillier)}` : "", flat.length ? `flat across ${and(flat)}` : ""].filter(Boolean);
    if (notes.length) character += `, ${notes.join(" and ")}`;
  }
  const parts = [lands.length ? and(lands) : "", character ?? ""].filter(Boolean);
  return parts.length ? `${cap(parts.join("; "))}.` : null;
}

function sights(o: RouteOverview): string[] {
  const out: string[] = [];
  if (o.unesco.length) out.push(`World Heritage sites along the way include ${and(o.unesco.map((s) => sightName(s.name)))}.`);
  else {
    const kinds = o.sight_kinds.map((k) => KINDS[k]).filter((k): k is string => !!k);
    if (kinds.length) out.push(`${cap(and(kinds))} along the way.`);
  }
  const wine = o.strong_m.wine ?? 0;
  if (wine >= WINE_M || wine / o.length_m >= WINE_SHARE) out.push("It runs through wine country.");
  return out;
}

function when(o: RouteOverview): string {
  // The same best months as the route's glance and the assistant (bestIn).
  const best = bestIn(o.best_time);
  if (!best.length) return "We don't have weather data for it yet.";
  // A country whose best months share none with the route's: one answer for the whole route would mislead.
  const varies = o.countries.some((c) => {
    if (c.length_m < COUNTRY_NOTE_M) return false;
    const own = bestIn(c.best_time);
    return own.length > 0 && !own.some((m) => best.includes(m));
  });
  return `Best in ${monthRuns(best)}.${varies ? " It varies along the way: Dream shows each country month by month." : ""}`;
}

function riding(o: RouteOverview): string[] {
  const s = o.surfaces_m;
  const gravel = s.gravel ?? 0;
  const unknown = s.unknown ?? 0;
  const g = gravel / o.length_m;
  let surface =
    g > GRAVEL_MOSTLY
      ? `Mostly gravel (${aboutKm(gravel)}): a gravel bike or wide tyres is the better choice`
      : g >= GRAVEL_SOME
        ? `${cap(aboutKm(gravel))} of gravel: tyres that handle gravel help`
        : g < PAVED_THROUGHOUT && unknown / o.length_m < UNKNOWN_SAY
          ? "Paved throughout"
          : "Mostly paved";
  if (g < GRAVEL_SOME && (s.cycle_path ?? 0) / o.length_m >= CYCLE_PATHS) surface += " and largely on cycle paths";
  if (unknown / o.length_m >= UNKNOWN_SAY) surface += `; we don't know the surface for ${aboutKm(unknown)}`;
  const out = [`${surface}.`];
  if (o.undeveloped_m !== null && o.undeveloped_m / o.length_m >= UNDEVELOPED_SAY)
    out.push(`${cap(aboutKm(o.undeveloped_m))} has no developed route yet, so you'll find your own way there.`);
  if (o.remote_m / o.length_m >= REMOTE_SHARE) out.push("Long stretches are far from shops and water: carry enough.");
  else if (o.longest_remote_m >= REMOTE_STRETCH_M) out.push(`One stretch runs ${aboutKm(o.longest_remote_m)} far from shops and water: carry enough.`);
  if (o.ferries) out.push(o.ferries === 1 ? "There is one ferry crossing." : `There are ${o.ferries} ferry crossings.`);
  return out;
}

/** The route's description, sentence by sentence. Busy roads stay out until their rule is checked (D89). */
export function routeDescription(o: RouteOverview): string[] {
  return [where(o), terrain(o), ...sights(o), when(o), ...riding(o)].filter((x): x is string => !!x);
}
