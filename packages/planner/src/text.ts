/** Wording helpers: numbers in the rider's own terms (11.6). */
import type { Stop } from "@dpg/contracts";

/** A stop by its town, else by its km. */
export const stopName = (s: Stop) => s.name ?? `near km ${Math.round(s.at_m / 1000)}`;

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
