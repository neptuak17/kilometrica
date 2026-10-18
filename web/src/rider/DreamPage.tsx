/**
 * Dream for riders (11.7, D48): which stretch suits me, when, and which way (D35). Example trips to start from, the
 * question as chips, up to three stretches that fit with their why, two compared side by side, and "Plan this".
 * Everything comes from the route's free files (D35); the audit viewer's Dream tab stays, for us (D43). The question
 * lives in the address, so a search can be shared or reopened.
 */
import type { DailySection, DreamFile } from "@dpg/contracts";
import { type DreamQuery, findStretches, type Pref, type StretchResult, type SurfaceKind } from "@dpg/dream";
import { km, MONTHS_LONG } from "@dpg/planner";
import { useEffect, useMemo, useState } from "react";
import { loadDreamFiles, type DreamFiles } from "./data";
import { DreamMap, type MapStretch } from "./DreamMap";
import { useRouteList } from "./routes";
import "./rider.css";

type Level = DreamFile["levels"][number];
type ChipId = "level" | "days" | "month" | "surfaces" | "scenery" | "stay" | "direction";

const DEFAULT_QUERY: DreamQuery = {
  level: 3,
  days: 7,
  month: null,
  surfaces: { road: "ok", cycle_path: "prefer", gravel: "ok" },
  themes: [],
  trainBothEnds: false,
  stay: "any",
  avoidBusy: false,
  direction: "either",
};

/** Starting points: a whole question in one tap, changed from there. */
const EXAMPLES: { title: string; sub: string; q: Partial<DreamQuery> }[] = [
  {
    title: "A week of coast and villages",
    sub: "Easy, rooms, quiet roads, a train at both ends",
    q: { level: 2, days: 7, themes: ["coast", "heritage"], trainBothEnds: true, stay: "rooms", avoidBusy: true },
  },
  { title: "A long weekend by the sea", sub: "Easy, three days, a train at both ends", q: { level: 2, days: 3, themes: ["coast"], trainBothEnds: true, stay: "any", avoidBusy: false } },
  { title: "Ten days of wine and towns", sub: "Moderate, rooms", q: { level: 3, days: 10, themes: ["wine", "culture"], trainBothEnds: false, stay: "rooms", avoidBusy: false } },
  { title: "Two weeks in the hills", sub: "Challenging, mountains and viewpoints", q: { level: 4, days: 14, themes: ["mountains", "viewpoints"], trainBothEnds: false, stay: "any", avoidBusy: false } },
];

const SURFACES: { key: SurfaceKind; label: string; url: string }[] = [
  { key: "cycle_path", label: "cycle paths", url: "paths" },
  { key: "road", label: "roads", url: "road" },
  { key: "gravel", label: "gravel", url: "gravel" },
];
const PREFS: Pref[] = ["prefer", "ok", "avoid"];
const STAY = { any: "Rooms or camping", rooms: "Rooms", camping: "Camping" } as const;
const WAY = { either: "Either way", forward: "With the route", reverse: "Against the route" } as const;

// --- the question in the address ---------------------------------------------------------------------------

function readQuery(p: URLSearchParams): DreamQuery {
  const int = (k: string, lo: number, hi: number) => {
    const raw = p.get(k);
    const v = Number(raw);
    return raw !== null && raw !== "" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  };
  const pref = (k: string, d: Pref): Pref => (PREFS.includes(p.get(k) as Pref) ? (p.get(k) as Pref) : d);
  const stay = p.get("stay");
  const way = p.get("way");
  return {
    level: int("level", 1, 5) ?? DEFAULT_QUERY.level,
    days: int("days", 1, 60) ?? DEFAULT_QUERY.days,
    month: int("month", 0, 11),
    surfaces: { road: pref("road", "ok"), cycle_path: pref("paths", "prefer"), gravel: pref("gravel", "ok") },
    themes: (p.get("themes") ?? "").split(",").filter(Boolean),
    trainBothEnds: p.get("train") === "1",
    stay: stay === "rooms" || stay === "camping" ? stay : "any",
    avoidBusy: p.get("busy") === "1",
    direction: way === "forward" || way === "reverse" ? way : "either",
  };
}

