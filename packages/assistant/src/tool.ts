/**
 * The assistant's tools (A2, D77): what the model calls instead of answering from its own knowledge (D38). Each wraps
 * the functions Dream's and Plan's screens use, so it can tell or change nothing the screen can't. It takes the rider's
 * words (town names, day and night numbers, months and dates), never our ids or route metres, and returns our own
 * wording with every number as the screen writes it, so the honesty check can hold an answer to it.
 */

/** A tool's arguments as JSON Schema: in A3 the model's call is constrained to it. */
export interface Schema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

/** A change the rider can choose (D77): it previews on screen, then applies; none applies by itself. */
export interface ToolOption<A> {
  id: string;
  label: string;
  /** What choosing it changes, in the screen's own words. */
  changes: string[];
  /** What the screen previews and applies. */
  apply: A;
}

export interface ToolResult<A = unknown> {
  /** What the tool found, in our own words (templates over the data, 11.6): the model may rephrase, never add. */
  lines: string[];
  /** The same facts, structured, with every number as the screen writes it. */
  facts: Record<string, unknown>;
  options?: ToolOption<A>[];
}

export interface Tool<C, A = unknown> {
  name: string;
  /** For the model: what it answers, and when to call it. */
  description: string;
  /** Some depend on the route (Dream's scenery themes). */
  parameters: (ctx: C) => Schema;
  run: (ctx: C, args: Record<string, unknown>) => ToolResult<A>;
}

export const schema = (properties: Record<string, unknown>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/** Arguments as the model gave them, read defensively: a missing or mistyped one is absent. */
export const arg = {
  str: (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" && a[k].trim() ? a[k].trim() : undefined),
  int: (a: Record<string, unknown>, k: string) => (typeof a[k] === "number" && Number.isInteger(a[k]) ? a[k] : undefined),
  bool: (a: Record<string, unknown>, k: string) => (typeof a[k] === "boolean" ? a[k] : undefined),
  list: (a: Record<string, unknown>, k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]) : undefined),
  obj: (a: Record<string, unknown>, k: string) => (a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? (a[k] as Record<string, unknown>) : undefined),
};

/** A result that says what went wrong in plain words, for the model to pass on or ask about. */
export const problem = (line: string, facts: Record<string, unknown> = {}): ToolResult<never> => ({ lines: [line], facts: { ok: false, ...facts } });

export const MONTHS_ENUM = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October" (or "Oct") to 0-11. */
export function monthIndex(name: string | undefined): number | null {
  if (!name) return null;
  const i = MONTHS_ENUM.findIndex((m) => m.toLowerCase().startsWith(name.trim().toLowerCase().slice(0, 3)));
  return i >= 0 ? i : null;
}
