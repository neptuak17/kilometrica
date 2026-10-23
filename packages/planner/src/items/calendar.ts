/** Public and school holidays on a date (`calendar.json`), and where we have none (D37). */
import type { PlanCore } from "../plan";
import { country } from "../text";
import type { PlanData } from "../types";
import type { Add } from "./shared";

export function holidayOn(data: PlanData, cc: string | null, iso: string) {
  const cal = data.calendar?.countries.find((c) => c.country === cc);
  if (!cal || cal.public_year !== Number(iso.slice(0, 4))) return null;
  return cal.public.find((h) => h.date === iso && h.nationwide) ?? null;
}

export function schoolOn(data: PlanData, cc: string | null, iso: string) {
  const cal = data.calendar?.countries.find((c) => c.country === cc);
  if (!cal || cal.school_year !== Number(iso.slice(0, 4))) return null;
  return cal.school.find((s) => s.start <= iso && iso <= s.end) ?? null;
}

/** The countries of the trip whose public holidays we don't have for its year: a note to check the local calendar. */
export function holidayNotes(data: PlanData, core: PlanCore, add: Add) {
  const countries = [...new Set(core.nights.map((n) => n.stop.country).filter((c): c is string => !!c))];
  const year = Number(core.inputs.startDate.slice(0, 4));
  for (const cc of countries) {
    const cal = data.calendar?.countries.find((c) => c.country === cc);
    if (!cal || cal.public_year === null) {
      add({ id: `data:holidays:${cc}`, kind: "note", day: null, fromM: null, toM: null, title: `We have no public holidays for ${country(cc)}: check the local calendar`, why: "", rank: 15, topic: "prepare", evidence: { source: "OpenHolidays" }, handoffs: [] });
    } else if (cal.public_year !== year) {
      add({ id: `data:holidays:${cc}`, kind: "note", day: null, fromM: null, toM: null, title: `Public holidays in ${country(cc)} for ${year} aren't published yet: check the local calendar`, why: "", rank: 15, topic: "prepare", evidence: { source: "OpenHolidays" }, handoffs: [] });
    }
  }
}
