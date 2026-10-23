/**
 * The route at a glance (11.7): when each country is good to ride, the route's countries in route order against the
 * months, by our best-time score weighted by length. A month with no data is null, never zero (D37).
 */
import type { DreamSection } from "@dpg/contracts";
import { MONTHS } from "@dpg/planner";

export interface CountryRow {
  cc: string;
  /** Metres of the route in the country. */
  length: number;
  /** Per month: the best-time score, and the share of the country's km it was measured on. */
  best: ({ v: number; share: number } | null)[];
}

export function countryRows(sections: DreamSection[]): CountryRow[] {
  const by = new Map<string, DreamSection[]>();
  for (const s of sections) {
    const cc = s.country ?? "??";
    by.set(cc, [...(by.get(cc) ?? []), s]);
  }
  return [...by.entries()].map(([cc, secs]) => {
    const length = secs.reduce((a, s) => a + s.length_m, 0);
    const best = MONTHS.map((_, m) => {
      let sum = 0;
      let len = 0;
      for (const s of secs) {
        const v = s.best_time[m];
        if (v === null || v === undefined) continue;
        sum += v * s.length_m;
        len += s.length_m;
      }
      return len ? { v: sum / len, share: len / length } : null;
    });
    return { cc, length, best };
  });
}

/**
 * The best months on these sections by Dream's best-time score (weighted by length): those within 3 points of the
 * best, in calendar order, with the best score. Months with no data are left out (D37).
 */
export function bestMonths(sections: DreamSection[]): { months: number[]; score: number } | null {
  const per = MONTHS.map((_, m) => {
    let sum = 0;
    let len = 0;
    for (const s of sections) {
      const v = s.best_time[m];
      if (v === null || v === undefined) continue;
      sum += v * s.length_m;
      len += s.length_m;
    }
    return len ? sum / len : null;
  });
  const known = per.map((v, m) => ({ v, m })).filter((x): x is { v: number; m: number } => x.v !== null);
  if (!known.length) return null;
  const top = Math.max(...known.map((x) => x.v));
  return { months: known.filter((x) => x.v >= top - 3).map((x) => x.m), score: Math.round(top) };
}
