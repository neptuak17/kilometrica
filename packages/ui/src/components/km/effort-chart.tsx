/**
 * The trip's effort, day by day (11.6), in the new UI kit (D53, D54): riding hours per day as bars against the
 * rider's usual day (the dashed line), coloured by effort against their level, with each day's hours above its bar.
 * A bar opens its day. A rest day keeps its place in the row, with no bar, so the trip reads as it is lived. The words
 * come from the app (the hours, the usual day's line); the kit only draws. Meant for a card: the hours sit on the
 * card's colour, so the dashed line passes behind them.
 */
import { cn } from "cn"

import type { Effort } from "@dpg/ui/components/km/day-row"

const EFFORT: Record<Effort, { label: string; bar: string; strong: boolean }> = {
  within: { label: "within your level", bar: "bg-effort-within", strong: false },
  harder: { label: "a harder day", bar: "bg-effort-harder", strong: true },
  beyond: { label: "beyond your level", bar: "bg-effort-beyond", strong: true },
}

export interface EffortChartDay {
  day: number
  /** Riding hours, for the bar's height. */
  hours: number
  /** The hours as the rider reads them, e.g. "4 h 30". */
  label: string
  effort: Effort
  /** A rest day: no riding, no bar; `label` is said in its place (e.g. "Rest"). */
  rest?: boolean
}

export interface EffortChartProps {
  days: EffortChartDay[]
  /** The rider's usual day in hours: the dashed line. */
  usual: number
  /** What the dashed line means, e.g. "Your usual day at Moderate, about 4 h 30". */
  usualLabel: string
  title?: string
  selected?: number | null
  /** Days a previewed change alters (11.7). */
  changed?: number[]
  onPick?: (day: number) => void
  className?: string
}

export function EffortChart({ days, usual, usualLabel, title = "Effort, day by day", selected = null, changed = [], onPick, className }: EffortChartProps) {
  // Headroom above the tallest bar for its hours.
  const max = Math.max(usual * 1.4, ...days.map((d) => d.hours * 1.18), 1)
  const labels = days.length <= 14
  const names = days.length <= 8 ? "long" : days.length <= 31 ? "short" : "none"
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-6 border-t-2 border-dashed border-muted-foreground" />
          {usualLabel}
        </span>
      </div>
      <div role="group" aria-label={`Riding hours per day. ${usualLabel}`} className="relative flex h-44 items-end gap-1.5 border-b">
        <span className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-muted-foreground/70" style={{ bottom: `${(usual / max) * 100}%` }} />
        {days.map((d) => {
          const on = selected === d.day
          const e = EFFORT[d.effort]
          const bar = d.rest ? (
            <>
              <span className="mb-1 self-center text-xs text-muted-foreground">{d.label}</span>
              <span className={cn("h-1 w-full rounded-full bg-muted-foreground/30", on && "ring-2 ring-route-chosen ring-offset-2 ring-offset-card")} />
            </>
          ) : (
            <>
              {labels && (
                <span className={cn("relative mb-1 max-w-full self-center truncate rounded bg-card px-1 text-center text-xs tabular-nums", e.strong ? "font-bold text-headsup-foreground" : "text-foreground")}>{d.label}</span>
              )}
              <span
                className={cn(
                  "w-full rounded-t-md transition-opacity",
                  e.bar,
                  onPick && "group-hover:opacity-80",
                  on && "ring-2 ring-route-chosen ring-offset-2 ring-offset-card",
                  changed.includes(d.day) && "outline-2 outline-route",
                )}
                style={{ height: `${Math.max(3, (d.hours / max) * 100)}%` }}
              />
            </>
          )
          const title = d.rest ? `Day ${d.day}: ${d.label}` : `Day ${d.day}: ${d.label} riding, ${e.label}`
          return onPick ? (
            <button
              key={d.day}
              type="button"
              aria-pressed={on}
              title={title}
              onClick={() => onPick(d.day)}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
            >
              {bar}
            </button>
          ) : (
            <div key={d.day} title={title} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
              {bar}
            </div>
          )
        })}
      </div>
      {names !== "none" && (
        <div className="flex gap-1.5 text-center text-xs text-muted-foreground tabular-nums">
          {days.map((d) => (
            <span key={d.day} className={cn("min-w-0 flex-1 truncate", (selected === d.day || (!d.rest && EFFORT[d.effort].strong)) && "font-semibold text-foreground")}>
              {names === "long" ? `Day ${d.day}` : d.day}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