function addressOf(route: string, q: DreamQuery): string {
  const p = new URLSearchParams({ route, level: String(q.level), days: String(q.days) });
  if (q.month !== null) p.set("month", String(q.month));
  for (const s of SURFACES) if (q.surfaces[s.key] !== DEFAULT_QUERY.surfaces[s.key]) p.set(s.url, q.surfaces[s.key]);
  if (q.themes.length) p.set("themes", q.themes.join(","));
  if (q.trainBothEnds) p.set("train", "1");
  if (q.stay !== "any") p.set("stay", q.stay);
  if (q.avoidBusy) p.set("busy", "1");
  if (q.direction !== "either") p.set("way", q.direction);
  return `/dream?${p}`;
}

// --- wording ------------------------------------------------------------------------------------------------

const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function surfacesText(q: DreamQuery): string {
  const of = (p: Pref) => SURFACES.filter((s) => q.surfaces[s.key] === p).map((s) => s.label);
  const parts = [of("prefer").length ? `Prefer ${and(of("prefer"))}` : "", of("avoid").length ? `avoid ${and(of("avoid"))}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "Any surface";
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

/** The matchmaker's why lines, less the two the card already shows as facts: the grade and the month's scores. */
const whyLines = (r: StretchResult) => r.why.filter((w) => !/: grade \d/.test(w) && !/best-time \d+$/.test(w));

const climbText = (r: StretchResult) =>
  r.climbPerDay !== null ? `↑ ${r.climbPerDay} m a day` : r.climbMinPerDay !== null ? `↑ at least ${r.climbMinPerDay} m a day` : "climbing unknown";

const gradeText = (r: StretchResult, levels: Level[]) => `${r.gradeAtLeast ? "at least " : ""}${levels.find((l) => l.level === r.grade)?.name ?? `level ${r.grade}`}`;

function whenText(r: StretchResult, q: DreamQuery): string | null {
  if (r.month === null) return null;
  const score = r.bestTime === null ? "" : `: best-time ${r.bestTime} of 100`;
  return q.month === null ? `Best in ${MONTHS_LONG[r.month]}${score}` : `In ${MONTHS_LONG[r.month]}${score}`;
}

/** Plan opens the stretch with the question's answers (D48). */
function planHref(route: string, r: StretchResult, q: DreamQuery): string {
  return `/plan?${new URLSearchParams({
    route,
    first: String(r.first),
    last: String(r.last),
    way: r.way,
    days: String(r.days),
    month: String(q.month ?? r.month ?? ""),
    level: String(q.level),
    gravel: q.surfaces.gravel,
    busy: q.avoidBusy ? "1" : "0",
    stay: q.stay,
  })}`;
}

// --- pieces ---------------------------------------------------------------------------------------------------

function Chips({ q, levels, themes, open, onOpen, onChange }: {
  q: DreamQuery;
  levels: Level[];
  themes: DreamFile["themes"];
  open: ChipId | null;
  onOpen: (c: ChipId | null) => void;
  onChange: (patch: Partial<DreamQuery>) => void;
}) {
  const level = levels.find((l) => l.level === q.level);
  const titles = Object.fromEntries(themes.map((t) => [t.id, t.title]));
  const chip = (id: ChipId, label: string) => (
    <button key={id} type="button" className={`chip${open === id ? " open" : ""}`} onClick={() => onOpen(open === id ? null : id)} aria-expanded={open === id}>
      {label}
    </button>
  );
  const toggle = (label: string, on: boolean, patch: Partial<DreamQuery>) => (
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
        {chip("level", level?.name ?? `Level ${q.level}`)}
        {chip("days", `${q.days} ${q.days === 1 ? "day" : "days"}`)}
        {chip("month", q.month === null ? "Any month" : MONTHS_LONG[q.month]!)}
        {chip("surfaces", surfacesText(q))}
        {chip("scenery", q.themes.length ? and(q.themes.map((t) => titles[t] ?? t)) : "Any scenery")}
        {chip("stay", STAY[q.stay])}
        {chip("direction", WAY[q.direction])}
        {toggle("Train at both ends", q.trainBothEnds, { trainBothEnds: !q.trainBothEnds })}
        {toggle("Avoid busy roads", q.avoidBusy, { avoidBusy: !q.avoidBusy })}
      </div>
      {open && (
        <div className="chip-editor">
          {open === "level" && (
            <div className="levels">
              {levels.map((l) => (
                <button key={l.level} type="button" className={q.level === l.level ? "on" : ""} onClick={() => onChange({ level: l.level })}>
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
              <input type="number" min={1} max={60} value={q.days} onChange={(e) => onChange({ days: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
            </label>
          )}
          {open === "month" && (
            <div className="months">
              <button type="button" className={q.month === null ? "on" : ""} onClick={() => onChange({ month: null })}>
                Any (the best for each stretch)
              </button>
              {MONTHS_LONG.map((m, i) => (
                <button key={m} type="button" className={q.month === i ? "on" : ""} onClick={() => onChange({ month: i })}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {open === "surfaces" &&
            SURFACES.map((s) => (
              <div key={s.key} className="surface-row">
                <span>{s.label[0]!.toUpperCase() + s.label.slice(1)}</span>
                {seg(PREFS, q.surfaces[s.key], (p) => (p === "ok" ? "fine" : p), (p) => onChange({ surfaces: { ...q.surfaces, [s.key]: p } }))}
              </div>
            ))}
          {open === "scenery" && (
            <div className="themes">
              {themes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.measures}
                  className={q.themes.includes(t.id) ? "on" : ""}
                  onClick={() => onChange({ themes: q.themes.includes(t.id) ? q.themes.filter((x) => x !== t.id) : [...q.themes, t.id] })}
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
          {open === "stay" && seg(["any", "rooms", "camping"] as const, q.stay, (v) => STAY[v], (v) => onChange({ stay: v }))}
          {open === "direction" && seg(["either", "forward", "reverse"] as const, q.direction, (v) => WAY[v], (v) => onChange({ direction: v }))}
          <button type="button" className="link done" onClick={() => onOpen(null)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function StretchCard({ r, rank, name, q, levels, route, on, comparing, onPick, onCompare }: {
  r: StretchResult;
  rank: number;
  name: string;
  q: DreamQuery;
  levels: Level[];
  route: string;
  on: boolean;
  comparing: boolean;
  onPick: () => void;
  onCompare: () => void;
}) {
  const when = whenText(r, q);
  const why = whyLines(r);
  return (
    <article className={`stretch-card${on ? " on" : ""}`}>
      <button type="button" className="stretch-head" onClick={onPick} aria-pressed={on}>
        <span className="rank">{rank}</span>
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
        <label className="check">
          <input type="checkbox" checked={comparing} onChange={onCompare} /> Compare
        </label>
        <a className="button primary" href={planHref(route, r, q)}>
          Plan this ›
        </a>
      </div>
    </article>
  );
}

function CompareTable({ pair, names, q, levels, themes }: { pair: StretchResult[]; names: string[]; q: DreamQuery; levels: Level[]; themes: DreamFile["themes"] }) {
  const titles = Object.fromEntries(themes.map((t) => [t.id, t.title]));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rows: [string, (r: StretchResult) => string][] = [
    ["Days", (r) => `${r.days} · ${km(r.km)} km · ${r.kmPerDay} km a day`],
    ["Climbing", climbText],
    ["Grade", (r) => gradeText(r, levels)],
    ["When", (r) => whenText(r, q) ?? "–"],
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

// --- the page -------------------------------------------------------------------------------------------------

function DreamRoute({ route }: { route: string }) {
  const [network = "", ref = ""] = route.split("/");
  const [files, setFiles] = useState<DreamFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<DreamQuery>(() => readQuery(new URLSearchParams(window.location.search)));
  const [open, setOpen] = useState<ChipId | null>(null);
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);

  useEffect(() => {
    loadDreamFiles(network, ref)
      .then((f) => {
        setFiles(f);
        document.title = `${f.manifest.route.name} · Kilometrica Dream`;
      })
      .catch((e: Error) => setError(e.message));
  }, [network, ref]);

  useEffect(() => {
    window.history.replaceState(null, "", addressOf(route, q));
  }, [route, q]);

  const results = useMemo(() => (files ? findStretches(files.dream, q) : []), [files, q]);
  const daily = useMemo(() => new Map((files?.daily ?? []).map((d) => [d.number, d])), [files]);
  const shown = useMemo(() => results.slice(0, more ? 10 : 3), [results, more]);
  const sectionM = useMemo(() => new Map((files?.dream.sections ?? []).map((s) => [s.number, s])), [files]);
  const stretches: MapStretch[] = useMemo(
    () =>
      shown.map((r) => ({
        key: keyOf(r),
        fromM: sectionM.get(r.first)?.from_m ?? 0,
        toM: sectionM.get(r.last)?.to_m ?? 0,
        on: picked === keyOf(r) || compare.includes(keyOf(r)),
      })),
    [shown, sectionM, picked, compare],
  );

  if (error) return <div className="rider center error">{error}</div>;
  if (!files) return <div className="rider center muted">Loading the route…</div>;

  const change = (patch: Partial<DreamQuery>) => {
    setQ((x) => ({ ...x, ...patch }));
    setPicked(null);
    setCompare([]);
  };
  const pair = compare.map((k) => results.find((r) => keyOf(r) === k)).filter((r): r is StretchResult => !!r);

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
          <p className="muted">Start from an example, then change anything below. The stretches that fit update as you go.</p>
          <div className="examples">
            {EXAMPLES.map((e) => (
              <button key={e.title} type="button" onClick={() => change({ ...DEFAULT_QUERY, month: q.month, ...e.q })}>
                <b>{e.title}</b>
                <span>{e.sub}</span>
              </button>
            ))}
          </div>
          <Chips q={q} levels={files.dream.levels} themes={files.dream.themes} open={open} onOpen={setOpen} onChange={change} />

          <section className="results">
            <h2>
              {results.length === 0 ? "Nothing fits yet" : `${results.length === 1 ? "One stretch fits" : `${results.length} stretches fit`}${results.length > 3 && !more ? ": the best three" : ""}`}
            </h2>
            {results.length === 0 && <p className="muted">Try more days, another level or fewer needs.</p>}
            {shown.map((r, i) => (
              <StretchCard
                key={keyOf(r)}
                r={r}
                rank={i + 1}
                name={stretchName(daily, r)}
                q={q}
                levels={files.dream.levels}
                route={route}
                on={picked === keyOf(r)}
                comparing={compare.includes(keyOf(r))}
                onPick={() => setPicked(picked === keyOf(r) ? null : keyOf(r))}
                onCompare={() => setCompare((c) => (c.includes(keyOf(r)) ? c.filter((x) => x !== keyOf(r)) : [...c.slice(-1), keyOf(r)]))}
              />
            ))}
            {results.length > 3 && (
              <button type="button" className="link" onClick={() => setMore(!more)}>
                {more ? "Show the best three" : `Show ${Math.min(results.length, 10) - 3} more`}
              </button>
            )}
          </section>
          {pair.length === 2 && <CompareTable pair={pair} names={pair.map((r) => stretchName(daily, r))} q={q} levels={files.dream.levels} themes={files.dream.themes} />}
          {pair.length === 1 && <p className="muted small">Tick one more stretch to compare the two side by side.</p>}
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
