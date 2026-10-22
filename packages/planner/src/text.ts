/** Wording helpers: numbers in the rider's own terms (11.6). */
import type { Stop } from "@dpg/contracts";
import type { Sleep } from "./types";

/** A stop by its town, else by its km. */
export const stopName = (s: Stop) => s.name ?? s.near ?? `near km ${Math.round(s.at_m / 1000)}`;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function km(v: number): string {
  return v >= 10 ? `${Math.round(v)}` : v >= 1 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(1);
}

/** "5 h 20" or "45 min". */
export function hours(h: number): string {
  const total = Math.round(h * 60);
  if (total < 60) return `${total} min`;
  const m = total % 60;
  return `${Math.floor(total / 60)} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

/** "Wed 13 Oct". */
export function day(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

/** "Wed 13 – Mon 18 Oct 2027" (or across months/years). */
export function range(a: string, b: string): string {
  const [ya, ma] = a.split("-").map(Number) as [number, number];
  const [yb, mb] = b.split("-").map(Number) as [number, number];
  if (a === b) return `${day(a)} ${ya}`;
  if (ya === yb && ma === mb) return `${day(a).replace(/ \w+$/, "")} – ${day(b)} ${yb}`;
  if (ya === yb) return `${day(a)} – ${day(b)} ${yb}`;
  return `${day(a)} ${ya} – ${day(b)} ${yb}`;
}

const KIND_ORDER = ["campsite", "hotel", "guest_house", "hostel", "hut", "other"];
const KIND_WORDS: Record<string, [string, string]> = {
  campsite: ["campsite", "campsites"],
  hotel: ["hotel", "hotels"],
  guest_house: ["guest house", "guest houses"],
  hostel: ["hostel", "hostels"],
  hut: ["hut", "huts"],
  other: ["other place to stay", "other places to stay"],
};

/** A place's kind in a word: "guest house"; null for "other". */
export const kindWord = (kind: string) => (kind === "other" ? null : (KIND_WORDS[kind]?.[0] ?? null));

/**
 * What a place is called on screen: its name, or for one with no name in our data, what it is and where ("2★ hotel near
 * Santomera"). Riders never see "Unnamed".
 */
export function placeTitle(p: { name: string | null; kind: string; detail: Record<string, unknown> }, near?: string | null): string {
  if (p.name) return p.name;
  const stars = p.detail.stars ? `${String(p.detail.stars)}★ ` : "";
  const word = KIND_WORDS[p.kind]?.[0] ?? p.kind.replaceAll("_", " ");
  const what = `${stars}${word}${near ? ` near ${near}` : ""}`;
  return what.charAt(0).toUpperCase() + what.slice(1);
}

/** A place worth listing to a rider: one with a name, or a way to reach it (a website or phone). */
export const listable = (p: { name: string | null; detail: Record<string, unknown> }) => !!p.name || !!p.detail.website || !!p.detail.phone;

/** Places by kind, campsites first (D62): "1 campsite and 2 hotels". */
export function bedKinds(kinds: { kind: string; count: number }[]): string {
  const rank = (k: string) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length);
  const parts = [...kinds]
    .filter((k) => k.count > 0)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((k) => `${k.count} ${(KIND_WORDS[k.kind] ?? KIND_WORDS.other!)[k.count === 1 ? 0 : 1]}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * What a place is, for its line: the public body's own name for it where an official source has it, with its number of
 * pitches ("BC Recreation Site, 12 sites", D71), else its kind ("guest house").
 */
export function placeKind(p: { kind: string; detail: Record<string, unknown> }): string {
  const label = typeof p.detail.official === "string" ? p.detail.official : p.kind.replace("_", " ");
  const sites = typeof p.detail.sites === "number" && p.detail.sites > 0 ? p.detail.sites : null;
  return sites ? `${label}, ${plural(sites, "site")}` : label;
}

/** What the rider sleeps in, for when there's none (D62): "campsite", "place with rooms", "place to stay". */
export const sleepNoun = (sleep: Sleep) => (sleep === "camping" ? "campsite" : sleep === "rooms" ? "place with rooms" : "place to stay");

/**
 * What we know of places' opening in a month (D57, D62): "all open in May", or "check ahead if they're open". An
 * unmanaged site has no season, so it counts as known, and when every place is one there's nothing to say (D71).
 */
export function opening(beds: { count: number; open: number; partly: number; unmanaged?: number }, month: string): string {
  const unmanaged = beds.unmanaged ?? 0;
  if (unmanaged >= beds.count) return "";
  const known = beds.open + beds.partly + unmanaged;
  if (!known) return `check ahead if ${beds.count === 1 ? "it's" : "they're"} open`;
  if (known < beds.count) return `${known} open in ${month}: check ahead for the others`;
  return beds.count === 1 ? `open in ${month}` : `all open in ${month}`;
}

/**
 * A night's places and what we know of their opening, said once for the night rather than on each place (D61, D62):
 * "1 campsite and 2 hotels nearby, check ahead if they're open".
 */
export function bedsKnown(
  beds: { count: number; open: number; partly: number; unmanaged?: number; kinds: { kind: string; count: number }[] },
  month: string,
  sleep: Sleep,
  own = false,
): string {
  // The rider's own stop (D70): they have a place in mind, so it's the others we don't know of.
  if (!beds.count) return own ? `no other ${sleepNoun(sleep)} known nearby` : `no known ${sleepNoun(sleep)} nearby`;
  const open = opening(beds, month);
  return `${bedKinds(beds.kinds)} nearby${open ? `, ${open}` : ""}`;
}

/** A stay from the night in to the morning out: "14–15 May", or "31 May – 2 June" across months. */
export function stayDates(checkIn: string, checkOut: string): string {
  const [, ma, da] = checkIn.split("-").map(Number) as [number, number, number];
  const [, mb, db] = checkOut.split("-").map(Number) as [number, number, number];
  return ma === mb ? `${da}–${db} ${MONTHS_LONG[ma - 1]}` : `${da} ${MONTHS_LONG[ma - 1]} – ${db} ${MONTHS_LONG[mb - 1]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Riders see what a share means, never a percentage (D57). A conclusion is stated only when we know for at least
 * 9 in 10; the cut-off itself is never shown.
 */
export const KNOWN_ENOUGH = 0.9;

/** A share of some places in words, to start a sentence: "Most places to stay", "None of the places to stay". */
export function shareOf(x: number, things: string): string {
  if (x >= 0.999) return `All the ${things}`;
  if (x >= 0.9) return `Nearly all the ${things}`;
  if (x >= 0.6) return `Most ${things}`;
  if (x >= 0.4) return `About half the ${things}`;
  if (x >= 0.15) return `Some ${things}`;
  if (x > 0) return `Few ${things}`;
  return `None of the ${things}`;
}

/** "day 3", "days 2 and 5", "days 2, 3 and 5", or "6 days" when there are more. */
export function dayList(days: number[]): string {
  if (days.length === 1) return `day ${days[0]}`;
  if (days.length > 3) return `${days.length} days`;
  return `days ${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}

/** "1 in 5" for a share of days. */
export function oneIn(share: number): string {
  if (share <= 0.03) return "rarely";
  const n = Math.round(1 / share);
  return n <= 1 ? "most days" : `1 day in ${n}`;
}

export const COUNTRY_NAMES: Record<string, string> = {
  AD: "Andorra",
  AL: "Albania",
  AT: "Austria",
  BA: "Bosnia and Herzegovina",
  BE: "Belgium",
  BG: "Bulgaria",
  CH: "Switzerland",
  CY: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DK: "Denmark",
  ES: "Spain",
  FR: "France",
  GB: "the United Kingdom",
  GR: "Greece",
  HR: "Croatia",
  HU: "Hungary",
  IE: "Ireland",
  IT: "Italy",
  MC: "Monaco",
  ME: "Montenegro",
  MK: "North Macedonia",
  NL: "the Netherlands",
  NO: "Norway",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  RS: "Serbia",
  SE: "Sweden",
  SI: "Slovenia",
  SK: "Slovakia",
  TR: "Türkiye",
};

export const country = (cc: string | null | undefined) => (cc ? (COUNTRY_NAMES[cc] ?? cc) : "this country");

/** "4", "15–21", "3, 7–9 and 12" (sorted numbers). */
export function numberList(ns: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    runs.push(i === j ? `${ns[i]}` : `${ns[i]}–${ns[j]}`);
    i = j + 1;
  }
  const last = runs.pop() ?? "";
  return runs.length ? `${runs.join(", ")} and ${last}` : last;
}
