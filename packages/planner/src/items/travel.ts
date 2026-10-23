/**
 * What do I sort out before I go? Getting to the start and home from the end (D63, D70), when the rider wants it in
 * the plan (D79), and borders out of Schengen.
 */
import type { PlanCore } from "../plan";
import { country, km } from "../text";
import type { PlanData } from "../types";
import { railLinks } from "./links";
import { type Add, fewTrains } from "./shared";

/** Schengen members (2025); crossing out of or into the area needs documents checked. Source: European Commission. */
export const SCHENGEN = new Set([
  "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU",
  "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
]);
// Microstates with open borders to Schengen neighbours count as inside for this purpose.
const OPEN_BORDER = new Set(["MC", "SM", "VA", "AD"]);
const inSchengen = (cc: string | null) => !!cc && (SCHENGEN.has(cc) || OPEN_BORDER.has(cc));

export function travelItems(data: PlanData, core: PlanCore, add: Add) {
  const rides = core.days.filter((d) => d.kind === "ride");
  const ends = [
    { id: "start", m: core.axis.startM, d: rides[0]!, word: "to the start" },
    { id: "end", m: core.axis.endM, d: rides[rides.length - 1]!, word: "home from the end" },
  ];
  const ownWay = fewTrains(data, core);
  // Riders who don't need it get a cleaner plan (D79); plans saved before it keep it.
  for (const e of core.inputs.travel === false ? [] : ends) {
    const near = data.stops.stops
      .filter((s) => s.station && s.station_at_m !== null && Math.abs(s.station_at_m - e.m) <= 10_000)
      .sort((a, b) => Math.abs(a.station_at_m! - e.m) - Math.abs(b.station_at_m! - e.m))[0];
    add({
      // The station in the id: a tick belongs to it, not to whichever station the start moves to (D64).
      id: `travel:${e.id}:${near?.id ?? "none"}`,
      kind: "todo",
      day: e.d.number,
      fromM: e.m,
      toM: e.m,
      title: near ? `Train ${e.word}: ${near.station}` : ownWay ? `Getting ${e.word}: your own arrangements` : `Getting ${e.word}: no bike-carrying station found nearby`,
      why: near
        ? `${near.station} carries bikes (our bike-carriage table) and is ${km(Math.abs(near.station_at_m! - e.m) / 1000)} km from the ${e.id}.`
        : ownWay
          ? "No trains that carry bikes along most of this route: you organise your own way there and back."
          : "Plan how you get there and back; we found no station within 10 km.",
      rank: 25,
      topic: "prepare",
      evidence: { source: "M2 stations, bike-carriage table (D20)" },
      handoffs: railLinks([near?.country]),
    });
  }
  let prev: string | null = null;
  for (const d of rides) {
    const cc = d.stop?.country ?? null;
    if (prev && cc && cc !== prev && (!inSchengen(prev) || !inSchengen(cc))) {
      add({
        id: `border:${prev}-${cc}`,
        kind: "todo",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Border into ${country(cc)} on day ${d.number}: check entry rules`,
        why: `${country(prev)} and ${country(cc)} are not both in the Schengen area.`,
        rank: 26,
        topic: "prepare",
        evidence: { source: "Schengen members (European Commission)" },
        handoffs: [],
      });
    }
    if (cc) prev = cc;
  }
}
