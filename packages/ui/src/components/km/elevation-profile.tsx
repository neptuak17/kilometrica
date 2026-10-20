/**
 * Elevation along the trip or one day (11.6), in the new UI kit (D53, D54), in the direction of travel. The trip is
 * drawn in the route teal with its days marked; a single day in the chosen orange. Where the terrain is unknown the
 * line breaks, never drawn flat (D37). Night stops are numbered markers; when `onMarkerMove` is given they can be
 * dragged, and the app decides where a dropped marker lands (the nearest real stop). Labels are HTML, so they stay
 * crisp at any width. On paper, `marks` adds a km mark every so many km under a single day (D55).
 */
import { useRef, useState } from "react"
import { cn } from "cn"

export interface ProfilePoint {
  /** Distance from the start of what's shown. */
  km: number
  /** Elevation in metres, or null where the terrain is unknown. */
  m: number | null
}

export interface ProfileSpan {
  from: number
  to: number
  /** e.g. "Day 3". */
  label: string
}

export interface ProfileMarker {
  km: number
  /** Short text inside the marker, e.g. the night's number. */
  label: string
  /** The full name, e.g. "Night 2: Apt". */
  title?: string
  /** A night the rider has kept (booked or chosen). */
  kept?: boolean
}

export interface ElevationProfileProps {
  points: ProfilePoint[]
  /** "route" for the trip, "chosen" for the day the rider is looking at. */
  tone?: "route" | "chosen"
  /** The days along the trip: dividers between them and their names below. */
  spans?: ProfileSpan[]
  /** The night stops. */
  markers?: ProfileMarker[]
  onSpanPick?: (index: number) => void
  /** A marker was dragged and let go at this km. */
  onMarkerMove?: (index: number, km: number) => void
  /** A km mark every this many km, under a profile without spans (a day on paper, D55). */
  marks?: number
  /** What it shows, for screen readers, e.g. "Elevation along the trip". */
  label: string
  className?: string
}

const TOP = 30 // room above the highest point for the markers and the label (of 100)
const BOTTOM = 3

