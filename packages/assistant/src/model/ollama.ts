/**
 * Ollama as a runtime (A3, D97): our text in, its text out, through its raw generate endpoint, so Ollama applies no
 * template and parses no tool calls of its own. Greedy decoding, so a run repeats (D52). A request's shape is forced by
 * its grammar from a JSON schema (D99). Runs in Node and the browser.
 */
import type { Runtime } from "./model";

export interface OllamaOptions {
  /** Ollama's name for the model: "gemma4:e2b". */
  model: string;
  host?: string;
  /** Tokens of context: the prompt, the tools and the conversation. */
  context?: number;
  /** Most tokens one step may write. */
  maxOutput?: number;
}

interface Chunk {
  response?: string;
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export function ollama({ model, host = "http://localhost:11434", context = 16384, maxOutput = 1024 }: OllamaOptions): Runtime {
  return {
    async complete(prompt, { stop, onText, signal, schema }) {
      const res = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          raw: true,
          stream: true,
          keep_alive: "30m",
          ...(schema ? { format: schema } : {}),
          options: { temperature: 0, top_k: 1, seed: 1, num_ctx: context, num_predict: maxOutput, stop },
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama: ${res.status} ${await res.text().catch(() => "")}`.trim());
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      let pending = "";
      let last: Chunk = {};
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const c = JSON.parse(line) as Chunk;
          if (c.error) throw new Error(`Ollama: ${c.error}`);
          if (c.response) {
            text += c.response;
            onText?.(c.response);
          }
          if (c.done) last = c;
        }
      }
      return {
        text,
        ...(last.prompt_eval_count !== undefined ? { promptTokens: last.prompt_eval_count } : {}),
        ...(last.eval_count !== undefined ? { outputTokens: last.eval_count } : {}),
      };
    },
  };
}
