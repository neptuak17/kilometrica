/**
 * A3's player (D91, D97): the model answers each case through the loop, as it will beside Dream and Plan. After a
 * change made on screen it stays quiet unless the planner raised a second thought, which it puts to the rider (D77).
 */
import { chatTurn, startChat } from "../loop";
import type { Model } from "../model/model";
import type { Player } from "./play";

export function modelPlayer(model: Model, prompts: { dream: string; plan: string }): Player {
  return {
    name: model.name,
    begin(c, phase) {
      const chat = startChat(prompts[c.phase], phase.tools);
      return {
        async answer(_turn, rider, session, onScreen) {
          if (onScreen && !onScreen.thought.length) return { text: "", first: "", trace: { from: "quiet" } };
          const screen = phase.screen();
          const note = onScreen ? `The rider just changed this on screen: ${onScreen.change.join("; ")}. The plan asks: ${onScreen.thought.join(" ")}` : undefined;
          const out = await chatTurn(model, chat, { ...(rider ? { rider } : {}), ...(note ? { note } : {}), screen, call: (t, a) => session.call(t, a) });
          return {
            text: out.text,
            first: out.first,
            context: [screen, ...(note ? [note] : [])],
            trace: { from: out.from, first: out.first, unsupported: out.unsupported, refused: out.refused, ms: out.ms, steps: out.steps },
          };
        },
      };
    },
  };
}
