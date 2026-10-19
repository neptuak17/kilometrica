/**
 * Plan's elevation profile (11.6): the kit's ElevationProfile (D53), fed from the plan, in the direction of travel.
 * Along the whole trip the night stops can be dragged: on release the stop snaps to the nearest candidate between
 * its neighbours and that night is kept ("Make it yours"). One day is drawn in the chosen orange.
 */
import type { EffortFile } from "@dpg/contracts";
import type { PlanResult } from "@dpg/planner";
import { ElevationProfile } from "@dpg/ui";
import { useMemo } from "react";

/** Elevation at a route measure, from effort.json (null where the terrain is unknown). */
export function eleAt(effort: EffortFile, m: number): number | null {
  const part = effort.parts.find((p) => m >= p.from_m && m <= p.to_m);
  if (!part) return null;
  const i = Math.min(part.ele.length - 2, Math.max(0, Math.floor((m - part.from_m) / effort.step_m)));
  const a = part.ele[i];
  const b = part.ele[i + 1];
  if (a == null || b == null) return null;
  const x0 = part.from_m + i * effort.step_m;
  const x1 = Math.min(part.from_m + (i + 1) * effort.step_m, part.to_m);
  return x1 > x0 ? a + ((b - a) * (m - x0)) / (x1 - x0) : a;
}

interface Props {
  plan: PlanResult;
  effort: EffortFile;
  /** Trip positions shown (metres); the whole trip when null. */
  range: { t0: number; t1: number } | null;
  onMoveStop?: (night: number, stopId: string) => void;
  onPickDay?: (day: number) => void;
}

export function Profile({ plan, effort, range, onMoveStop, onPickDay }: Props) {
  const t0 = range?.t0 ?? 0;
  const t1 = range?.t1 ?? plan.axis.length;
  const points = useMemo(() => {
    const n = 400;
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / n;
      return { km: (t - t0) / 1000, m: eleAt(effort, plan.axis.mOf(t)) };
    });
  }, [plan, effort, t0, t1]);
  const rides = plan.days.filter((d) => d.kind === "ride");
  const nights = plan.nights.map((n) => ({ n, t: plan.candidates.find((c) => c.stop.id === n.stop.id)?.t ?? 0 }));
  const shown = nights.filter(({ t }) => t >= t0 && t <= t1);
  const move = onMoveStop
    ? (i: number, km: number) => {
        const k = shown[i]!.n.index;
        const t = t0 + km * 1000;
        const prev = k === 0 ? 0 : (nights[k - 1]?.t ?? 0);
        const next = nights[k + 1]?.t ?? plan.axis.length;
        const best = plan.candidates.filter((c) => c.t > prev && c.t < next).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
        if (best) onMoveStop(k, best.stop.id);
      }
    : undefined;
  return (
    <ElevationProfile
      points={points}
      tone={range ? "chosen" : "route"}
      spans={range ? [] : rides.map((d) => ({ from: (d.fromT - t0) / 1000, to: (d.toT - t0) / 1000, label: `Day ${d.number}` }))}
      markers={shown.map(({ n, t }) => ({
        km: (t - t0) / 1000,
        label: String(n.afterRide),
        title: `Night ${n.afterRide}: ${n.stop.name ?? "stop"}${onMoveStop ? " (drag to move)" : ""}`,
        kept: n.locked,
      }))}
      onSpanPick={onPickDay ? (i) => onPickDay(rides[i]!.number) : undefined}
      onMarkerMove={move}
      label={range ? "Elevation for the day" : "Elevation along the trip"}
      className="px-4 pt-3 pb-2"
    />
  );
}
