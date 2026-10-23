/**
 * The honesty check (D38, D77, D81): before the rider sees an answer, every number and every name in it must come from
 * a tool result in the conversation or from the rider's own words. A number the model worked out (a sum, a count, a
 * conversion, a rounding) or a name it knew from elsewhere is unsupported, and the answer isn't shown: the model tries
 * once more, told which words failed, and then the tools' own lines stand in for it.
 *
 * It can't tell a real number put in the wrong place, or a wrong claim with no number or name in it: the question sets'
 * must-say and must-not-say facts catch those.
 */
import { fold } from "./names";
import type { ToolResult } from "./tool";

export interface Unsupported {
  /** The words as the answer has them. */
  text: string;
  kind: "number" | "time" | "percent" | "name";
}

export interface Check {
  ok: boolean;
  unsupported: Unsupported[];
}

/** What an answer may draw on: the conversation's tool results and the rider's own messages. */
export interface Sources {
  results: ToolResult<unknown>[];
  rider: string[];
}

const WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/**
 * Our own words, which any answer may use (D81): months, weekdays, the levels, our names for things, and the sites we
 * hand off to.
 */
const ALLOWED = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  "Leisurely", "Easy-moderate", "Moderate", "Challenging", "Tough",
  "Kilometrica", "Dream", "Plan", "Go", "Trip Pass", "EuroVelo", "EV", "GPX",
  "Booking.com", "Booking", "Expedia", "Google Maps", "Google", "Wikipedia", "Wikimedia Commons", "Commons", "Street View", "Mapillary", "Panoramax",
  "Apply", "Discard", "Undo", "Keep it", "Keep both", "Rest in", "I", "I'll", "I'm", "I've", "I'd",
].map(fold);

/** Ordinary words that start a sentence with a capital: never a name on their own. */
const STARTERS = new Set(
  `a an the yes no sure ok okay great good fine well so then also and but or if when while because since as at on in by for from to with without
after before between during about around over under along near through into out up down here there this that these those it its it's i
you your you'll you're you'd we we'd we'll we're our they their them what which who whose where why how all any both each every either
neither none some most many much more less few several only just even still yet already not never always usually often sometimes
perhaps maybe probably unfortunately fortunately otherwise however instead too very quite rather unless until once twice one first
next last other another same such let let's please thanks thank note choose pick tap keep try check see look ask ride rest stay stop
leave start add move book bring carry take make get come consider expect enjoy want would could should can will may might must
does do did is are was were be been has have had there's that's here's what's it'll i'm i'd i'll i've you've they're day days night
nights trip route stretch stretches option options water food morning afternoon evening today tomorrow typically usually mostly roughly
about nothing everything something anything search find call visit cycle head follow use set switch turn open tell remember allow
whether although though besides beyond within except done sorry certainly absolutely right local`
    .split(/\s+/)
    .map(fold),
);

/** Lower-case words that join the words of a place's name: "Castelló de la Plana", "Sant Adrià de Besòs". */
const JOINERS = new Set("de del della di da do dos das du des la le les el al l d sur sous en am an im der den von van y i e upon on".split(" "));

const TIME = /\b(\d{1,2}):(\d{2})\b/g;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** The numbers in a text: "1,463" is one; "2,3" (a list) is two; a decimal keeps its point. */
function numbers(text: string): { text: string; value: number }[] {
  const out: { text: string; value: number }[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const t = m[0].replace(/,$/, "");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) out.push({ text: t, value: Number(t.replaceAll(",", "")) });
    else for (const part of t.split(",").filter(Boolean)) out.push({ text: part, value: Number(part) });
  }
  return out;
}

/** Everything a source says, as one text: a tool result's lines and the strings and numbers of its facts. */
function textOf(r: ToolResult<unknown>): string {
  const parts: string[] = [...r.lines];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(r.facts);
  for (const o of r.options ?? []) parts.push(o.label, ...o.changes);
  return parts.join("\n");
}

/** What the sources allow: their numbers, times and percentages, and their words for names. */
function allowed(sources: Sources) {
  const text = [...sources.results.map(textOf), ...sources.rider].join("\n");
  const times = new Set<number>();
  for (const m of text.matchAll(TIME)) times.add(Number(m[1]) * 60 + Number(m[2]));
  const percents = new Set<number>();
  for (const m of text.matchAll(PERCENT)) percents.add(Number(m[1]));
  const values = new Set(numbers(text.replace(TIME, " ")).map((n) => n.value));
  for (const w of fold(text).split(" ")) if (WORDS[w] !== undefined) values.add(WORDS[w]);
  return { times, percents, values, words: ` ${fold(text)} ` };
}

