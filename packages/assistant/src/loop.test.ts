import { describe, expect, it } from "vitest";
import { chatTurn, checkArgs, MAX_CALLS, startChat } from "./loop";
import { argsToJson, callText as gemmaCall, declaration, gemma4 } from "./model/gemma4";
import type { Conversation, Model, Step, ToolSpec } from "./model/model";
import { callText as qwenCall, qwen35 } from "./model/qwen35";
import type { ToolResult } from "./tool";

const days: ToolSpec = {
  name: "days",
  description: "One day of the plan.",
  parameters: { type: "object", properties: { day: { type: "integer", description: "The day's number." } }, additionalProperties: false },
};
const offer: ToolSpec = {
  name: "offer_options",
  description: "Offer changes.",
  parameters: {
    type: "object",
    properties: { changes: { type: "array", items: { type: "object", properties: { do: { type: "string", enum: ["add_rest", "set"] }, after_day: { type: "integer" } }, required: ["do"] } } },
    required: ["changes"],
    additionalProperties: false,
  },
};
const day4: ToolResult = { lines: ["Day 4, Fri 17 Sep: Tarragona → Sitges, 60 km, 4 h 35 riding, within your level."], facts: {} };
const nested = { changes: [{ do: "add_rest", after_day: 5 }] };

describe("Gemma 4's format (D97)", () => {
  it("declares a tool as its chat template does", () => {
    expect(declaration(days)).toBe(
      `<|tool>declaration:days{description:<|"|>One day of the plan.<|"|>,parameters:{properties:{day:{description:<|"|>The day's number.<|"|>,type:<|"|>INTEGER<|"|>}},type:<|"|>OBJECT<|"|>}}<tool|>`,
    );
    // An array's items keep every key, nested as far as they go.
    expect(declaration(offer)).toContain(
      `changes:{items:{properties:{after_day:{type:<|"|>INTEGER<|"|>},do:{enum:[<|"|>add_rest<|"|>,<|"|>set<|"|>],type:<|"|>STRING<|"|>}},required:[<|"|>do<|"|>],type:<|"|>OBJECT<|"|>},type:<|"|>ARRAY<|"|>}`,
    );
  });

  it("reads back the calls it writes, nested ones too", () => {
    for (const args of [{ day: 4 }, nested, { town: "l'Ampolla", on: true }]) {
      expect(gemma4.read(gemmaCall({ tool: "x", args }), [days]).calls).toEqual([{ tool: "x", args }]);
    }
    expect(JSON.parse(argsToJson(`{name:<|"|>Sant Adrià: de Besòs, {x}<|"|>,n:2}`))).toEqual({ name: "Sant Adrià: de Besòs, {x}", n: 2 });
    // A call cut short by a stop word, with its last brace missing.
    expect(gemma4.read(`<|tool_call>call:days{day:4`, [days]).calls).toEqual([{ tool: "days", args: { day: 4 } }]);
  });

  it("goes on after the tool results in the same turn, with an empty thought, and reads the answer without tags", () => {
    const c: Conversation = { prompt: "P", tools: [days], messages: [{ role: "user", text: "Q" }, { role: "model", calls: [{ tool: "days", args: { day: 4 }, result: "R" }] }] };
    expect(gemma4.render(c).endsWith(`<|tool_response>response:days{value:<|"|>R<|"|>}<tool_response|><|channel>thought\n<channel|>`)).toBe(true);
    expect(gemma4.render({ ...c, messages: [{ role: "user", text: "Q" }] }).endsWith("<|turn>user\nQ<turn|>\n<|turn>model\n")).toBe(true);
    expect(gemma4.read("Some thinking.<channel|>Day 4 is 60 km.", [days]).text).toBe("Day 4 is 60 km.");
    expect(gemma4.visible("<|tool_c")).toBe("");
    expect(gemma4.visible("Day 4 <|tool_call>call:")).toBe("Day 4 ");
  });
});

