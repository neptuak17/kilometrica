/**
 * The players for the new shape (D99): the model writes a request and our code acts on it, as beside Dream and Plan.
 * The gold player plays each turn's own request instead, which proves our code can answer the case from the request
 * alone, so what the model player gets wrong is the model's understanding. After a change made on screen, both put the
 * planner's second thought to the rider in its own words (D77), or stay quiet.
 */
import { act, type Memory, type Request, startUnderstanding, understandTurn } from "../understand";
import { toolLines } from "../honesty";
import type { Model } from "../model/model";
import type { Player } from "./play";

export interface UnderstandPrompts {
  dream: string;
  plan: string;
  /** The rewording step's prompt; without it, the answer is the tools' lines. */
  words?: string;
}

export function understandPlayer(model: Model, prompts: UnderstandPrompts): Player {
  return {
    name: `${model.name}${prompts.words ? "-words" : ""}`,
    begin(c, phase) {
      const chat = startUnderstanding(c.phase, phase.context(), { understand: prompts[c.phase], ...(prompts.words ? { words: prompts.words } : {}) });
      return {
        async answer(_turn, rider, session, onScreen) {
          if (onScreen) return onScreen.thought.length ? { text: onScreen.thought.join(" "), first: onScreen.thought.join(" "), trace: { from: "thought" } } : { text: "", first: "", trace: { from: "quiet" } };
          const screen = phase.screen();
          const out = await understandTurn(model, chat, { rider, screen, ctx: phase.context(), call: (t, a) => session.call(t, a) });
          return {
            text: out.text,
            first: out.first,
            context: [screen, ...out.said],
            trace: { from: out.from, request: out.request, unsupported: out.unsupported.length ? [out.unsupported] : [], ms: { firstWords: out.ms.firstWords, full: out.ms.full, understand: out.ms.understand }, steps: out.steps },
          };
        },
      };
    },
  };
}

/** Each turn's own request through our code: every case with requests must pass (D99). */
export const goldPlayer: Player = {
  name: "gold-requests",
  begin(c, phase) {
    const memory: Memory = {};
    return {
      async answer(turn, _rider, session, onScreen) {
        if (onScreen) return onScreen.thought.length ? { text: onScreen.thought.join(" "), trace: { from: "thought" } } : { text: "", trace: { from: "quiet" } };
        const request: Request = turn.request ?? { kind: "unclear" };
        const done = act(c.phase, phase.context(), request, memory, (t, a) => session.call(t, a));
        const text = [...done.said, toolLines(done.results)].filter(Boolean).join("\n");
        return { text, context: [phase.screen(), ...done.said], trace: { from: "lines", request } };
      },
    };
  },
};
