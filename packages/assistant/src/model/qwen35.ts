/**
 * Qwen3.5's chat format (D97), as its chat template writes it: `<|im_start|>`…`<|im_end|>` turns, the tools as JSON in
 * the system turn with the template's own instructions, calls as `<tool_call><function=name><parameter=key>value…`,
 * results in a user turn between `<tool_response>` tags. Thinking is off (D97): the answer opens with an empty
 * `<think>` block. Written after Ollama's renderer and parser for it (v0.40.13), which follow the same template.
 */
import { type Conversation, type Format, type ModelCall, mayBecome, type ToolSpec } from "./model";

const CALL = "<tool_call>";
const THINK = "<think>";

const TOOLS_END = `
</tools>

If you choose to call a function ONLY reply in the following format with NO suffix:

<tool_call>
<function=example_function_name>
<parameter=example_parameter_1>
value_1
</parameter>
<parameter=example_parameter_2>
This is the value for the second parameter
that can span
multiple lines
</parameter>
</function>
</tool_call>

<IMPORTANT>
Reminder:
- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags
- Required parameters MUST be specified
- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after
- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls
</IMPORTANT>`;

/** JSON as the template's `tojson` writes it: a space after each colon and comma. */
function spaced(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(spaced).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${spaced(x)}`).join(", ")}}`;
  return JSON.stringify(v ?? null);
}

const toolJson = (t: ToolSpec) => spaced({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } });
const argText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export const callText = (c: ModelCall) =>
  `${CALL}\n<function=${c.tool}>\n${Object.entries(c.args).map(([k, v]) => `<parameter=${k}>\n${argText(v)}\n</parameter>\n`).join("")}</function>\n</tool_call>`;

function render(c: Conversation): string {
  let s = `<|im_start|>system\n# Tools\n\nYou have access to the following functions:\n\n<tools>${c.tools.map((t) => `\n${toolJson(t)}`).join("")}${TOOLS_END}\n\n${c.prompt.trim()}<|im_end|>\n`;
  for (const m of c.messages) {
    if (m.role === "user") s += `<|im_start|>user\n${m.text.trim()}<|im_end|>\n`;
    else if ("calls" in m) {
      s += `<|im_start|>assistant\n${m.calls.map(callText).join("\n")}<|im_end|>\n`;
      s += `<|im_start|>user${m.calls.map((k) => `\n<tool_response>\n${k.result}\n</tool_response>`).join("")}<|im_end|>\n`;
    } else s += `<|im_start|>assistant\n${m.text.trim()}<|im_end|>\n`;
  }
  return `${s}<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

/** A parameter's value: as written for a string, else read as JSON. */
function value(raw: string, prop: unknown): unknown {
  const type = prop && typeof prop === "object" ? (prop as { type?: unknown }).type : undefined;
  if (type === "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseCall(body: string, tools: ToolSpec[]): ModelCall | null {
  // The template's own form, and the JSON form earlier Qwens wrote.
  const fn = /<function=([^>\n]+)>([\s\S]*?)(?:<\/function>|$)/.exec(body);
  if (fn) {
    const tool = fn[1]!.trim();
    const props = tools.find((t) => t.name === tool)?.parameters.properties ?? {};
    const args: Record<string, unknown> = {};
    for (const p of fn[2]!.matchAll(/<parameter=([^>\n]+)>\n?([\s\S]*?)\n?(?:<\/parameter>|(?=<parameter=)|$)/g)) {
      const key = p[1]!.trim();
      args[key] = value(p[2]!.trim(), props[key]);
    }
    return { tool, args };
  }
  try {
    const j = JSON.parse(body.trim()) as { name?: unknown; arguments?: unknown };
    if (typeof j.name === "string") return { tool: j.name, args: j.arguments && typeof j.arguments === "object" ? (j.arguments as Record<string, unknown>) : {} };
  } catch {
    // unreadable
  }
  return null;
}

function words(output: string): string {
  return output
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "")
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .trim();
}

export const qwen35: Format = {
  render,
  stop: ["<|im_end|>", "<|endoftext|>", "<tool_response>"],
  visible(output) {
    let cut = output.length;
    for (const tag of [CALL, THINK]) {
      const i = output.indexOf(tag);
      if (i >= 0) cut = Math.min(cut, i);
    }
    let shown = output.slice(0, cut);
    const lt = shown.lastIndexOf("<");
    if (lt >= 0 && (mayBecome(shown.slice(lt), CALL) || mayBecome(shown.slice(lt), THINK))) shown = shown.slice(0, lt);
    return shown.trimStart();
  },
  read(output, tools) {
    const calls: ModelCall[] = [];
    const unreadable: string[] = [];
    for (const m of output.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g)) {
      const call = parseCall(m[1]!, tools);
      if (call) calls.push(call);
      else unreadable.push(m[1]!.trim());
    }
    return { calls, text: words(output), unreadable };
  },
};
