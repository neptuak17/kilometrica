/**
 * A plan's states, for undo and redo (11.7). Every change is an action (D52); the states it passes through are kept
 * in memory while the page is open. Quick edits to the same answers (typing "21" in the days) count as one step.
 */
import { applyAction, type PlanAction, type PlanResult, type PlanState } from "@dpg/planner";
import { useCallback, useMemo, useState } from "react";

const QUICK_MS = 1500;

export interface Step {
  before: PlanState;
  after: PlanState;
  /** An undo: the step went back. */
  undone: boolean;
}

interface Timeline {
  past: PlanState[];
  present: PlanState;
  future: PlanState[];
  /** The latest step, for its "what changed" line. */
  last: Step | null;
  /** The answers the latest "set" changed, and when: the next quick edit to the same answers joins it. */
  key: string | null;
  at: number;
}

/** Which answers a "set" changes; empty when it changes none. Other actions never join a step. */
function keyOf(present: PlanState, action: PlanAction): string | null {
  if (action.type !== "set") return null;
  const now = present.inputs as unknown as Record<string, unknown>;
  const next = action.inputs as Record<string, unknown>;
  return Object.keys(next)
    .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(now[k]))
    .sort()
    .join(",");
}

export function usePlanHistory() {
  const [t, setT] = useState<Timeline | null>(null);

  const reset = useCallback((state: PlanState) => setT({ past: [], present: state, future: [], last: null, key: null, at: 0 }), []);

  const push = (t: Timeline, next: PlanState, key: string | null): Timeline => ({
    past: [...t.past, t.present],
    present: next,
    future: [],
    last: { before: t.present, after: next, undone: false },
    key,
    at: Date.now(),
  });

  /** `before`: the plan on screen, so the planner's rest days keep their towns (D83). */
  const apply = useCallback((action: PlanAction, before?: PlanResult) => {
    setT((t) => {
      if (!t) return t;
      const key = keyOf(t.present, action);
      if (key === "") return t;
      const next = applyAction(t.present, action, before);
      if (key && key === t.key && Date.now() - t.at < QUICK_MS && t.last) {
        return { ...t, present: next, future: [], last: { before: t.last.before, after: next, undone: false }, at: Date.now() };
      }
      return push(t, next, key);
    });
  }, []);

  /** A state worked out already (an applied preview). */
  const commit = useCallback((next: PlanState) => setT((t) => (t ? push(t, next, null) : t)), []);

  const undo = useCallback(() => {
    setT((t) => {
      const prev = t?.past[t.past.length - 1];
      if (!t || !prev) return t;
      return { past: t.past.slice(0, -1), present: prev, future: [t.present, ...t.future], last: { before: t.present, after: prev, undone: true }, key: null, at: 0 };
    });
  }, []);

  const redo = useCallback(() => {
    setT((t) => {
      const next = t?.future[0];
      if (!t || !next) return t;
      return { past: [...t.past, t.present], present: next, future: t.future.slice(1), last: { before: t.present, after: next, undone: false }, key: null, at: 0 };
    });
  }, []);

  return useMemo(
    () => ({
      present: t?.present ?? null,
      last: t?.last ?? null,
      canUndo: (t?.past.length ?? 0) > 0,
      canRedo: (t?.future.length ?? 0) > 0,
      reset,
      apply,
      commit,
      undo,
      redo,
    }),
    [t, reset, apply, commit, undo, redo],
  );
}
