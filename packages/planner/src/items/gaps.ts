/**
 * Gaps in the route (D47, D50): a day's ferries, published public-transport links, and unfilled gaps, which count as
 * ridden and are the rider's to cross.
 */
import type { PlanCore } from "../plan";
import { km } from "../text";
import { type Add, dayKm } from "./shared";

export function gapItems(core: PlanCore, add: Add) {
  for (const d of core.days.filter((x) => x.kind === "ride")) {
    // A day's ferries are one line, ticked once (the Dutch delta has four in a day); the id names its ferries, so a
    // tick stays with them.
    const ferries = d.gaps.filter((g) => g.type === "ferry");
    if (ferries.length) {
      const at = ferries.map((g) => Math.round(dayKm(core, d, g.atM)));
      const lens = ferries.map((g) => g.km);
      const one = ferries.length === 1;
      const kms = at.length > 1 ? `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}` : `${at[0]}`;
      add({
        id: `ferry:${ferries.map((g) => Math.round(g.atM)).join("+")}`,
        kind: "todo",
        day: d.number,
        fromM: ferries[0]!.atM,
        toM: ferries[ferries.length - 1]!.atM,
        title: one ? `Ferry on day ${d.number}: check its season and times` : `${ferries.length} ferries on day ${d.number}: check their seasons and times`,
        short: one ? "Ferry: check times" : `${ferries.length} ferries: check times`,
        why: one
          ? `A ${km(lens[0]!)} km crossing at km ${kms} of the day; we have no timetables, so it isn't timed.`
          : `Crossings at km ${kms} of the day (${km(Math.min(...lens))} to ${km(Math.max(...lens))} km); we have no timetables, so they aren't timed.`,
        rank: 38,
        topic: "prepare",
        evidence: { source: "OSM ferry route (effort.json gaps)" },
        handoffs: [],
      });
    }
    for (const g of d.gaps) {
      const at = Math.round(dayKm(core, d, g.atM));
      if (g.type === "ferry") {
        continue;
      } else if (g.type === "public_transport") {
        add({
          id: `transport:${Math.round(g.atM)}`,
          kind: "todo",
          day: d.number,
          fromM: g.atM,
          toM: g.atM,
          title: `Public-transport link on day ${d.number}: check times and bike rules`,
          short: "Transport link",
          why: `The network advises public transport across ${km(g.km)} km at km ${at} of the day.`,
          rank: 38,
          topic: "prepare",
          evidence: { source: "network's published advice" },
          handoffs: [],
        });
      } else if (g.type === "missing" || g.type === "unclassified") {
        add({
          id: `gap:${Math.round(g.atM)}`,
          kind: "note",
          day: d.number,
          fromM: g.atM,
          toM: g.atM,
          title: `the route has a ${km(g.km)} km gap at km ${at}, counted as ridden: draw your own line across it in your route tool`,
          short: `Route gap ${km(g.km)} km`,
          why: `At km ${at} of the day the official track stops: no track, ferry or published link. Draw your own line across it in your route tool.`,
          rank: 52,
          topic: "risk",
          evidence: { source: "effort.json gaps (D50)" },
          handoffs: [],
        });
      }
    }
  }
}
