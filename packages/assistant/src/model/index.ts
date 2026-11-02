/**
 * The models A3 scores (D91, D97): Gemma 4 E2B first, Qwen3.5 2B alongside, and the 4B sizes only if E2B misses D77's
 * bars after three rounds of tuning. Each is its family's format run by Ollama on the laptop.
 */
import { gemma4 } from "./gemma4";
import { type Format, type Model, makeModel } from "./model";
import { ollama, type OllamaOptions } from "./ollama";
import { qwen35 } from "./qwen35";

export const MODELS: Record<string, { format: Format; ollama: string }> = {
  "gemma4-e2b": { format: gemma4, ollama: "gemma4:e2b" },
  "qwen3.5-2b": { format: qwen35, ollama: "qwen3.5:2b" },
  "gemma4-e4b": { format: gemma4, ollama: "gemma4:e4b" },
  "qwen3.5-4b": { format: qwen35, ollama: "qwen3.5:4b" },
};

/** A model by our name for it, run by Ollama. */
export function ollamaModel(name: string, options: Omit<OllamaOptions, "model"> = {}): Model {
  const m = MODELS[name];
  if (!m) throw new Error(`No model called ${name}: ${Object.keys(MODELS).join(", ")}`);
  return makeModel(name, m.format, ollama({ ...options, model: m.ollama }));
}

export * from "./model";
export { gemma4 } from "./gemma4";
export { qwen35 } from "./qwen35";
export { ollama } from "./ollama";