export function ElevationProfile({ points, tone = "route", spans = [], markers = [], onSpanPick, onMarkerMove, marks, label, className }: ElevationProfileProps) {
  const plot = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ index: number; km: number } | null>(null)

  const k0 = points.length ? Math.min(...points.map((p) => p.km)) : 0
  const k1 = points.length ? Math.max(...points.map((p) => p.km), k0 + 0.001) : 1
  const known = points.flatMap((p) => (p.m === null ? [] : [p.m]))
  const lo = known.length ? Math.min(...known) : 0
  const hi = known.length ? Math.max(...known, lo + 50) : lo + 50
  const peak = known.length ? Math.max(...known) : null
  const x = (km: number) => ((km - k0) / (k1 - k0)) * 100
  const y = (m: number) => 100 - BOTTOM - ((m - lo) / (hi - lo)) * (100 - TOP - BOTTOM)

  // One run per stretch of known terrain.
  const runs: ProfilePoint[][] = []
  let run: ProfilePoint[] = []
  for (const p of points) {
    if (p.m === null) {
      if (run.length > 1) runs.push(run)
      run = []
    } else run.push(p)
  }
  if (run.length > 1) runs.push(run)
  const line = (r: ProfilePoint[]) => r.map((p, i) => `${i ? "L" : "M"}${x(p.km).toFixed(2)},${y(p.m!).toFixed(2)}`).join("")
  const area = (r: ProfilePoint[]) => `${line(r)}L${x(r[r.length - 1]!.km).toFixed(2)},100L${x(r[0]!.km).toFixed(2)},100Z`

  const kmAt = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect()
    if (!r || r.width === 0) return k0
    return k0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (k1 - k0)
  }
  const release = () => {
    if (drag && onMarkerMove) onMarkerMove(drag.index, drag.km)
    setDrag(null)
  }

  // Marks at whole multiples, kept clear of the two end labels.
  const ticks: number[] = []
  if (marks && marks > 0) {
    const clear = (k1 - k0) * 0.06
    for (let k = Math.ceil((k0 + 0.001) / marks) * marks; k < k1; k += marks) if (k - k0 > clear && k1 - k > clear) ticks.push(k)
  }

  const chosen = tone === "chosen"
  return (
    <div role="group" aria-label={label} className={cn("grid gap-1 select-none", className)}>
      <div
        ref={plot}
        className={cn("relative h-28 sm:h-36", drag && "touch-none")}
        onPointerMove={(e) => drag && setDrag({ ...drag, km: kmAt(e.clientX) })}
        onPointerUp={release}
        onPointerCancel={() => setDrag(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
          {spans.map((s, i) => (
            <rect
              key={`pick-${i}`}
              x={x(s.from)}
              y={0}
              width={Math.max(0, x(s.to) - x(s.from))}
              height={100}
              className={cn("fill-transparent", onSpanPick && "cursor-pointer hover:fill-route/10")}
              onClick={onSpanPick ? () => onSpanPick(i) : undefined}
            />
          ))}
          {runs.map((r, i) => (
            <path key={`area-${i}`} d={area(r)} className={cn("pointer-events-none", chosen ? "fill-route-chosen/20" : "fill-route/20")} />
          ))}
          {runs.map((r, i) => (
            <path
              key={`line-${i}`}
              d={line(r)}
              className={cn("pointer-events-none fill-none stroke-2 [stroke-linejoin:round] [vector-effect:non-scaling-stroke]", chosen ? "stroke-route-chosen" : "stroke-route")}
            />
          ))}
          {spans.slice(1).map((s, i) => (
            <line
              key={`div-${i}`}
              x1={x(s.from)}
              x2={x(s.from)}
              y1={TOP / 2}
              y2={100}
              className="pointer-events-none stroke-border stroke-[1.5] [stroke-dasharray:3_4] [vector-effect:non-scaling-stroke]"
            />
          ))}
          <line x1={0} x2={100} y1={100} y2={100} className="stroke-border stroke-[1.5] [vector-effect:non-scaling-stroke]" />
          {!spans.length &&
            ticks.map((k) => (
              <line key={`tick-${k}`} x1={x(k)} x2={x(k)} y1={95} y2={100} className="stroke-muted-foreground stroke-1 [vector-effect:non-scaling-stroke]" />
            ))}
        </svg>
        {peak !== null && <span className="pointer-events-none absolute top-0 left-0 text-xs text-muted-foreground tabular-nums">highest point {Math.round(peak).toLocaleString("en-GB")} m</span>}
        {!known.length && <span className="absolute inset-0 grid place-items-center text-xs text-unknown-foreground">Terrain unknown: check yourself</span>}
        {markers.map((mk, i) => {
          const at = drag?.index === i ? drag.km : mk.km
          if (at < k0 || at > k1) return null
          return (
            <div key={i} className="absolute inset-y-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${x(at)}%`, top: "14%" }}>
              <span
                title={mk.title}
                aria-label={mk.title ?? mk.label}
                onPointerDown={
                  onMarkerMove
                    ? (e) => {
                        plot.current?.setPointerCapture(e.pointerId)
                        setDrag({ index: i, km: mk.km })
                      }
                    : undefined
                }
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[11px] font-bold text-background shadow-sm tabular-nums",
                  mk.kept ? "bg-route-chosen" : "bg-foreground",
                  onMarkerMove && "cursor-grab touch-none",
                  drag?.index === i && "cursor-grabbing ring-2 ring-route-chosen",
                )}
              >
                {mk.label}
              </span>
              <span className="w-0 flex-1 border-l border-dashed border-foreground/60" />
            </div>
          )
        })}
      </div>
      <div className="relative h-4 text-xs text-muted-foreground tabular-nums">
        {spans.length ? (
          spans.map((s, i) => {
            const w = x(s.to) - x(s.from)
            return w < 4 ? null : (
              <span key={i} className="absolute top-0 truncate text-center" style={{ left: `${x(s.from)}%`, width: `${w}%` }}>
                {w < 9 ? s.label.replace(/^Day /, "") : s.label}
              </span>
            )
          })
        ) : (
          <>
            <span className="absolute top-0 left-0">km {Math.round(k0)}</span>
            {ticks.map((k) => (
              <span key={k} className="absolute top-0 -translate-x-1/2" style={{ left: `${x(k)}%` }}>
                {k}
              </span>
            ))}
            <span className="absolute top-0 right-0">km {Math.round(k1)}</span>
          </>
        )}
      </div>
    </div>
  )
}
