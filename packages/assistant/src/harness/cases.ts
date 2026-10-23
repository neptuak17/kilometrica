/**
 * The question sets' cases (A2, D77, D80): a rider's question on a real route, pinned to the audit run it was written
 * against, with what a good answer does. Kept as JSON in `sets/<language>/`, one file per phase.
 */
import type { Ask } from "@dpg/dream";
import type { Bike, PlanChoices, Sleep } from "@dpg/planner";

/** A plan as a rider would open it from Dream: the stretch by its daily sections, and the answers to Plan's questions. */
export interface PlanSpec {
  sections: [number, number];
  way?: "forward" | "reverse";
  /** Days in all, rest days included. */
  days: number;
  rest?: number;
  level: number;
  /** 0-11: the trip starts on the 15th. */
  month: number;
  sleep?: Sleep;
  bike?: Bike;
  travel?: boolean;
  bailouts?: boolean;
  stops?: "own" | "ours";
  restAfter?: number[];
  choices?: Partial<PlanChoices>;
  /** With the Trip Pass (default) or the free outline. */
  pass?: boolean;
}

export interface Call {
  tool: string;
  args: Record<string, unknown>;
}

export interface Turn {
  /** The rider's message in their words; other phrasings expect the same answer. */
  rider?: string;
  phrasings?: string[];
  /** Instead of a message, a change made on screen (in offer_options' terms): the assistant reacts, or stays quiet. */
  change?: Record<string, unknown>;
  /** The second thought the change should bring, by its question; null for none (D77). */
  thought?: string | null;
  /** The tool calls a good answer makes (extra lookups are fine). */
  calls: Call[];
  /** The option a good answer offers: by the call that makes it and its place among that call's options. */
  offer?: { call: number; option: number };
  /** Words a good answer says, and words it never says (matched without case or accents). */
  mustSay?: string[];
  mustNotSay?: string[];
  /** An answer that does all this, written from the tools' real output. */
  reference: string;
}

export interface Case {
  id: string;
  phase: "dream" | "plan";
  /** The owner's own question, or one we drafted. */
  source: "owner" | "drafted";
  /** What a good answer does: look things up, offer a change, decline, or react to a change made on screen. */
  kind: "lookup" | "offer" | "decline" | "react";
  /** "eurovelo/ev8", "user/u4a8fece911". */
  route: string;
  /** The audit run the case was written against. */
  run: string;
  /** Dream's question at the start. */
  ask?: Partial<Ask>;
  plan?: PlanSpec;
  /** What's on screen (D77): the open day, or the stretch by its number in the list. */
  screen?: { day?: number; stretch?: number };
  turns: Turn[];
  /** Why the case is there, for whoever reads the set. */
  note?: string;
}

/** Cases read from a set's JSON, with what's wrong with any of them. */
export function readCases(raw: unknown, file: string): { cases: Case[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { cases: [], problems: [`${file}: not a list of cases`] };
  const ids = new Set<string>();
  for (const [i, c] of (raw as Case[]).entries()) {
    const at = `${file} #${i + 1} ${c?.id ?? ""}`;
    if (!c || typeof c.id !== "string") problems.push(`${at}: no id`);
    else if (ids.has(c.id)) problems.push(`${at}: the id is used twice`);
    else ids.add(c.id);
    if (c?.phase !== "dream" && c?.phase !== "plan") problems.push(`${at}: phase is dream or plan`);
    if (!/^[a-z]+\/[a-z0-9]+$/.test(c?.route ?? "")) problems.push(`${at}: route is network/ref`);
    if (!/^\d{8}T\d{6}Z_[0-9a-f]{10}$/.test(c?.run ?? "")) problems.push(`${at}: run is an audit run id`);
    if (c?.phase === "plan" && !c.plan) problems.push(`${at}: a plan case needs its plan`);
    if (!Array.isArray(c?.turns) || !c.turns.length) problems.push(`${at}: no turns`);
    for (const [k, t] of (c?.turns ?? []).entries()) {
      if (!t.rider && !t.change) problems.push(`${at} turn ${k + 1}: a message or a change on screen`);
      if (!Array.isArray(t.calls)) problems.push(`${at} turn ${k + 1}: calls is a list`);
      if (typeof t.reference !== "string") problems.push(`${at} turn ${k + 1}: no reference answer`);
      if (t.offer && !t.calls?.[t.offer.call]) problems.push(`${at} turn ${k + 1}: the offer's call isn't there`);
    }
  }
  return { cases: problems.length ? [] : (raw as Case[]), problems };
}
