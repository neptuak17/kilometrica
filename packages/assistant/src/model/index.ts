/**
 * The models A3 scored (D91, D97, D100): Gemma 4 E2B, and E4B if it's ever needed, each in Gemma 4's own format run by
 * Ollama on the laptop. Qwen3.5 was dropped (D100) and its format removed (D103).
 */
import { gemma4 } from "./gemma4";
import { type Format, type Model, makeModel } from "./model";
import { ollama, type OllamaOptions } from "./ollama";

export const MODELS: Record<string, { format: Format; ollama: string }> = {
  "gemma4-e2b": { format: gemma4, ollama: "gemma4:e2b" },
  "gemma4-e4b": { format: gemma4, ollama: "gemma4:e4b" },
};

/** A model by our name for it, run by Ollama. */
export function ollamaModel(name: string, options: Omit<OllamaOptions, "model"> = {}): Model {
  const m = MODELS[name];
  if (!m) throw new Error(`No model called ${name}: ${Object.keys(MODELS).join(", ")}`);
  return makeModel(name, m.format, ollama({ ...options, model: m.ollama }));
}

export * from "./model";
export { gemma4 } from "./gemma4";
export { ollama } from "./ollama";
