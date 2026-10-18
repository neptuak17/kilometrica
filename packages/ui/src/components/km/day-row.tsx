/**
 * A day in Plan's day list (11.6), in the new UI kit (D53): number, date, where to, distance, riding time, effort
 * against the rider's level, and how many items it has. A previewed change marks the days it alters (11.7).
 */
import { cn } from "cn"

export type Effort = "within" | "harder" | "beyond"

const EFFORT: Record<Effort, { label: string; dot: string }> = {
  within: { label: "within your level", dot: "bg-effort-within" },
  harder: { label: "a harder day", dot: "bg-effort-harder" },
  beyond: { label: "beyond your level", dot: "bg-effort-beyond" },
}

export interface DayRowProps {
  number: number
  date: string
  to: string
  rest?: boolean
  km?: string
  hours?: string
  effort?: Effort
  items?: number
  selected?: boolean
  changed?: boolean
  onPick?: () => void
}

export function DayRow({ number, date, to, rest, km, hours, effort, items, selected, changed, onPick }: DayRowProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "grid w-full grid-cols-[4rem_3rem_1fr_auto] items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
        selected && "bg-accent",
        changed && "shadow-[inset_3px_0_0_var(--route)]",
        rest && "text-muted-foreground",
      )}
    >
      <span className="font-semibold">Day {number}</span>
      <span className="text-muted-foreground tabular-nums">{date}</span>
      <span className="truncate">{rest ? `Rest day at ${to}` : `→ ${to}`}</span>
      {!rest && (
        <span className="flex items-center gap-3 tabular-nums">
          <span>{km} km</span>
          <span className="text-muted-foreground">{hours}</span>
          {effort && <span className={cn("size-2.5 rounded-full", EFFORT[effort].dot)} title={EFFORT[effort].label} />}
          {items !== undefined && items > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-secondary px-1.5 text-xs">{items}</span>
          )}
        </span>
      )}
    </button>
  )
}
