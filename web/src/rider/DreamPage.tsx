/**
 * Dream for riders (11.7, D48): which stretch suits me, when, and which way (D35). It opens on the whole route: its
 * length, its countries and when each is good to ride, on a map of all of it. The rider starts from an example or
 * the chips; stretches appear once their level and days are known (nothing is assumed). Every stretch that fits is
 * counted, the best three are shown, two can be compared, and any stretch can be picked by hand. "Plan this" opens
 * Plan. Everything comes from the route's free files (D35); the audit viewer's Dream tab stays, for us (D43). The
 * question lives in the address, so a search can be shared or reopened.
 */
import type { DailySection, DreamFile, DreamSection } from "@dpg/contracts";
import { describeStretch, type DreamQuery, findStretches, type Pref, type StretchResult, type SurfaceKind } from "@dpg/dream";
import { country, km, MONTHS, MONTHS_LONG } from "@dpg/planner";
import { useEffect, useMemo, useState } from "react";
import { loadDreamFiles, type DreamFiles } from "./data";
import { DreamMap, type MapStretch } from "./DreamMap";
import { useRouteList } from "./routes";
import "./rider.css";

type Level = DreamFile["levels"][number];
type ChipId = "level" | "days" | "month" | "surfaces" | "scenery" | "stay" | "direction";

/** The rider's answers. Level and days start unset: no stretch is shown until the rider gives them. */
interface Ask extends Omit<DreamQuery, "level" | "days" | "limit"> {
  level: number | null;
  days: number | null;
}

const EMPTY: Ask = {
  level: null,
  days: null,
  month: null,
  surfaces: { road: "ok", cycle_path: "ok", gravel: "ok" },
  themes: [],
  trainBothEnds: false,
  stay: "any",
  avoidBusy: false,
  direction: "either",
};

/** Starting points: a whole question in one tap, changed from there. */
const EXAMPLES: { title: string; sub: string; q: Partial<Ask> }[] = [
  {
    title: "A week of coast and villages",
    sub: "Easy, rooms, quiet roads, a train at both ends",
    q: { level: 2, days: 7, themes: ["coast", "heritage"], trainBothEnds: true, stay: "rooms", avoidBusy: true, surfaces: { road: "ok", cycle_path: "prefer", gravel: "ok" } },
  },
  { title: "A long weekend by the sea", sub: "Easy, three days, a train at both ends", q: { level: 2, days: 3, themes: ["coast"], trainBothEnds: true } },
  { title: "Ten days of wine and towns", sub: "Moderate, rooms", q: { level: 3, days: 10, themes: ["wine", "culture"], stay: "rooms" } },
  { title: "Two weeks in the hills", sub: "Challenging, mountains and viewpoints", q: { level: 4, days: 14, themes: ["mountains", "viewpoints"] } },
];

const SURFACES: { key: SurfaceKind; label: string; url: string }[] = [
  { key: "cycle_path", label: "cycle paths", url: "paths" },
  { key: "road", label: "roads", url: "road" },
  { key: "gravel", label: "gravel", url: "gravel" },
];
const PREFS: Pref[] = ["prefer", "ok", "avoid"];
const STAY = { any: "Rooms or camping", rooms: "Rooms", camping: "Camping" } as const;
const WAY = { either: "Either way", forward: "With the route", reverse: "Against the route" } as const;
const SHOWN = 3;
const MORE = 5;

// --- the question in the address ---------------------------------------------------------------------------

function readAsk(p: URLSearchParams): Ask {
  const int = (k: string, lo: number, hi: number) => {
    const raw = p.get(k);
    const v = Number(raw);
    return raw !== null && raw !== "" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  };
  const pref = (k: string): Pref => (PREFS.includes(p.get(k) as Pref) ? (p.get(k) as Pref) : "ok");
  const stay = p.get("stay");
  const way = p.get("way");
  return {
    level: int("level", 1, 5),
    days: int("days", 1, 60),
    month: int("month", 0, 11),
    surfaces: { road: pref("road"), cycle_path: pref("paths"), gravel: pref("gravel") },
    themes: (p.get("themes") ?? "").split(",").filter(Boolean),
    trainBothEnds: p.get("train") === "1",
    stay: stay === "rooms" || stay === "camping" ? stay : "any",
    avoidBusy: p.get("busy") === "1",
    direction: way === "forward" || way === "reverse" ? way : "either",
  };
}

