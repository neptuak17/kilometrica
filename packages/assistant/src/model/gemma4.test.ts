import { describe, expect, it } from "vitest";
import { argsToJson, callText as gemmaCall, declaration, gemma4 } from "./gemma4";
import type { Conversation, ToolSpec } from "./model";

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