/** The names in an answer: runs of capitalised words, with the small words that join a place's name. */
function names(answer: string): { text: string; start: boolean }[] {
  const out: { text: string; start: boolean }[] = [];
  // Words, keeping the punctuation that ends a sentence or a clause as its own token.
  const tokens = answer.replace(/[“”"()[\]]/g, " ").split(/\s+/).filter(Boolean);
  let run: string[] = [];
  let runStart = false;
  let sentenceStart = true;
  const flush = () => {
    while (run.length && JOINERS.has(fold(run[run.length - 1]!))) run.pop();
    // "Benicarló's": the name is Benicarló; "Lola's Tortas" keeps its own.
    if (run.length) run[run.length - 1] = run[run.length - 1]!.replace(/['’]s$/, "");
    if (run.length) out.push({ text: run.join(" "), start: runStart });
    run = [];
  };
  for (const raw of tokens) {
    const ends = /[.!?:;]$/.test(raw);
    const breaks = ends || /,$/.test(raw);
    const word = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d.'’-]+$/gu, "").replace(/\.$/, "");
    // "l'Ampolla", "d'Arrossa": the capital comes after the apostrophe. "°C" is a unit.
    const capital = (/^\p{Lu}/u.test(word) || /^[ld]['’]\p{Lu}/u.test(word)) && !raw.startsWith("°");
    if (capital && !/^\d/.test(word)) {
      if (!run.length) runStart = sentenceStart;
      run.push(word);
    } else if (run.length && JOINERS.has(fold(word)) && !breaks) {
      run.push(word);
    } else flush();
    if (breaks) flush();
    sentenceStart = ends || (/^\d+[.)]$/.test(raw) && sentenceStart);
  }
  flush();
  return out;
}

/**
 * A name as it stands once the ordinary words capitalised only because they start a sentence are set aside: "Stay in
 * Benicarló" is the name "Benicarló"; "Unfortunately" is none.
 */
function bare(name: { text: string; start: boolean }): string {
  const words = name.text.split(" ");
  // An ordinary word, or one that reads like one ("Avoiding", "Usually", "Planned"), capitalised only to start a sentence.
  const ordinary = (w: string) => STARTERS.has(fold(w)) || /^\p{Lu}\p{Ll}+(?:ing|ly|ed)$/u.test(w);
  if (name.start) while (words.length && ordinary(words[0]!)) words.shift();
  while (words.length && JOINERS.has(fold(words[0]!))) words.shift();
  return words.join(" ");
}

/** Whether a name may stand: the sources say it, or it's one of our own words, or a number word (checked as a number). */
function nameAllowed(text: string, words: string, extra: string[]): boolean {
  const f = fold(text);
  if (!f) return true;
  if (words.includes(` ${f} `)) return true;
  if ([...ALLOWED, ...extra].includes(f)) return true;
  const ws = f.split(" ");
  if (ws.every((w) => ALLOWED.includes(w) || JOINERS.has(w) || WORDS[w] !== undefined || w === "one")) return true;
  // "Bad Honnef on Sun": a name, then a joiner and our own words.
  for (let i = ws.length - 1; i > 0; i--) {
    const tail = ws.slice(i + 1);
    if (JOINERS.has(ws[i]!) && tail.length && tail.every((w) => ALLOWED.includes(w))) return nameAllowed(ws.slice(0, i).join(" "), words, extra);
  }
  return false;
}

/**
 * Check an answer against what it may draw on. `allow` adds words of our own for a phase (a route's name, say), never
 * facts.
 */
export function checkAnswer(answer: string, sources: Sources, allow: string[] = []): Check {
  const ok = allowed(sources);
  const unsupported: Unsupported[] = [];
  // A list's own numbering at the start of a line isn't a fact.
  let rest = answer.replace(/^\s*\d+[.)]\s/gm, " ");
  for (const m of rest.matchAll(TIME)) {
    if (!ok.times.has(Number(m[1]) * 60 + Number(m[2]))) unsupported.push({ text: m[0], kind: "time" });
  }
  rest = rest.replace(TIME, " ");
  for (const m of rest.matchAll(PERCENT)) {
    if (!ok.percents.has(Number(m[1]))) unsupported.push({ text: m[0].trim(), kind: "percent" });
  }
  rest = rest.replace(PERCENT, " ");
  for (const n of numbers(rest)) if (!ok.values.has(n.value)) unsupported.push({ text: n.text, kind: "number" });
  for (const w of rest.split(/[^\p{L}-]+/u)) {
    const v = WORDS[w.toLowerCase()];
    if (v !== undefined && !ok.values.has(v)) unsupported.push({ text: w, kind: "number" });
  }
  const extra = allow.map(fold);
  for (const n of names(answer)) {
    const text = bare(n);
    if (!nameAllowed(text, ok.words, extra)) unsupported.push({ text, kind: "name" });
  }
  return { ok: !unsupported.length, unsupported };
}

/** What the model is told when its answer fails, for its one more try (D77). */
export function retryNote(check: Check): string {
  const list = check.unsupported.map((u) => `"${u.text}"`).join(", ");
  return `These words in your answer don't come from the tools or the rider: ${list}. Answer again using only what the tools said, written as they wrote it: no rounding, adding up, counting or converting, and no names they didn't give.`;
}

/** What the rider sees when the second try fails too: the tools' own lines, which are templates over our data (D77). */
export function toolLines(results: ToolResult<unknown>[]): string {
  return results.flatMap((r) => r.lines).join("\n");
}
