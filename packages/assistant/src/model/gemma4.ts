/**
 * Gemma 4's chat format (D97), as Google documents it and its own chat template writes it: turns between `<|turn>` and
 * `<turn|>`, tools declared in the system turn, calls as `<|tool_call>call:name{…}<tool_call|>`, results as
 * `<|tool_response>response:name{…}<tool_response|>`, strings between `<|"|>`. Thinking is off (D97): the system turn
 * has no `<|think|>`. Written after Ollama's renderer and parser for it (v0.40.13), which follow the same template,
 * with one difference: after its tool results, E2B with thinking off ends its turn without a word (Ollama's own chat
 * does the same), so the prompt there opens an empty thought, as the template does for the larger Gemma 4s.
 */
import type { Schema } from "../tool";
import { type Conversation, type Format, type ModelCall, mayBecome, type ToolSpec } from "./model";

const Q = `<|"|>`;
const CALL = "<|tool_call>";
const CALL_END = "<tool_call|>";
const RESPONSE = "<|tool_response>";
const CHANNEL = "<|channel>";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const sorted = (o: object) => Object.keys(o).sort();
const typeName = (t: unknown) => (typeof t === "string" ? t.toUpperCase() : "");

/** A value inside a declaration: keys quoted. */
function schemaValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return Q + v + Q;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(schemaValue).join(",")}]`;
  return `{${sorted(v as object).map((k) => `${Q}${k}${Q}:${schemaValue((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

const STANDARD = new Set(["description", "type", "properties", "required", "nullable"]);

/** A schema's properties, each as `name:{description:…,enum:[…],items:{…},type:…}`. */
function properties(props: Record<string, unknown>): string {
  const out: string[] = [];
  for (const name of sorted(props)) {
    if (STANDARD.has(name)) continue;
    const p = props[name];
    if (!p || typeof p !== "object") continue;
    const prop = p as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof prop.description === "string" && prop.description) parts.push(`description:${Q}${prop.description}${Q}`);
    const type = typeName(prop.type);
    if (type === "STRING" && Array.isArray(prop.enum) && prop.enum.length) parts.push(`enum:[${prop.enum.map((e) => Q + String(e) + Q).join(",")}]`);
    if (type === "ARRAY" && prop.items && typeof prop.items === "object" && Object.keys(prop.items).length) parts.push(`items:{${items(prop.items as Record<string, unknown>)}}`);
    if (prop.nullable === true) parts.push("nullable:true");
    if (type === "OBJECT") {
      parts.push(`properties:{${properties((prop.properties ?? prop) as Record<string, unknown>)}}`);
      if (Array.isArray(prop.required) && prop.required.length) parts.push(`required:[${prop.required.map((r) => Q + String(r) + Q).join(",")}]`);
    }
    if (type) parts.push(`type:${Q}${type}${Q}`);
    out.push(`${name}:{${parts.join(",")}}`);
  }
  return out.join(",");
}

/** An array's items: every key, sorted. */
function items(spec: Record<string, unknown>): string {
  const out: string[] = [];
  for (const key of sorted(spec)) {
    const v = spec[key];
    if (v === null || v === undefined) continue;
    if (key === "properties") out.push(`properties:{${properties(v as Record<string, unknown>)}}`);
    else if (key === "required") out.push(`required:[${(v as unknown[]).map((r) => Q + String(r) + Q).join(",")}]`);
    else if (key === "type") out.push(`type:${Q}${typeName(v)}${Q}`);
    else out.push(`${key}:${schemaValue(v)}`);
  }
  return out.join(",");
}

export function declaration(tool: ToolSpec): string {
  const s: Schema = tool.parameters;
  const parts: string[] = [];
  if (Object.keys(s.properties).length) parts.push(`properties:{${properties(s.properties)}}`);
  if (s.required?.length) parts.push(`required:[${s.required.map((r) => Q + r + Q).join(",")}]`);
  parts.push(`type:${Q}${typeName(s.type)}${Q}`);
  return `<|tool>declaration:${tool.name}{description:${Q}${tool.description}${Q},parameters:{${parts.join(",")}}}<tool|>`;
}

/** A value in a call or a response: keys bare. */
function argValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return Q + v + Q;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(argValue).join(",")}]`;
  return `{${sorted(v as object).map((k) => `${k}:${argValue((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export const callText = (c: ModelCall) => `${CALL}call:${c.tool}${argValue(c.args)}${CALL_END}`;
const responseText = (tool: string, result: string) => `${RESPONSE}response:${tool}{value:${Q}${result}${Q}}<tool_response|>`;

function render(c: Conversation): string {
  let s = `<bos><|turn>system\n${c.prompt.trim()}${c.tools.map(declaration).join("")}<turn|>\n`;
  let open = false;
  c.messages.forEach((m, i) => {
    const next = c.messages[i + 1];
    if (m.role === "user") {
      s += `<|turn>user\n${m.text.trim()}<turn|>\n`;
      open = false;
      return;
    }
    if (!open) s += "<|turn>model\n";
    open = true;
    if ("calls" in m) {
      s += m.calls.map((k) => callText(k) + responseText(k.tool, k.result)).join("");
      // The model's turn goes on after its results, unless the rider speaks next.
      if (next?.role === "user") {
        s += "<turn|>\n";
        open = false;
      }
    } else {
      s += `${m.text}<turn|>\n`;
      open = false;
    }
  });
  // Open for the model: a new turn, or its turn going on after its results with an empty thought.
  return s + (open ? `${CHANNEL}thought\n<channel|>` : "<|turn>model\n");
}

/** Gemma 4's arguments (`{day:4,town:<|"|>Sitges<|"|>}`) as JSON. */
export function argsToJson(s: string): string {
  const strings: string[] = [];
  let text = s.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_, v: string) => `\u0000${strings.push(v) - 1}\u0000`);
  text = text.replace(/([{,]\s*)([\p{L}\p{N}_]+)(\s*):/gu, '$1"$2"$3:');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => JSON.stringify(strings[Number(i)]));
}

function parseCall(body: string): ModelCall | null {
  const m = /^\s*call:([\w.-]+)\s*(\{[\s\S]*)$/.exec(body);
  if (!m) return null;
  const tries = [m[2]!, `${m[2]!}}`, `${m[2]!}${Q}}`];
  for (const t of tries) {
    try {
      const args = JSON.parse(argsToJson(t.trim()));
      if (args && typeof args === "object" && !Array.isArray(args)) return { tool: m[1]!, args: args as Record<string, Json> };
    } catch {
      // try the next repair
    }
  }
  return null;
}

/** The answer's words: everything outside calls and thinking (a thought may come without its opening tag). */
function words(output: string): string {
  const close = output.lastIndexOf("<channel|>");
  return (close >= 0 && !output.slice(0, close).includes(CHANNEL) ? output.slice(close + "<channel|>".length) : output)
    .replace(/<\|tool_call>[\s\S]*?(<tool_call\|>|$)/g, "")
    .replace(/<\|channel>[\s\S]*?(<channel\|>|$)/g, "")
    .replaceAll(RESPONSE, "")
    .replaceAll(CALL_END, "")
    .replace(/<turn\|>\s*$/, "")
    .trim();
}

export const gemma4: Format = {
  render,
  stop: ["<turn|>", RESPONSE],
  visible(output) {
    let cut = output.length;
    for (const tag of [CALL, CHANNEL]) {
      const i = output.indexOf(tag);
      if (i >= 0) cut = Math.min(cut, i);
    }
    let shown = output.slice(0, cut);
    // Hold back what may yet become a tag.
    const lt = shown.lastIndexOf("<");
    if (lt >= 0 && (mayBecome(shown.slice(lt), CALL) || mayBecome(shown.slice(lt), CHANNEL))) shown = shown.slice(0, lt);
    return shown.trimStart();
  },
  read(output, _tools: ToolSpec[]) {
    const calls: ModelCall[] = [];
    const unreadable: string[] = [];
    for (const m of output.matchAll(/<\|tool_call>([\s\S]*?)(?:<tool_call\|>|$)/g)) {
      const call = parseCall(m[1]!);
      if (call) calls.push(call);
      else unreadable.push(m[1]!.trim());
    }
    return { calls, text: words(output), unreadable };
  },
};
