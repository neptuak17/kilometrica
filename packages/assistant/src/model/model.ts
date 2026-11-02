/**
 * The model connection (A3, D90, D97): one small interface the loop talks to, whatever runs the model. Our own code
 * writes each model's documented chat and tool-call format (a `Format`) and reads the calls back, so a runtime only
 * turns text into text (a `Runtime`). Changing the model is a format; moving where it runs is a runtime and a re-score.
 */
import type { Schema } from "../tool";

/** A tool as the model sees it: its name, what it answers and its arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Schema;
}

export interface ModelCall {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * The conversation as the loop keeps it. A user message is the rider's words, or a note from the loop (a change made on
 * screen, a retry); a model message is either its tool calls, each with the result it got in our words, or its answer.
 */
export type Message =
  | { role: "user"; text: string }
  | { role: "model"; calls: (ModelCall & { result: string })[] }
  | { role: "model"; text: string };

export interface Conversation {
  /** The phase's prompt (`prompts/<language>/<phase>.md`). */
  prompt: string;
  tools: ToolSpec[];
  messages: Message[];
}

/** What a runtime measured for one step, as far as it can say. */
export interface StepStats {
  ms: number;
  /** From the step's start to its first words of an answer (none for a step that only calls tools). */
  firstTextMs: number | null;
  promptTokens?: number;
  outputTokens?: number;
}

/** The model's next move: tool calls, or an answer. */
export interface Step {
  calls: ModelCall[];
  /** The answer, or any words written alongside the calls. */
  text: string;
  /** Calls it tried to make that couldn't be read. */
  unreadable: string[];
  stats: StepStats;
}

export interface Model {
  name: string;
  /** One step on the conversation; an answer's words stream through `onText` as they come. */
  next(c: Conversation, onText?: (chunk: string) => void, signal?: AbortSignal): Promise<Step>;
  /** One step whose output the runtime forces to a JSON schema (D99): the value, or null if it can't be read. */
  json(c: Conversation, schema: object, signal?: AbortSignal): Promise<{ value: unknown; text: string; stats: StepStats }>;
}

/** A model family's documented chat format: the prompt it expects, and its output read back. */
export interface Format {
  /** The whole conversation as the model expects it, open for the model's next words. */
  render(c: Conversation): string;
  /** Where the runtime should stop. */
  stop: string[];
  /** How much of the output so far is an answer's words, as opposed to a tool call being written. */
  visible(output: string): string;
  read(output: string, tools: ToolSpec[]): { calls: ModelCall[]; text: string; unreadable: string[] };
}

/** A runtime: text in, text out, streamed. */
export interface Runtime {
  complete(
    prompt: string,
    opts: { stop: string[]; onText?: (chunk: string) => void; signal?: AbortSignal; schema?: object },
  ): Promise<{ text: string; promptTokens?: number; outputTokens?: number }>;
}

/** A model: its format, run by a runtime. */
export function makeModel(name: string, format: Format, runtime: Runtime): Model {
  return {
    name,
    async next(c, onText, signal) {
      const start = performance.now();
      let output = "";
      let shown = 0;
      let firstTextMs: number | null = null;
      const out = await runtime.complete(format.render(c), {
        stop: format.stop,
        signal,
        onText(chunk) {
          output += chunk;
          const visible = format.visible(output);
          if (visible.length > shown) {
            if (firstTextMs === null && visible.trim()) firstTextMs = performance.now() - start;
            onText?.(visible.slice(shown));
            shown = visible.length;
          }
        },
      });
      const read = format.read(out.text, c.tools);
      return {
        ...read,
        stats: {
          ms: performance.now() - start,
          firstTextMs: read.calls.length ? null : firstTextMs,
          ...(out.promptTokens !== undefined ? { promptTokens: out.promptTokens } : {}),
          ...(out.outputTokens !== undefined ? { outputTokens: out.outputTokens } : {}),
        },
      };
    },
    async json(c, schema, signal) {
      const start = performance.now();
      const out = await runtime.complete(format.render(c), { stop: format.stop, schema, ...(signal ? { signal } : {}) });
      let value: unknown = null;
      try {
        value = JSON.parse(out.text);
      } catch {
        // Forced to the schema, it reads; cut short (the output limit), it may not.
      }
      return {
        value,
        text: out.text,
        stats: {
          ms: performance.now() - start,
          firstTextMs: null,
          ...(out.promptTokens !== undefined ? { promptTokens: out.promptTokens } : {}),
          ...(out.outputTokens !== undefined ? { outputTokens: out.outputTokens } : {}),
        },
      };
    },
  };
}

/** Whether `text` could still become `tag` as more is written. */
export const mayBecome = (text: string, tag: string) => tag.startsWith(text);
