/**
 * What should I look out for? The audit's findings on a day, in the rider's words and only where they matter to this
 * rider (D75); the audit's own wording is for us and the networks (D43).
 */
import type { Finding } from "@dpg/contracts";
import type { PlanCore } from "../plan";
import { km } from "../text";
import type { DayPlan, FullData } from "../types";
import { type Add, dayKm, inDay } from "./shared";

interface FindingRule {
  rank: number;
  title: (f: Finding, len: number) => string;
  short: (len: number) => string;
  why: string;
  relevant?: (core: PlanCore, f: Finding, len: number) => boolean;
}

/** Audit findings that become heads-ups, in the rider's words (the audit's own wording is for us, D43). */
const FINDING_RULES: Record<string, FindingRule> = {
  "audit.busy_road": {
    rank: 55,
    title: (f, len) => {
      const roads = f.title.split(" on ").slice(2).join(" on ");
      return `${km(len)} km on busy roads${roads ? ` (${roads})` : ""}`;
    },
    short: (len) => `Busy road ${km(len)} km`,
    why: "Fast or heavy traffic and no cycle lane, estimated from the road's class and speed limit.",
    // From 5 km, or 1 km when the rider asked to avoid busy roads (D75).
    relevant: (core, _f, len) => len >= 5 || (core.inputs.avoidBusy && len >= 1),
  },
  "audit.steps": { rank: 36, title: () => "steps", short: () => "Steps", why: "You'll need to carry or push the bike." },
  "audit.unpaved": {
    rank: 34,
    title: (_f, len) => `${km(len)} km unpaved`,
    short: (len) => `Unpaved ${km(len)} km`,
    why: "Loose gravel, dirt or sand: slow with a loaded bike, and harder when wet.",
    // Never under 1 km; from 2 km on a road bike, from 1 km when the rider asked to avoid gravel (D75).
    relevant: (core, _f, len) => len >= 1 && (core.inputs.avoidGravel || (core.inputs.bike === "road" && len >= 2)),
  },
  "services.bail_out": {
    rank: 46,
    title: (_f, len) => `${km(len)} km without a station that carries bikes`,
    short: (len) => `No bike station ${km(len)} km`,
    why: "No station within 10 km of the route where bikes are known to be carried.",
    // Only when the rider asked for daily bail-outs, from 10 km (D75).
    relevant: (core, _f, len) => !!core.inputs.bailouts && len >= 10,
  },
  "eurovelo.undeveloped": {
    rank: 30,
    title: () => "the route is undeveloped here",
    short: () => "Undeveloped route",
    why: "EuroVelo has no reliable information here, or it isn't developed for cycling: expect no signs, and possibly busy roads.",
    relevant: (_core, _f, len) => len >= 5,
  },
  // "Partially developed" and a track that follows no mapped way stay in the audit for the network (D75).
};

/** The findings on a day that matter to this rider; no bail-out ones where getting home is the rider's own affair. */
export function findingItems(full: FullData, core: PlanCore, d: DayPlan, ownWay: boolean, add: Add) {
  for (const f of full.findings) {
    const rule = FINDING_RULES[f.rule_id];
    if (!rule || !inDay(core, d, f.from_m, f.to_m)) continue;
    if (ownWay && f.rule_id === "services.bail_out") continue;
    // Only the part of the finding on this day counts, and its km are the day's own.
    const lo = Math.max(Math.min(f.from_m, f.to_m), Math.min(d.fromM, d.toM));
    const hi = Math.min(Math.max(f.from_m, f.to_m), Math.max(d.fromM, d.toM));
    const len = Math.max(0, hi - lo) / 1000;
    if (rule.relevant && !rule.relevant(core, f, len)) continue;
    const clip = (m: number) => Math.min(Math.round(d.km), Math.round(dayKm(core, d, m)));
    const [a, b] = [clip(lo), clip(hi)].sort((x, y) => x - y) as [number, number];
    add({
      id: `finding:${f.id}:${d.number}`,
      kind: "headsup",
      day: d.number,
      fromM: lo,
      toM: hi,
      title: `${a === b ? `km ${a}` : `km ${a}–${b}`}: ${rule.title(f, len)}`,
      short: rule.short(len),
      why: rule.why,
      rank: rule.rank + Math.min(4, len / 5),
      topic: rule.rank >= 45 ? "risk" : "like",
      evidence: { findings: [f.id], source: "audit findings" },
      handoffs: [],
    });
  }
}