function addressOf(route: string, a: Ask): string {
  const p = new URLSearchParams({ route });
  if (a.level !== null) p.set("level", String(a.level));
  if (a.days !== null) p.set("days", String(a.days));
  if (a.month !== null) p.set("month", String(a.month));
  for (const s of SURFACES) if (a.surfaces[s.key] !== "ok") p.set(s.url, a.surfaces[s.key]);
  if (a.themes.length) p.set("themes", a.themes.join(","));
  if (a.trainBothEnds) p.set("train", "1");
  if (a.stay !== "any") p.set("stay", a.stay);
  if (a.avoidBusy) p.set("busy", "1");
  if (a.direction !== "either") p.set("way", a.direction);
  return `/dream?${p}`;
}

// --- wording ------------------------------------------------------------------------------------------------

const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function surfacesText(a: Ask): string {
  const of = (p: Pref) => SURFACES.filter((s) => a.surfaces[s.key] === p).map((s) => s.label);
  const parts = [of("prefer").length ? `Prefer ${and(of("prefer"))}` : "", of("avoid").length ? `avoid ${and(of("avoid"))}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "Any surface";
}

/** A point between daily sections: a town, else its km. */
interface Point {
  name: string;
  m: number;
}

function pointsOf(sections: DreamSection[], daily: Map<number, DailySection>): Point[] {
  const name = (n: string | null | undefined, m: number) => n ?? `km ${Math.round(m / 1000)}`;
  const out = sections.map((s) => ({ name: name(daily.get(s.number)?.start_name, s.from_m), m: s.from_m }));
  const last = sections[sections.length - 1];
  if (last) out.push({ name: name(daily.get(last.number)?.end_name, last.to_m), m: last.to_m });
  return out;
}

function stretchName(daily: Map<number, DailySection>, r: StretchResult): string {
  const a = daily.get(r.first);
  const b = daily.get(r.last);
  const start = r.way === "forward" ? { name: a?.start_name, m: a?.from_m } : { name: b?.end_name, m: b?.to_m };
  const end = r.way === "forward" ? { name: b?.end_name, m: b?.to_m } : { name: a?.start_name, m: a?.from_m };
  const label = (e: { name?: string | null; m?: number }) => e.name ?? (e.m === undefined ? "?" : `km ${Math.round(e.m / 1000)}`);
  return `${label(start)} → ${label(end)}`;
}

const keyOf = (r: StretchResult) => `${r.first}-${r.last}-${r.way}`;
const OWN = "own";

/** The matchmaker's why lines, less the two the card already shows as facts: the grade and the month's scores. */
const whyLines = (r: StretchResult) => r.why.filter((w) => !/: grade (at least )?\d/.test(w) && !/best-time \d+$/.test(w));

const climbText = (r: StretchResult) =>
  r.climbPerDay !== null ? `↑ ${r.climbPerDay} m a day` : r.climbMinPerDay !== null ? `↑ at least ${r.climbMinPerDay} m a day` : "climbing unknown";

const gradeText = (r: StretchResult, levels: Level[]) => `${r.gradeAtLeast ? "at least " : ""}${levels.find((l) => l.level === r.grade)?.name ?? `level ${r.grade}`}`;

function whenText(r: StretchResult, a: Ask): string | null {
  if (r.month === null) return null;
  const score = r.bestTime === null ? "" : `: best-time ${r.bestTime} of 100`;
  return a.month === null ? `Best in ${MONTHS_LONG[r.month]}${score}` : `In ${MONTHS_LONG[r.month]}${score}`;
}

/** Plan opens the stretch with the rider's answers (D48). */
function planHref(route: string, r: StretchResult, a: Ask, level: number): string {
  return `/plan?${new URLSearchParams({
    route,
    first: String(r.first),
    last: String(r.last),
    way: r.way,
    days: String(r.days),
    month: String(a.month ?? r.month ?? ""),
    level: String(level),
    gravel: a.surfaces.gravel,
    busy: a.avoidBusy ? "1" : "0",
    stay: a.stay,
  })}`;
}

/** Red (a poor time) to green (a good one) for a best-time score: the spread is stretched over 40–90, where scores lie. */
const tint = (v: number) => `hsl(${Math.round(120 * Math.max(0, Math.min(1, (v - 40) / 50)))}, 60%, 68%)`;

/** "7,347" */
const whole = (k: number) => Math.round(k).toLocaleString("en-GB");

// --- pieces ---------------------------------------------------------------------------------------------------

/** The whole route before any question: length, countries in route order, and when each is good to ride. */
function Glance({ name, sections, month, onMonth }: { name: string; sections: DreamSection[]; month: number | null; onMonth: (m: number | null) => void }) {
  const rows = useMemo(() => {
    const by = new Map<string, DreamSection[]>();
    for (const s of sections) {
      const cc = s.country ?? "??";
      by.set(cc, [...(by.get(cc) ?? []), s]);
    }
    return [...by.entries()].map(([cc, secs]) => {
      const length = secs.reduce((a, s) => a + s.length_m, 0);
      const best = MONTHS.map((_, m) => {
        let sum = 0;
        let len = 0;
        for (const s of secs) {
          const v = s.best_time[m];
          if (v === null || v === undefined) continue;
          sum += v * s.length_m;
          len += s.length_m;
        }
        return len ? { v: sum / len, share: len / length } : null;
      });
      return { cc, length, best };
    });
  }, [sections]);
  const total = sections.reduce((a, s) => a + s.length_m, 0);
  return (
    <section className="glance">
      <h2>{name} at a glance</h2>
      <p>
        {whole(total / 1000)} km in {sections.length} daily sections, in {rows.length} {rows.length === 1 ? "country" : "countries"}.
      </p>
      <div className="glance-table">
        <table>
          <thead>
            <tr>
              <th />
              {MONTHS.map((n, m) => (
                <th key={n}>
                  <button type="button" className={month === m ? "on" : ""} onClick={() => onMonth(month === m ? null : m)} title={`Choose ${MONTHS_LONG[m]}`}>
                    {n[0]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cc}>
                <th>
                  {country(r.cc).replace(/^the /, "")} <span className="muted">{whole(r.length / 1000)} km</span>
                </th>
                {r.best.map((b, m) => (
                  <td
                    key={MONTHS[m]}
                    className={`${b === null ? "none" : ""}${month === m ? " col" : ""}`}
                    style={b ? { background: tint(b.v) } : undefined}
                    title={`${country(r.cc)}, ${MONTHS_LONG[m]}: ${b ? `best-time ${Math.round(b.v)} of 100${b.share < 0.99 ? ` (no data for ${Math.round((1 - b.share) * 100)}% of it)` : ""}` : "no data"}`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        When each country is good to ride, by our best-time score: greener is better, grey is no data. Tap a month to choose it. Each daily section counts in
        the country where most of it lies, so short passages through other countries are folded into their neighbours.
      </p>
    </section>
  );
}

function Chips({ a, levels, themes, open, onOpen, onChange }: {
  a: Ask;
  levels: Level[];
  themes: DreamFile["themes"];
  open: ChipId | null;
  onOpen: (c: ChipId | null) => void;
  onChange: (patch: Partial<Ask>) => void;
}) {
  const level = levels.find((l) => l.level === a.level);
  const titles = Object.fromEntries(themes.map((t) => [t.id, t.title]));
  const chip = (id: ChipId, label: string, unset = false) => (
    <button key={id} type="button" className={`chip${open === id ? " open" : ""}${unset ? " unset" : ""}`} onClick={() => onOpen(open === id ? null : id)} aria-expanded={open === id}>
      {label}
    </button>
  );
  const toggle = (label: string, on: boolean, patch: Partial<Ask>) => (
    <button key={label} type="button" className={`chip toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(patch)}>
      {on ? "✓ " : ""}
      {label}
    </button>
  );
  const seg = <T extends string>(values: readonly T[], current: T, label: (v: T) => string, set: (v: T) => void) => (
    <div className="seg">
      {values.map((v) => (
        <button key={v} type="button" className={current === v ? "on" : ""} onClick={() => set(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  );
  return (
    <div className="chips-wrap">
      <div className="chips">
        {chip("level", level?.name ?? "Your level", !level)}
        {chip("days", a.days === null ? "How many days" : `${a.days} ${a.days === 1 ? "day" : "days"}`, a.days === null)}
        {chip("month", a.month === null ? "Any month" : MONTHS_LONG[a.month]!)}
        {chip("surfaces", surfacesText(a))}
        {chip("scenery", a.themes.length ? and(a.themes.map((t) => titles[t] ?? t)) : "Any scenery")}
        {chip("stay", STAY[a.stay])}
        {chip("direction", WAY[a.direction])}
        {toggle("Train at both ends", a.trainBothEnds, { trainBothEnds: !a.trainBothEnds })}
        {toggle("Avoid busy roads", a.avoidBusy, { avoidBusy: !a.avoidBusy })}
      </div>
      {open && (
        <div className="chip-editor">
          {open === "level" && (
            <div className="levels">
              {levels.map((l) => (
                <button key={l.level} type="button" className={a.level === l.level ? "on" : ""} onClick={() => onChange({ level: l.level })}>
                  <b>{l.name}</b>
                  <span>
                    {l.km_min}–{l.km_max} km a day with luggage, up to about {l.climb_max_m} m of climbing
                  </span>
                </button>
              ))}
            </div>
          )}
          {open === "days" && (
            <label className="days-edit">
              Riding days
              <input
                type="number"
                min={1}
                max={60}
                value={a.days ?? ""}
                placeholder="7"
                onChange={(e) => onChange({ days: e.target.value === "" ? null : Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
              />
            </label>
          )}
          {open === "month" && (
            <div className="months">
              <button type="button" className={a.month === null ? "on" : ""} onClick={() => onChange({ month: null })}>
                Any (the best for each stretch)
              </button>
              {MONTHS_LONG.map((m, i) => (
                <button key={m} type="button" className={a.month === i ? "on" : ""} onClick={() => onChange({ month: i })}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {open === "surfaces" &&
            SURFACES.map((s) => (
              <div key={s.key} className="surface-row">
                <span>{s.label[0]!.toUpperCase() + s.label.slice(1)}</span>
                {seg(PREFS, a.surfaces[s.key], (p) => (p === "ok" ? "fine" : p), (p) => onChange({ surfaces: { ...a.surfaces, [s.key]: p } }))}
              </div>
            ))}
          {open === "scenery" && (
            <div className="themes">
              {themes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.measures}
                  className={a.themes.includes(t.id) ? "on" : ""}
                  onClick={() => onChange({ themes: a.themes.includes(t.id) ? a.themes.filter((x) => x !== t.id) : [...a.themes, t.id] })}
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
          {open === "stay" && seg(["any", "rooms", "camping"] as const, a.stay, (v) => STAY[v], (v) => onChange({ stay: v }))}
          {open === "direction" && seg(["either", "forward", "reverse"] as const, a.direction, (v) => WAY[v], (v) => onChange({ direction: v }))}
          <button type="button" className="link done" onClick={() => onOpen(null)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function StretchCard({ r, rank, name, a, level, levels, route, on, comparing, onPick, onCompare }: {
  r: StretchResult;
  rank: string;
  name: string;
  a: Ask;
  level: number;
  levels: Level[];
  route: string;
  on: boolean;
  comparing?: boolean;
  onPick: () => void;
  onCompare?: () => void;
}) {
  const when = whenText(r, a);
  const why = whyLines(r);
  return (
    <article className={`stretch-card${on ? " on" : ""}`}>
      <button type="button" className="stretch-head" onClick={onPick} aria-pressed={on}>
        {rank && <span className="rank">{rank}</span>}
        <span className="name">{name}</span>
      </button>
      <div className="facts">
        {r.days} days · {km(r.km)} km · {r.kmPerDay} km a day · {climbText(r)} · {gradeText(r, levels)}
      </div>
      {when && <div className="when">{when}</div>}
      {why.length > 0 && (
        <ul className="why">
          {why.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {r.watch.length > 0 && (
        <ul className="watch">
          {r.watch.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {r.check.length > 0 && (
        <details className="checks">
          <summary>
            {r.check.length} {r.check.length === 1 ? "thing" : "things"} to check yourself
          </summary>
          <ul>
            {r.check.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="card-actions">
        {onCompare ? (
          <label className="check">
            <input type="checkbox" checked={comparing} onChange={onCompare} /> Compare
          </label>
        ) : (
          <span />
        )}
        <a className="button primary" href={planHref(route, r, a, level)}>
          Plan this ›
        </a>
      </div>
    </article>
  );
}

function CompareTable({ pair, names, a, levels, themes }: { pair: StretchResult[]; names: string[]; a: Ask; levels: Level[]; themes: DreamFile["themes"] }) {
  const titles = Object.fromEntries(themes.map((t) => [t.id, t.title]));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rows: [string, (r: StretchResult) => string][] = [
    ["Days", (r) => `${r.days} · ${km(r.km)} km · ${r.kmPerDay} km a day`],
    ["Climbing", climbText],
    ["Grade", (r) => gradeText(r, levels)],
    ["When", (r) => whenText(r, a) ?? "–"],
    ["Surfaces", (r) => `cycle paths ${pct(r.surfaces.cycle_path)} · roads ${pct(r.surfaces.road)} · gravel ${pct(r.surfaces.gravel)}${r.surfaces.unknown > 0.02 ? ` · unknown ${pct(r.surfaces.unknown)}` : ""}`],
    ["Busy roads", (r) => pct(r.busyShare)],
    ["Scenery", (r) => r.topThemes.map((t) => titles[t.id] ?? t.id).join(", ") || "–"],
    ["Trains", (r) => `start: ${r.stationStart ?? "none found"} · end: ${r.stationEnd ?? "none found"}`],
    ["To watch", (r) => (r.watch.length ? r.watch.join("; ") : "nothing stands out")],
    ["To check yourself", (r) => String(r.check.length)],
  ];
  return (
    <section className="dream-compare">
      <h2>Side by side</h2>
      <div className="compare-table">
        <table>
          <thead>
            <tr>
              <th />
              {names.map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([title, f]) => (
              <tr key={title}>
                <th>{title}</th>
                {pair.map((r) => (
                  <td key={keyOf(r)}>{f(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Any stretch, from one town to another, for riders who know where they want to go. */
function OwnPick({ points, from, to, onChange }: { points: Point[]; from: number | null; to: number | null; onChange: (from: number | null, to: number | null) => void }) {
  const select = (value: number | null, set: (v: number | null) => void, label: string) => (
    <label>
      {label}
      <select value={value ?? ""} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">Choose a town…</option>
        {points.map((p, i) => (
          <option key={i} value={i}>
            {p.name} (km {km(p.m / 1000)})
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="own-pick">
      {select(from, (v) => onChange(v, to), "From")}
      {select(to, (v) => onChange(from, v), "To")}
    </div>
  );
}

// --- the page -------------------------------------------------------------------------------------------------

function DreamRoute({ route }: { route: string }) {
  const [network = "", ref = ""] = route.split("/");
  const [files, setFiles] = useState<DreamFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<Ask>(() => readAsk(new URLSearchParams(window.location.search)));
  const [open, setOpen] = useState<ChipId | null>(null);
  const [count, setCount] = useState(SHOWN);
  const [picked, setPicked] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [own, setOwn] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });

  useEffect(() => {
    loadDreamFiles(network, ref)
      .then((f) => {
        setFiles(f);
        document.title = `${f.manifest.route.name} · Kilometrica Dream`;
      })
      .catch((e: Error) => setError(e.message));
  }, [network, ref]);

  useEffect(() => {
    window.history.replaceState(null, "", addressOf(route, a));
  }, [route, a]);

  const sections = useMemo(() => [...(files?.dream.sections ?? [])].sort((x, y) => x.from_m - y.from_m), [files]);
  const daily = useMemo(() => new Map((files?.daily ?? []).map((d) => [d.number, d])), [files]);
  const points = useMemo(() => pointsOf(sections, daily), [sections, daily]);
  // Every stretch that fits is counted; the list shows the best few (the search's own cap is lifted).
  const results = useMemo(
    () => (files && a.level !== null && a.days !== null ? findStretches(files.dream, { ...a, level: a.level, days: a.days, limit: 1000 }) : []),
    [files, a],
  );
  const shown = useMemo(() => results.slice(0, count), [results, count]);
  const ownResult = useMemo(() => {
    if (!files || a.level === null || own.from === null || own.to === null || own.from === own.to) return null;
    // Point i is the start of sections[i] (the last point is the end of the last section).
    const [i, j] = [own.from, own.to];
    const from = i < j ? sections[i]!.number : sections[i - 1]!.number;
    const to = i < j ? sections[j - 1]!.number : sections[j]!.number;
    return describeStretch(files.dream, from, to, { ...a, level: a.level });
  }, [files, a, own, sections]);
  const byNumber = useMemo(() => new Map(sections.map((s) => [s.number, s])), [sections]);
  const stretches: MapStretch[] = useMemo(() => {
    const span = (r: StretchResult) => ({ fromM: byNumber.get(r.first)?.from_m ?? 0, toM: byNumber.get(r.last)?.to_m ?? 0 });
    const list = shown.map((r, i) => ({ key: keyOf(r), ...span(r), on: picked === keyOf(r) || compare.includes(keyOf(r)), label: String(i + 1) }));
    if (ownResult) list.push({ key: OWN, ...span(ownResult), on: true, label: "" });
    return list;
  }, [shown, byNumber, picked, compare, ownResult]);

  if (error) return <div className="rider center error">{error}</div>;
  if (!files) return <div className="rider center muted">Loading the route…</div>;

  const change = (patch: Partial<Ask>) => {
    setA((x) => ({ ...x, ...patch }));
    setPicked(null);
    setCompare([]);
    setCount(SHOWN);
  };
  const levels = files.dream.levels;
  const pair = compare.map((k) => results.find((r) => keyOf(r) === k)).filter((r): r is StretchResult => !!r);
  const asked = a.level !== null && a.days !== null;
  const prompt =
    a.level === null && a.days === null
      ? "Pick an example, or tell us your level and how many days, to see the stretches that suit you."
      : a.level === null
        ? "Now your level, to see the stretches that suit you."
        : "Now how many days, to see the stretches that suit you.";

  return (
    <div className="rider dream-page">
      <header className="rider-bar">
        <a className="brand" href="/dream">
          Kilometrica
        </a>
        <span className="muted"> Dream · {files.manifest.route.name}</span>
        <span className="spacer" />
        <a href="/plan">Plan ›</a>
      </header>
      <div className="dream-grid">
        <aside className="dream-side">
          <h1>Which stretch suits you?</h1>
          <Glance name={files.manifest.route.name} sections={sections} month={a.month} onMonth={(m) => change({ month: m })} />
          <h2>What are you after?</h2>
          <div className="examples">
            {EXAMPLES.map((e) => (
              <button key={e.title} type="button" onClick={() => change({ ...EMPTY, month: a.month, ...e.q })}>
                <b>{e.title}</b>
                <span>{e.sub}</span>
              </button>
            ))}
          </div>
          <Chips a={a} levels={levels} themes={files.dream.themes} open={open} onOpen={setOpen} onChange={change} />

          <section className="results">
            {!asked ? (
              <p className="prompt">{prompt}</p>
            ) : (
              <>
                <h2>
                  {results.length === 0
                    ? "Nothing fits"
                    : `${results.length === 1 ? "One stretch fits" : `${results.length} stretches fit`}${results.length > shown.length ? `: the best ${shown.length} shown` : ""}`}
                </h2>
                {results.length === 0 && <p className="muted">Try more days, another level or fewer needs, or pick your own stretch below.</p>}
                {shown.map((r, i) => (
                  <StretchCard
                    key={keyOf(r)}
                    r={r}
                    rank={String(i + 1)}
                    name={stretchName(daily, r)}
                    a={a}
                    level={a.level!}
                    levels={levels}
                    route={route}
                    on={picked === keyOf(r)}
                    comparing={compare.includes(keyOf(r))}
                    onPick={() => setPicked(picked === keyOf(r) ? null : keyOf(r))}
                    onCompare={() => setCompare((c) => (c.includes(keyOf(r)) ? c.filter((x) => x !== keyOf(r)) : [...c.slice(-1), keyOf(r)]))}
                  />
                ))}
                <div className="more-row">
                  {results.length > shown.length && (
                    <button type="button" className="link" onClick={() => setCount(count + MORE)}>
                      Show {Math.min(MORE, results.length - shown.length)} more
                    </button>
                  )}
                  {shown.length > SHOWN && (
                    <button type="button" className="link" onClick={() => setCount(SHOWN)}>
                      Show the best {SHOWN}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
          {pair.length === 2 && <CompareTable pair={pair} names={pair.map((r) => stretchName(daily, r))} a={a} levels={levels} themes={files.dream.themes} />}
          {pair.length === 1 && <p className="muted small">Tick one more stretch to compare the two side by side.</p>}

          <section className="own">
            <h2>Or pick your own stretch</h2>
            <OwnPick
              points={points}
              from={own.from}
              to={own.to}
              onChange={(from, to) => {
                setOwn({ from, to });
                setPicked(from !== null && to !== null && from !== to ? OWN : null);
              }}
            />
            {own.from !== null && own.to !== null && own.from !== own.to && a.level === null && (
              <p className="muted">Set your level above to see the days it takes and how hard it is.</p>
            )}
            {ownResult && (
              <StretchCard
                r={ownResult}
                rank=""
                name={`${points[own.from!]!.name} → ${points[own.to!]!.name}`}
                a={a}
                level={a.level!}
                levels={levels}
                route={route}
                on={picked === OWN}
                onPick={() => setPicked(picked === OWN ? null : OWN)}
              />
            )}
            {ownResult && a.days === null && <p className="muted small">The days are those of a middling day at your level; set your days above to change them.</p>}
          </section>
          <p className="muted small">
            From the audit of {files.manifest.route.name}: {files.dream.climate_source}. Where we have no data we say so, and it becomes a check for you.
          </p>
        </aside>
        <section className="dream-main">
          <DreamMap geometry={files.geometry} stretches={stretches} focus={picked} onPick={(k) => setPicked(k)} attribution={files.manifest.attribution} />
        </section>
      </div>
    </div>
  );
}

function DreamStart() {
  const routes = useRouteList();
  useEffect(() => {
    document.title = "Kilometrica Dream";
  }, []);
  return (
    <div className="rider start">
      <header className="rider-bar">
        <span className="brand">Kilometrica</span> <span className="muted">Dream</span>
        <span className="spacer" />
        <a href="/plan">Plan ›</a>
      </header>
      <main className="start-main">
        <h1>Where would you like to ride?</h1>
        <p className="muted">Pick a route; we'll find the stretches that suit you, when and which way.</p>
        <ul className="route-pick">
          {routes.map((r) => (
            <li key={r.route.id}>
              <a href={`/dream?route=${r.route.network}/${r.route.ref.toLowerCase()}`}>{r.route.name}</a>
              <span className="muted">
                {" "}
                · {km(r.summary.ride_length_m / 1000)} km{r.route.network === "user" ? " · your own route" : ""}
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

export function DreamApp() {
  const route = new URLSearchParams(window.location.search).get("route")?.toLowerCase() ?? null;
  if (!route || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(route)) return <DreamStart />;
  return <DreamRoute route={route} />;
}
