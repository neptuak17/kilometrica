/**
 * When each country is good to ride (11.7): the route's countries in route order against the months, by our
 * best-time score. Greener is better; a cell with no data says so ("?"), never zero (D37). A month can be chosen
 * from its column head.
 */
import type { DreamSection } from "@dpg/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@dpg/ui";
import { country, MONTHS, MONTHS_LONG } from "@dpg/planner";
import { useMemo } from "react";
import { whole } from "./ask";

interface Row {
  cc: string;
  length: number;
  best: ({ v: number; share: number } | null)[];
}

export function countryRows(sections: DreamSection[]): Row[] {
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
 * The highlight colour, stronger for a better score: scores lie between about 30 and 90. Mixed in oklab, since an
 * oklch mix with white swings the hue through yellow.
 */
const shade = (v: number) => `color-mix(in oklab, var(--highlight) ${Math.max(6, Math.min(70, Math.round((v - 30) * 1.25)))}%, var(--card))`;

export function Glance({ sections, month, onMonth }: { sections: DreamSection[]; month: number | null; onMonth: (m: number | null) => void }) {
  const rows = useMemo(() => countryRows(sections), [sections]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">When each country is good to ride</CardTitle>
        <CardDescription>Our best-time score out of 100: comfort (heat, rain, daylight), crowds, and what's open. Choose a month from its letter.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-[3px] text-xs tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="text-left font-normal text-muted-foreground">
                  Country
                </th>
                {MONTHS.map((n, m) => (
                  <th key={n} scope="col" className="font-normal">
                    <button
                      type="button"
                      aria-pressed={month === m}
                      title={month === m ? `Any month` : `Choose ${MONTHS_LONG[m]}`}
                      onClick={() => onMonth(month === m ? null : m)}
                      className={cn(
                        "w-full cursor-pointer rounded-md py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                        month === m && "bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                    >
                      {n[0]}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cc}>
                  <th scope="row" className="pr-2 text-left text-sm font-medium whitespace-nowrap">
                    {country(r.cc).replace(/^the /, "")} <span className="font-normal text-muted-foreground">{whole(r.length / 1000)} km</span>
                  </th>
                  {r.best.map((b, m) => (
                    <td
                      key={MONTHS[m]}
                      className={cn("h-7 min-w-7 rounded-md text-center", month === m && "ring-2 ring-primary")}
                      style={
                        b
                          ? { background: shade(b.v), fontWeight: b.v >= 80 ? 700 : 400 }
                          : { background: "var(--unknown)", color: "var(--unknown-foreground)" }
                      }
                      title={`${country(r.cc)}, ${MONTHS_LONG[m]}: ${
                        b ? `best-time ${Math.round(b.v)} of 100${b.share < 0.99 ? ` (no data for ${Math.round((1 - b.share) * 100)}% of it)` : ""}` : "no data: check yourself"
                      }`}
                    >
                      {b ? Math.round(b.v) : "?"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-4 rounded" style={{ background: shade(85) }} />
            80 and over: a good time
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-4 rounded" style={{ background: shade(45) }} />
            Under 50
          </span>
          <span className="inline-flex items-center gap-1.5 text-unknown-foreground">
            <span className="size-4 rounded bg-unknown" />? No data: check yourself
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Each daily section counts in the country where most of it lies, so short passages through other countries are folded into their neighbours.
        </p>
      </CardContent>
    </Card>
  );
}
