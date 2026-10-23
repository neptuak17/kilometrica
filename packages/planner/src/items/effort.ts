/**
 * Can I do it? Effort and daylight: days beyond the rider's level, late arrivals, hard runs, better rest towns, the
 * offers of another riding day, long steep stretches, unknown terrain, and with the Trip Pass the day's big climb.
 */
import type { Climb, EffortFile } from "@dpg/contracts";
import type { PlanCore } from "../plan";
import { clock } from "../sun";
import { hours, km, stopName } from "../text";
import type { DayPlan, FullData } from "../types";
import { type Add, dayKm, inDay, STEEP } from "./shared";

export function effortItems(core: PlanCore, add: Add) {
  const { inputs, level, usual, days, nights } = core;
  const rides = days.filter((d) => d.kind === "ride");
  for (const d of rides) {
    if (d.effort === "beyond") {
      add({
        id: `effort:beyond:${d.number}`,
        kind: "call",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Day ${d.number} is beyond your specified level (${level.name}): ${km(d.km)} km, ${Math.round(d.climbM)} m`,
        why: `About ${hours(d.hoursSlow)} riding, against your usual ${hours(usual.hours)}.`,
        rank: 36,
        topic: "able",
        evidence: { source: "pace model (level presets, D36)" },
        handoffs: [],
        options: [
          {
            id: "add-day",
            label: "Add a day",
            effect: core.restAfter.length ? "one of your rest days becomes a riding day" : "your trip ends a day later: check your return arrangements",
          },
          { id: `move:${d.number}`, label: "Move this stop", effect: "pick another night's stop on the day" },
          { id: "keep", label: "Keep it", effect: "a long day, ridden as it is" },
        ],
      });
    }
    // Only well after sunset (D75): arriving in the dusk isn't worth a call.
    if (d.sunset !== null && d.endMinutes > d.sunset + 30) {
      const early = Math.ceil((d.endMinutes - d.sunset + 15) / 15) * 15;
      add({
        id: `sunset:${d.number}`,
        kind: "call",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Day ${d.number} ends after sunset at your pace`,
        why: `In at about ${clock(d.endMinutes)}; sunset ${clock(d.sunset)}${d.clockApprox ? " (approximate clock)" : ""}.`,
        rank: 45,
        topic: "risk",
        evidence: { source: "pace model; NOAA sunset" },
        handoffs: [],
        options: [
          { id: `earlier:${early}`, label: `Leave at ${clock(inputs.startMinutes - early)}`, effect: `start ${early} min earlier` },
          { id: `move:${d.number}`, label: "Stop earlier", effect: "end the day at an earlier stop" },
          { id: "keep", label: "Keep it", effect: "ride the last part in the dusk" },
        ],
      });
    }
  }
  // One call for the first run of three harder days; not when a rest day already breaks or follows it (D74, D75).
  for (let i = 0; i + 2 < rides.length; i++) {
    const run = rides.slice(i, i + 3);
    if (run.every((d) => d.effort !== "within") && !run.some((d) => core.restAfter.includes(d.ride!))) {
      add({
        id: `effort:run:${run[0]!.number}`,
        kind: "call",
        day: run[1]!.number,
        fromM: run[0]!.fromM,
        toM: run[2]!.toM,
        title: `Days ${run[0]!.number}–${run[2]!.number} are all harder than your usual`,
        why: "Three long days in a row add up.",
        rank: 32,
        topic: "able",
        evidence: { source: "pace model" },
        handoffs: [],
        options: [
          { id: `rest:${run[1]!.ride}`, label: `Rest after day ${run[1]!.number}`, effect: "a rest day; the end date holds, so the other days get a little longer" },
          { id: "keep", label: "Keep it", effect: "no rest day" },
        ],
      });
      break;
    }
  }
  // A better town for a rest day that would make a day harder than the rider's usual (D74).
  for (const o of core.restOffers) {
    const d = days.find((x) => x.ride === o.afterRide);
    const night = nights.find((n) => n.afterRide === o.afterRide);
    if (!d || !night) continue;
    const there = stopName(o.stop);
    add({
      id: `rest-town:${o.afterRide}:${o.stop.id}`,
      kind: "call",
      day: d.number + 1,
      fromM: o.stop.at_m,
      toM: o.stop.at_m,
      title: `Rest in ${there} instead of ${stopName(night.stop)}?`,
      why: `${there} is ${km(Math.abs(o.km))} km ${o.km > 0 ? "on" : "back"} and has more to see and do; day ${d.number} would be ${o.km > 0 ? "longer, harder than your usual" : "shorter"}.`,
      rank: 22,
      topic: "like",
      evidence: { source: "rest days (D74): highlights, stops, Dream themes" },
      handoffs: [],
      options: [
        { id: `rest-in:${o.night}:${o.stop.id}`, label: `Rest in ${there}`, effect: `day ${d.number} ends there` },
        { id: "keep", label: "Keep it", effect: `rest in ${stopName(night.stop)}` },
      ],
    });
  }
  for (const o of core.offers) {
    add({
      id: `days:${o.days}`,
      kind: "call",
      day: null,
      fromM: null,
      toM: null,
      title: o.why,
      // A rest day becomes the riding day when there is one; otherwise the trip ends a day later (D75).
      why: core.restAfter.length ? "One of your rest days becomes a riding day; your end date stays." : "Your trip ends a day later: check your return arrangements.",
      rank: 34,
      topic: "able",
      evidence: { source: "stage planner" },
      handoffs: [],
      options: [
        { id: `days:${o.days}`, label: core.restAfter.length ? "Use a rest day" : "Add a day", effect: core.restAfter.length ? "same end date" : "ends a day later" },
        { id: "keep", label: "Keep it", effect: "as it is" },
      ],
    });
  }
  // A long steep stretch (D75): 2 km over 6% at levels 1-3, 5 km over 8% at 4-5; short ramps aren't worth raising.
  const steep = STEEP(level.level);
  for (const d of rides) {
    if (d.steepest && d.steepest.grade > steep.grade) {
      add({
        id: `steep:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: core.axis.mOf(d.fromT + d.steepest.atKm * 1000),
        toM: core.axis.mOf(d.fromT + (d.steepest.atKm + steep.km) * 1000),
        title: `km ${Math.round(d.steepest.atKm)}: ${steep.km} km at ${Math.round(d.steepest.grade)}%`,
        short: `Steep ${Math.round(d.steepest.grade)}%`,
        why: `A long steep climb for ${level.name} riders.`,
        rank: 35,
        topic: "able",
        evidence: { source: "Copernicus DEM GLO-30 (effort.json)" },
        handoffs: [],
      });
    }
  }
  for (const d of rides) {
    if (d.unknownKm >= 1) {
      add({
        id: `terrain:${d.number}`,
        kind: "note",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `terrain unknown for ${km(d.unknownKm)} km, so climbing and time there are minimums`,
        short: "Terrain unknown",
        why: "The official track is a straight line or a gap there, so nobody has measured the real road (D37).",
        rank: 29,
        topic: "risk",
        evidence: { source: "effort.json" },
        handoffs: [],
      });
    }
  }
}

/** Elevation at a route measure from the effort profile; null where the terrain is unknown or there's no profile. */
function eleAt(effort: EffortFile, m: number): number | null {
  const part = effort.parts.find((p) => m >= p.from_m && m <= p.to_m);
  if (!part || part.ele.length === 0) return null;
  const n = part.ele.length - 1;
  if (n === 0) return part.ele[0] ?? null;
  const i = Math.min(Math.floor((m - part.from_m) / effort.step_m), n - 1);
  const a = part.from_m + i * effort.step_m;
  const b = i === n - 1 ? part.to_m : a + effort.step_m;
  const ea = part.ele[i] ?? null;
  const eb = part.ele[i + 1] ?? null;
  if (ea === null || eb === null) return null;
  return b > a ? ea + ((eb - ea) * (m - a)) / (b - a) : ea;
}

/** The engine's FIETS index, for a part of a climb. */
const fiets = (gain: number, length: number, top: number) => gain ** 2 / (length * 10) + Math.max(0, (top - 1000) / 1000);

interface ClimbPart {
  fromM: number;
  toM: number;
  /** Route measure where the day's part starts, in the direction of travel. */
  startM: number;
  lengthM: number;
  gainM: number;
  grade: number;
  /** The climb's top, or the elevation at the day's end when the climb goes on past it. */
  topM: number;
  steepest: number | null;
  fiets: number;
  /** The climb starts before the day's start, or goes on past its end. */
  before: boolean;
  after: boolean;
}

/**
 * The part of a climb ridden on day d (D82): a climb across a night stop counts on each day for its own part, worked
 * out from the same profile. Null when the day holds none of it or the terrain there is unknown.
 */
function dayPart(effort: EffortFile, core: PlanCore, d: DayPlan, c: Climb): ClimbPart | null {
  const fwd = core.inputs.direction === "forward";
  const lo = Math.max(Math.min(d.fromM, d.toM), c.from_m);
  const hi = Math.min(Math.max(d.fromM, d.toM), c.to_m);
  if (hi - lo < 1) return null;
  const before = fwd ? lo > c.from_m : hi < c.to_m;
  const after = fwd ? hi < c.to_m : lo > c.from_m;
  const [startM, endM] = fwd ? [lo, hi] : [hi, lo];
  if (!before && !after) {
    const { length_m, gain_m, avg_grade, top_m, max_grade_500m } = c;
    return { fromM: lo, toM: hi, startM, lengthM: length_m, gainM: gain_m, grade: avg_grade, topM: top_m, steepest: max_grade_500m, fiets: c.fiets, before, after };
  }
  const e0 = eleAt(effort, startM);
  const e1 = eleAt(effort, endM);
  if (e0 === null || e1 === null || e1 <= e0) return null;
  const lengthM = hi - lo;
  const gainM = e1 - e0;
  const topM = after ? e1 : c.top_m;
  const steepest = core.axis.steepest(core.axis.tOf(startM), core.axis.tOf(endM))?.grade ?? null;
  return { fromM: lo, toM: hi, startM, lengthM, gainM, grade: (100 * gainM) / lengthM, topM, steepest, fiets: fiets(gainM, lengthM, topM), before, after };
}

/** The day's biggest climb (D75): from 200 m at levels 1-2, from 400 m above that; a heads-up when it's tough for them. */
export function bigClimb(full: FullData, effort: EffortFile, core: PlanCore, d: DayPlan, add: Add) {
  const parts = full.climbs
    .filter((c) => c.direction === core.inputs.direction && inDay(core, d, c.from_m, c.to_m))
    .map((c) => ({ c, p: dayPart(effort, core, d, c) }))
    .filter((x): x is { c: Climb; p: ClimbPart } => x.p !== null);
  const big = parts.sort((a, b) => b.p.fiets - a.p.fiets)[0];
  if (big && big.p.gainM >= (core.level.level <= 2 ? 200 : 400)) {
    const { c, p } = big;
    const at = Math.round(dayKm(core, d, p.startM));
    const tough = core.level.level <= 2 && (p.grade >= 5 || p.lengthM >= 5000);
    const up = Math.round(p.gainM);
    const total = `a ${km(c.length_m / 1000)} km climb`;
    const whole = p.before && p.after
      ? `${up} m up today, part of ${total} that starts before ${d.startName} and goes on past ${d.endName} to ${Math.round(c.top_m)} m`
      : p.before
        ? `${up} m up today, the rest of ${total} that starts before ${d.startName}`
        : p.after
          ? `${up} m up today, the first part of ${total} that goes on past ${d.endName} to ${Math.round(c.top_m)} m`
          : `${up} m up`;
    const steepest = p.steepest === null ? "" : `; steepest 500 m ${p.steepest.toFixed(0)}%`;
    add({
      id: `climb:${d.number}`,
      kind: tough ? "headsup" : "highlight",
      day: d.number,
      fromM: p.fromM,
      toM: p.toM,
      title: `The day's big climb: ${km(p.lengthM / 1000)} km at ${p.grade.toFixed(1)}% from km ${at}, ${p.after ? "to the day's end at" : "to"} ${Math.round(p.topM)} m`,
      short: `Climb ${km(p.lengthM / 1000)} km ${p.grade.toFixed(1)}%`,
      why: `${whole}${steepest}.`,
      rank: tough ? 33 : 18,
      topic: tough ? "able" : "like",
      evidence: { source: "M1 climbs (FIETS)" },
      handoffs: [],
    });
  }
}
