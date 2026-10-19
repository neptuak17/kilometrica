/**
 * The trip brief (11.6) in the new look (D53, D54): one screen saying what the rider is taking on. Five fixed lines,
 * one per question, the effort per day against the rider's usual day, and the day list.
 */
import { dayItems, hours, km, type PlanResult } from "@dpg/planner";
import { Card, CardContent, CardHeader, CardTitle, cn, DayRow, Icons } from "@dpg/ui";
import type { ReactNode } from "react";

const EFFORT_LABEL = { within: "within your level", harder: "a harder day", beyond: "beyond your level" } as const;

/** Riding hours per day as bars against the rider's usual day; a bar opens its day. */
export function EffortChart({ plan, selected, onPick, changed }: { plan: PlanResult; selected: number | null; onPick: (n: number) => void; changed?: number[] }) {
  const max = Math.max(plan.usual.hours * 1.5, ...plan.brief.effort.map((e) => e.hours));
  const usual = (plan.usual.hours / max) * 100;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Effort, day by day</h2>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-6 border-t-2 border-dashed border-muted-foreground" />
          Your usual day, about {hours(plan.usual.hours)}
        </span>
      </div>
      <div role="group" aria-label="Riding hours per day against your usual day" className="relative flex h-40 items-end gap-1.5 border-b pt-5">
        <span className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-muted-foreground/70" style={{ bottom: `${usual}%` }} />
        {plan.brief.effort.map((e) => {
          const on = selected === e.day;
          return (
            <button
              key={e.day}
              type="button"
              aria-pressed={on}
              title={`Day ${e.day}: ${hours(e.hours)} riding, ${EFFORT_LABEL[e.effort]}`}
              onClick={() => onPick(e.day)}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
            >
              <span
                className={cn(
                  "w-full rounded-t-md transition-opacity group-hover:opacity-80",
                  e.effort === "within" ? "bg-effort-within" : e.effort === "harder" ? "bg-effort-harder" : "bg-effort-beyond",
                  on && "ring-2 ring-route-chosen ring-offset-2 ring-offset-card",
                  changed?.includes(e.day) && "outline-2 outline-route",
                )}
                style={{ height: `${Math.max(3, (e.hours / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      {plan.brief.effort.length <= 21 && (
        <div className="flex gap-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
          {plan.brief.effort.map((e) => (
            <span key={e.day} className={cn("min-w-0 flex-1 truncate", selected === e.day && "font-semibold text-foreground")}>
              {e.day}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const TOPIC: Record<string, { icon: ReactNode; tone: string }> = {
  able: { icon: <Icons.Bike className="size-[18px]" />, tone: "text-primary" },
  sleep: { icon: <Icons.Bed className="size-[18px]" />, tone: "text-primary" },
  risk: { icon: <Icons.TriangleAlert className="size-[18px]" />, tone: "text-headsup-foreground" },
  prepare: { icon: <Icons.Flag className="size-[18px]" />, tone: "text-primary" },
  like: { icon: <Icons.Sun className="size-[18px]" />, tone: "text-highlight-foreground" },
};

/** The five key lines, and how well we know these days. */
export function Brief({ plan, onLine, free = false }: { plan: PlanResult; onLine: (topic: string) => void; free?: boolean }) {
  const b = plan.brief;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">The trip at a glance</CardTitle>
      </CardHeader>
      <CardContent className="grid">
        {b.lines.map((l) => {
          const t = TOPIC[l.topic] ?? TOPIC.able!;
          return (
            <div key={l.topic} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-b py-3.5 first:pt-0 last:border-b-0">
              <span className={cn("pt-0.5", t.tone)}>{t.icon}</span>
              <div className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">{l.question}</span>
                <span>
                  {l.answer}
                  {l.more > 0 && !free && (
                    <button type="button" className="ml-1.5 cursor-pointer text-primary hover:underline" onClick={() => onLine(l.topic)}>
                      +{l.more} more
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        <details className="group mt-1 rounded-2xl bg-muted px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-unknown-foreground">
            <Icons.CircleHelp className="size-4 shrink-0" />
            How well we know these days
            <Icons.ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 grid gap-2">
            <p>{b.confidence.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(". ")}.</p>
            <p className="text-muted-foreground">
              From the audit of {plan.route.name}: OpenStreetMap, Overture, Copernicus terrain and climate, holidays and our bike-carriage table, each with
              its source and date. Where we have no data we say so, and it becomes a check for you.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/** The days as the kit's day rows: a row opens its day. */
export function DayList({
  plan,
  selected,
  onPick,
  free,
  changed,
}: {
  plan: PlanResult;
  selected: number | null;
  onPick: (n: number) => void;
  free: boolean;
  /** Days a previewed change alters (11.7). */
  changed?: number[];
}) {
  const ridden = plan.days.filter((d) => d.kind === "ride");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-lg font-semibold">
          The days
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {km(plan.brief.km)} km · about {hours(ridden.reduce((a, d) => a + d.hoursSlow, 0))} riding
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-0.5 px-2">
        {plan.days.map((d) => {
          const mine = dayItems(plan.items, d.number);
          const count = mine.calls.length + mine.todos.length + mine.headsups.shown.length + mine.headsups.more;
          return (
            <DayRow
              key={d.number}
              number={d.number}
              date={d.date.slice(5).split("-").reverse().join("/")}
              to={d.endName}
              rest={d.kind === "rest"}
              km={d.kind === "ride" ? km(d.km) : undefined}
              hours={d.kind === "ride" ? hours(d.hoursSlow) : undefined}
              effort={d.kind === "ride" ? d.effort : undefined}
              items={free ? undefined : count}
              selected={selected === d.number}
              changed={changed?.includes(d.number)}
              onPick={() => onPick(d.number)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
