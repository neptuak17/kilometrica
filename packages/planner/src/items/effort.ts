/**
 * Can I do it? Effort and daylight: days beyond the rider's level, late arrivals, hard runs, better rest towns, the
 * offers of another riding day, long steep stretches, unknown terrain, and with the Trip Pass the day's big climb.
 */
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

/** The day's biggest climb (D75): from 200 m at levels 1-2, from 400 m above that; a heads-up when it's tough for them. */
export function bigClimb(full: FullData, core: PlanCore, d: DayPlan, add: Add) {
  const climbs = full.climbs.filter((c) => c.direction === core.inputs.direction && inDay(core, d, c.from_m, c.to_m));
  const big = climbs.sort((a, b) => b.fiets - a.fiets)[0];
  if (big && big.gain_m >= (core.level.level <= 2 ? 200 : 400)) {
    const at = Math.round(dayKm(core, d, core.inputs.direction === "forward" ? big.from_m : big.to_m));
    const tough = core.level.level <= 2 && (big.avg_grade >= 5 || big.length_m >= 5000);
    add({
      id: `climb:${d.number}`,
      kind: tough ? "headsup" : "highlight",
      day: d.number,
      fromM: big.from_m,
      toM: big.to_m,
      title: `The day's big climb: ${km(big.length_m / 1000)} km at ${big.avg_grade.toFixed(1)}% from km ${at}, to ${Math.round(big.top_m)} m`,
      short: `Climb ${km(big.length_m / 1000)} km ${big.avg_grade.toFixed(1)}%`,
      why: `${Math.round(big.gain_m)} m up; steepest 500 m ${big.max_grade_500m.toFixed(0)}%.`,
      rank: tough ? 33 : 18,
      topic: tough ? "able" : "like",
      evidence: { source: "M1 climbs (FIETS)" },
      handoffs: [],
    });
  }
}
