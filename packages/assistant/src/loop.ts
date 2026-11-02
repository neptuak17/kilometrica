/**
 * The conversation loop (A3, D81, D90): ours, written once, for the harness and the chat beside Dream and Plan. The
 * rider's words and what's on screen go in; the model calls the phase's tools, at most four a turn; its answer goes
 * through the honesty check, with one retry naming the failing words, and then the tools' own lines stand in for it.
 * Options come only from the tools (D77): the loop never changes anything itself.
 */
import { checkAnswer, retryNote, toolLines } from "./honesty";
import type { Conversation, Message, Model, ModelCall, StepStats, ToolSpec } from "./model/model";
import type { Schema, Tool, ToolResult } from "./tool";

/** Tool calls a turn may make before the answer must come (D97). */
export const MAX_CALLS = 4;

/** A conversation beside Dream or Plan, kept across turns. */
export interface Chat {
  prompt: string;
  tools: ToolSpec[];
  messages: Message[];
  /** What an answer may draw on (D81): every tool result so far and our own words on screen, and the rider's words. */
  results: ToolResult<unknown>[];
  rider: string[];
}

export const startChat = (prompt: string, tools: ToolSpec[]): Chat => ({ prompt, tools, messages: [], results: [], rider: [] });

/** A phase's tools as the model sees them. */
export const toolSpecs = <C>(tools: Tool<C, unknown>[], ctx: C): ToolSpec[] => tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters(ctx) }));

export interface TurnIn {
  /** The rider's words. */
  rider?: string;
  /** Or, after a change made on screen, our words on it: the change and the second thought it raised (D77). */
  note?: string;
  /** What's on screen, in our words. */
  screen: string;
  /** Runs one of the phase's tools on the screen's state. */
  call: (tool: string, args: Record<string, unknown>) => ToolResult<unknown>;
  signal?: AbortSignal;
}

export interface TurnOut {
  text: string;
  /** The model's answer, its one retry, or the tools' own lines (D81). */
  from: "model" | "retry" | "tools";
  /** The model's first answer, before any retry: D77 scores honesty on it. */
  first: string | null;
  calls: ModelCall[];
  results: ToolResult<unknown>[];
  /** Calls the model tried to make that couldn't be read, or that broke a tool's schema. */
  refused: string[];
  /** The words that failed the honesty check, for each answer that failed it. */
  unsupported: string[][];
  ms: { firstWords: number | null; full: number };
  steps: StepStats[];
}

/** A call's arguments against the tool's schema: fixed where the meaning is plain ("4" for 4), else what's wrong. */
export function checkArgs(tool: ToolSpec, args: Record<string, unknown>): { args: Record<string, unknown> } | { problem: string } {
  const s: Schema = tool.parameters;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const p = s.properties[k] as { type?: string; enum?: unknown[] } | undefined;
    if (!p) return { problem: `${tool.name} has no "${k}"; it takes ${Object.keys(s.properties).join(", ") || "nothing"}.` };
    let x = v;
    if ((p.type === "integer" || p.type === "number") && typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim())) x = Number(x);
    if (p.type === "boolean" && (x === "true" || x === "false")) x = x === "true";
    if (p.type === "string" && typeof x === "number") x = String(x);
    if (p.enum && !p.enum.includes(x)) return { problem: `${tool.name}'s "${k}" is one of ${p.enum.map(String).join(", ")}.` };
    out[k] = x;
  }
  const missing = (s.required ?? []).filter((k) => out[k] === undefined);
  if (missing.length) return { problem: `${tool.name} needs ${missing.join(" and ")}.` };
  return { args: out };
}

/** A tool's result as the model reads it: its lines, in our words. */
const resultText = (r: ToolResult<unknown>) => r.lines.join("\n");

/** One turn of the conversation: the rider's message, or a change made on screen. */
export async function chatTurn(model: Model, chat: Chat, input: TurnIn): Promise<TurnOut> {
  const start = performance.now();
  const kept = chat.messages.length;
  const words = input.rider ?? input.note ?? "";
  chat.messages.push({ role: "user", text: `[${input.screen}]\n${words}` });
  if (input.rider) chat.rider.push(input.rider);
  chat.results.push({ lines: [input.screen, ...(input.note ? [input.note] : [])], facts: {} });

  const calls: ModelCall[] = [];
  const results: ToolResult<unknown>[] = [];
  const refused: string[] = [];
  const steps: StepStats[] = [];
  const conversation = (): Conversation => ({ prompt: chat.prompt, tools: chat.tools, messages: chat.messages });

  /** Steps until the model answers; null if it runs out of calls first. */
  async function answer(): Promise<{ text: string; at: number; firstText: number | null } | null> {
    for (;;) {
      const at = performance.now() - start;
      const step = await model.next(conversation(), undefined, input.signal);
      steps.push(step.stats);
      if (!step.calls.length && !step.unreadable.length) return { text: step.text, at, firstText: step.stats.firstTextMs };
      if (calls.length + refused.length >= MAX_CALLS) return null;
      if (step.unreadable.length && !step.calls.length) {
        refused.push(...step.unreadable);
        chat.messages.push({ role: "model", text: step.text }, { role: "user", text: "Your tool call couldn't be read. Write it exactly in the format given, or answer." });
        continue;
      }
      const made: (ModelCall & { result: string })[] = [];
      for (const k of step.calls.slice(0, MAX_CALLS - calls.length - refused.length)) {
        const spec = chat.tools.find((t) => t.name === k.tool);
        const checked = spec ? checkArgs(spec, k.args) : { problem: `There's no tool called ${k.tool}.` };
        if ("problem" in checked) {
          refused.push(`${k.tool} ${JSON.stringify(k.args)}: ${checked.problem}`);
          made.push({ ...k, result: checked.problem });
          continue;
        }
        const r = input.call(k.tool, checked.args);
        calls.push({ tool: k.tool, args: checked.args });
        results.push(r);
        chat.results.push(r);
        made.push({ tool: k.tool, args: checked.args, result: resultText(r) });
      }
      chat.messages.push({ role: "model", calls: made });
    }
  }

  let first: string | null = null;
  let final: { text: string; from: TurnOut["from"]; firstWords: number | null } | null = null;
  const unsupported: string[][] = [];
  for (let attempt = 0; attempt < 2 && !final; attempt++) {
    const a = await answer();
    if (!a) break;
    if (attempt === 0) first = a.text;
    const check = checkAnswer(a.text, { results: chat.results, rider: chat.rider });
    if (check.ok) final = { text: a.text, from: attempt ? "retry" : "model", firstWords: a.firstText === null ? null : a.at + a.firstText };
    else {
      unsupported.push(check.unsupported.map((u) => u.text));
      chat.messages.push({ role: "model", text: a.text }, { role: "user", text: retryNote(check) });
    }
  }
  const full = performance.now() - start;
  if (!final) final = { text: toolLines(results), from: "tools", firstWords: full };

  // What the conversation keeps: the rider's message, the calls with their results, and the answer the rider saw.
  const turn = chat.messages.slice(kept + 1).filter((m) => "calls" in m);
  chat.messages.splice(kept + 1, Infinity, ...turn, { role: "model", text: final.text });
  return { text: final.text, from: final.from, first, calls, results, refused, unsupported, ms: { firstWords: final.firstWords, full }, steps };
}