describe("Qwen3.5's format (D97)", () => {
  it("reads back the calls it writes, strings as written and the rest as JSON", () => {
    for (const args of [{ day: 4 }, nested]) expect(qwen35.read(qwenCall({ tool: "offer_options", args }), [days, offer]).calls).toEqual([{ tool: "offer_options", args }]);
    expect(qwen35.read(`<tool_call>\n<function=find>\n<parameter=name>\n4 Vents\n</parameter>\n</function>\n</tool_call>`, [{ ...days, name: "find", parameters: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } }]).calls).toEqual([
      { tool: "find", args: { name: "4 Vents" } },
    ]);
    expect(qwen35.read(`<tool_call>{"name": "days", "arguments": {"day": 2}}</tool_call>`, [days]).calls).toEqual([{ tool: "days", args: { day: 2 } }]);
    expect(qwen35.render({ prompt: "P", tools: [days], messages: [{ role: "user", text: "Q" }] }).endsWith("<|im_start|>assistant\n<think>\n\n</think>\n\n")).toBe(true);
  });
});

describe("a call's arguments against its schema", () => {
  it("fixes what's plain and says what's wrong", () => {
    expect(checkArgs(days, { day: "4" })).toEqual({ args: { day: 4 } });
    expect(checkArgs(days, { night: 4 })).toEqual({ problem: `days has no "night"; it takes day.` });
    expect(checkArgs(offer, {})).toEqual({ problem: "offer_options needs changes." });
  });
});

/** A model that says what it's told to, step by step. */
function scripted(steps: (Partial<Step> & { text?: string })[]): Model {
  let i = 0;
  return {
    name: "scripted",
    async next() {
      const s = steps[Math.min(i++, steps.length - 1)]!;
      return { calls: s.calls ?? [], text: s.text ?? "", unreadable: s.unreadable ?? [], stats: { ms: 1, firstTextMs: s.calls?.length ? null : 0 } };
    },
    async json() {
      return { value: null, text: "", stats: { ms: 1, firstTextMs: null } };
    },
  };
}
const turn = (model: Model) => chatTurn(model, startChat("P", [days]), { rider: "How long is day 4?", screen: "On screen: Plan, Tarragona → Sitges.", call: () => day4 });

describe("the loop (D81, D97)", () => {
  it("calls the tools, then answers from them", async () => {
    const out = await turn(scripted([{ calls: [{ tool: "days", args: { day: 4 } }] }, { text: "Day 4 is 60 km, 4 h 35 riding." }]));
    expect(out).toMatchObject({ text: "Day 4 is 60 km, 4 h 35 riding.", from: "model", calls: [{ tool: "days", args: { day: 4 } }] });
  });

  it("tries once more when the answer says what the tools didn't, then falls back to the tools' own lines", async () => {
    const retried = await turn(scripted([{ calls: [{ tool: "days", args: { day: 4 } }] }, { text: "Day 4 is about 37 miles." }, { text: "Day 4 is 60 km." }]));
    expect(retried).toMatchObject({ text: "Day 4 is 60 km.", from: "retry", first: "Day 4 is about 37 miles." });
    const fell = await turn(scripted([{ calls: [{ tool: "days", args: { day: 4 } }] }, { text: "Day 4 is about 37 miles." }]));
    expect(fell).toMatchObject({ text: day4.lines[0], from: "tools" });
  });

  it("counts on the screen's words as ours, and keeps only what the rider saw in the conversation", async () => {
    const chat = startChat("P", [days]);
    const out = await chatTurn(scripted([{ text: "You're planning Tarragona → Sitges." }]), chat, { rider: "What am I planning?", screen: "On screen: Plan, Tarragona → Sitges.", call: () => day4 });
    expect(out.from).toBe("model");
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "model"]);
  });

  it(`stops after ${MAX_CALLS} calls`, async () => {
    const out = await turn(scripted([{ calls: [{ tool: "days", args: { day: 4 } }] }]));
    expect(out.calls).toHaveLength(MAX_CALLS);
    expect(out.from).toBe("tools");
  });
});
