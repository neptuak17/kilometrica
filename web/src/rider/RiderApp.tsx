/**
 * The rider view (M4, DESIGN.md 11.6) in the new look (D53, D54): Plan for riders, apart from the audit viewer, which
 * is ours (D43, D48). Built for the web first (D49); a plan opened from its link on a phone shows the phone-width
 * view, where Go starts.
 *
 *   /plan?route=<network>/<ref>&first=&last=&way=&days=&month=&level=…   a stretch from Dream (or any range)
 *   /plan?plan=<id>                                                      a plan kept in this browser
 *   /plan#p=…  /plan#i=…                                                 a shared plan or itinerary (read-only)
 */
import {
  applyAction,
  calendarFile,
  choicesOf,
  clock,
  dayGpx,
  type DayPlan,
  day as dayText,
  hours,
  itineraryOf,
  km,
  makePlan,
  NO_CHOICES,
  ownNights,
  newId,
  numberList,
  optionOutcome,
  type PlanAction,
  planChanges,
  type PlanChoices,
  type PlanData,
  type PlanDocument,
  type PlanInputs,
  type PlanItem,
  type PlanResult,
  type PlanState,
  placesMissing,
  readFragment,
  shareFragment,
  type Itinerary,
  toDocument,
  tripGpx,
} from "@dpg/planner";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChangeBar,
  cn,
  Icons,
  Label,
  LinkButton,
  Switch,
} from "@dpg/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "../shared/Header";
import { BeforeYouGo, type ExportKind } from "./BeforeYouGo";
import { Brief, DayList, EffortChart } from "./Brief";
import { Calls } from "./Calls";
import { loadFull, loadRoute, type FullFiles, type RouteFiles } from "./data";
import { DayCard } from "./DayCard";
import { type Step, usePlanHistory } from "./history";
import { PlanMap } from "./PlanMap";
import { Profile } from "./Profile";
import { TripBook } from "./TripBook";
import { Questions } from "./Questions";
import { useRouteList } from "./routes";
import { deletePlan, download, fileSafe, savedPlans, savePlan } from "./storage";

const PASS_KEY = "dpg.tripPass";

function readPass(): boolean {
  try {
    return localStorage.getItem(PASS_KEY) !== "0";
  } catch {
    return true;
  }
}

interface Start {
  network: string;
  ref: string;
  inputs: Partial<PlanInputs> & { first?: number; last?: number; month?: number | null };
  doc: PlanDocument | null;
  readOnly: boolean;
}

function readStart(): { start: Start | null; itinerary: Itinerary | null; error: string | null } {
  const shared = readFragment(window.location.hash);
  if (shared && "error" in shared) return { start: null, itinerary: null, error: `This link can't be opened: ${shared.error}.` };
  if (shared && "itinerary" in shared) return { start: null, itinerary: shared.itinerary, error: null };
  if (shared && "plan" in shared) {
    const d = shared.plan;
    return { start: { network: d.route.network, ref: d.route.ref, inputs: d.inputs, doc: d, readOnly: true }, itinerary: null, error: null };
  }
  const q = new URLSearchParams(window.location.search);
  const id = q.get("plan");
  if (id) {
    const d = savedPlans().find((p) => p.id === id);
    if (!d) return { start: null, itinerary: null, error: "That plan isn't kept in this browser any more." };
    return { start: { network: d.route.network, ref: d.route.ref, inputs: d.inputs, doc: d, readOnly: false }, itinerary: null, error: null };
  }
  const route = q.get("route");
  if (!route || !/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(route)) return { start: null, itinerary: null, error: null };
  const [network = "", ref = ""] = route.toLowerCase().split("/");
  const num = (k: string) => (q.get(k) === null || q.get(k) === "" ? undefined : Number(q.get(k)));
  const stay = q.get("stay");
  return {
    start: {
      network,
      ref,
      inputs: {
        first: num("first"),
        last: num("last"),
        direction: q.get("way") === "reverse" ? "reverse" : "forward",
        // From Dream (D74): days in all and the rest days among them; riding days are the difference.
        days: num("days") === undefined ? undefined : Math.max(1, num("days")! - (num("rest") ?? 0)),
        restDays: num("rest"),
        month: num("month") ?? null,
        level: num("level"),
        avoidGravel: q.get("gravel") === "avoid",
        avoidBusy: q.get("busy") === "1",
        sleep: stay === "camping" ? "camping" : stay === "rooms" ? "rooms" : "mix",
      },
      doc: null,
      readOnly: false,
    },
    itinerary: null,
    error: null,
  };
}

function initialInputs(files: RouteFiles, s: Start["inputs"]): { inputs: PlanInputs; suggested: number | null } {
  const daily = [...files.sections.daily].sort((a, b) => a.from_m - b.from_m);
  // A rider's own route is planned whole by default; a network route from its first week of sections.
  const own = files.manifest.visibility === "private";
  const first = daily.find((d) => d.number === s.first) ?? daily[0]!;
  const last = daily.find((d) => d.number === s.last) ?? daily[own ? daily.length - 1 : Math.min(daily.length - 1, 6)]!;
  const year = files.free.dream.season_year;
  const month = s.month ?? null;
  const startDate = s.startDate ?? `${year}-${String((month ?? 8) + 1).padStart(2, "0")}-15`;
  return {
    suggested: s.startDate ? null : month,
    inputs: {
      fromM: s.fromM ?? Math.min(first.from_m, last.from_m),
      toM: s.toM ?? Math.max(first.to_m, last.to_m),
      direction: s.direction ?? "forward",
      startDate,
      days: s.days ?? 7,
      level: s.level ?? 3,
      bike: s.bike ?? "touring",
      sleep: s.sleep ?? "mix",
      startMinutes: s.startMinutes ?? 9 * 60,
      stopStyle: s.stopStyle ?? "normal",
      restAfter: s.restAfter ?? [],
      ...(s.restDays !== undefined ? { restDays: s.restDays } : {}),
      avoidGravel: s.avoidGravel ?? false,
      avoidBusy: s.avoidBusy ?? false,
    },
  };
}

/** The page around every Plan view: the header and a centred column. */
function Page({ header, children, wide = true }: { header?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background font-sans text-sm text-foreground">
      {header ?? <Header phase="plan" />}
      <main className={cn("mx-auto flex flex-col gap-6 px-4 pt-7 pb-14 sm:px-8", wide ? "max-w-[1440px]" : "max-w-4xl")}>{children}</main>
    </div>
  );
}

// --- start page ---------------------------------------------------------------------------------------------

function StartPage() {
  const routes = useRouteList();
  const [plans, setPlans] = useState(savedPlans);
  return (
    <Page wide={false}>
      <div className="grid gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight">Plan a trip</h1>
        <p className="text-base text-muted-foreground">
          Pick a route, then the stretch, the dates and how you ride. Not sure which stretch?{" "}
          <a href="/dream" className="text-primary hover:underline">
            Find one in Dream
          </a>
          .
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {routes.map((r) => (
          <Card key={r.route.id} size="sm">
            <CardHeader>
              <CardTitle className="font-semibold">{r.route.name}</CardTitle>
              <CardDescription>
                {km(r.summary.ride_length_m / 1000)} km{r.route.network === "user" ? " · your own route" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LinkButton href={`/plan?route=${r.route.network}/${r.route.ref.toLowerCase()}`} size="sm">
                Plan on this route
                <Icons.ArrowRight data-icon="inline-end" />
              </LinkButton>
            </CardContent>
          </Card>
        ))}
      </div>
      {plans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Plans kept in this browser</CardTitle>
          </CardHeader>
          <CardContent className="grid">
            {plans.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0">
                <div className="grid min-w-0 flex-[1_1_240px]">
                  <a href={`/plan?plan=${p.id}`} className="font-semibold text-primary hover:underline">
                    {p.name}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {dayText(p.inputs.startDate)} · {p.inputs.days} days · {p.route.name}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    deletePlan(p.id);
                    setPlans(savedPlans());
                  }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}

function ItineraryView({ it }: { it: Itinerary }) {
  return (
    <Page wide={false} header={<Header phase="plan" />}>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Where I'll be</span>
        <h1 className="text-3xl font-bold tracking-tight">{it.name}</h1>
      </div>
      <Card>
        <CardContent className="grid">
          {it.days.map((d) => (
            <div key={d.date} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0">
              <span className="w-28 font-semibold">{dayText(d.date)}</span>
              <span className="min-w-0 flex-1">{d.kind === "rest" ? `Rest day at ${d.to}` : `${d.from} → ${d.to}, ${d.km} km`}</span>
              {d.stop && (
                <LinkButton
                  href={`https://www.google.com/maps/search/?api=1&query=${d.stop.lat},${d.stop.lon}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  variant="outline"
                  size="xs"
                >
                  Map
                  <Icons.ExternalLink data-icon="inline-end" />
                </LinkButton>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Shared from Kilometrica: dates and nightly stops only.</p>
    </Page>
  );
}

// --- compare ------------------------------------------------------------------------------------------------

interface Pinned {
  label: string;
  inputs: PlanInputs;
  choices: PlanChoices;
}

function metrics(p: PlanResult) {
  const rides = p.days.filter((d) => d.kind === "ride");
  const hardest = [...rides].sort((a, b) => b.hoursSlow - a.hoursSlow)[0]!;
  const busy = p.items
    .filter((i) => i.id.startsWith("finding:") && i.title.includes("busy roads"))
    .reduce((a, i) => a + Math.abs((i.toM ?? 0) - (i.fromM ?? 0)) / 1000, 0);
  return {
    days: `${p.days.length} (${rides.length} riding)`,
    hardest: `Day ${hardest.number}: ${km(hardest.km)} km, ${hours(hardest.hoursSlow)}`,
    hours: hours(rides.reduce((a, d) => a + d.hoursSlow, 0)),
    beyond: String(rides.filter((d) => d.effort === "beyond").length),
    nights: String(p.nights.filter((n) => n.beds.open + n.beds.partly === 0).length),
    calls: String(p.items.filter((i) => i.kind === "call").length),
    busy: p.mode === "full" ? `${km(busy)} km` : "with a Trip Pass",
  };
}

function Compare({ data, current, pinned, onPin, onUnpin, readOnly }: {
  data: PlanData;
  current: PlanResult;
  pinned: Pinned[];
  onPin: () => void;
  onUnpin: (i: number) => void;
  readOnly: boolean;
}) {
  const plans = useMemo(() => pinned.map((p) => makePlan(data, p.inputs, p.choices, { languages: [...navigator.languages] })), [data, pinned]);
  if (readOnly) return null;
  const cols = [...plans.map((p, i) => ({ label: pinned[i]!.label, m: metrics(p), i })), { label: "Yours now", m: metrics(current), i: -1 }];
  const rows: [keyof ReturnType<typeof metrics>, string][] = [
    ["days", "Days"],
    ["hardest", "Hardest day"],
    ["hours", "Riding in all"],
    ["beyond", "Days beyond your level"],
    ["nights", "Nights with no known-open place"],
    ["calls", "Your calls"],
    ["busy", "Busy roads"],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Compare plans</CardTitle>
        <CardDescription>Keep this version, then change the days, how you sleep or the direction, and see the two side by side.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <Button variant="outline" size="sm" onPress={onPin}>
            <Icons.Plus data-icon="inline-start" />
            Keep this version to compare
          </Button>
        </div>
        {pinned.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" />
                  {cols.map((c) => (
                    <th key={c.label} scope="col" className="border-l px-3 py-2.5 text-left align-top font-semibold">
                      <span className="flex items-start justify-between gap-2">
                        {c.label}
                        {c.i >= 0 && (
                          <Button variant="ghost" size="icon-xs" aria-label={`Remove ${c.label}`} onPress={() => onUnpin(c.i)}>
                            <Icons.X />
                          </Button>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, title]) => {
                  const values = cols.map((c) => c.m[k]);
                  const differ = new Set(values).size > 1;
                  return (
                    <tr key={k} className={cn("border-b last:border-b-0", differ && "bg-secondary/60")}>
                      <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                        {title}
                      </th>
                      {cols.map((c) => (
                        <td key={c.label} className="border-l px-3 py-2 tabular-nums">
                          {c.m[k]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- the trip book (print) ----------------------------------------------------------------------------------

function TitleBlock({ plan }: { plan: PlanResult }) {
  const b = plan.brief;
  return (
    <div className="grid gap-1.5">
      <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{b.title}</h1>
      <p className="text-base tabular-nums">
        {plan.days.length} days · {b.dates} · {km(b.km)} km · {Math.round(b.climbM).toLocaleString("en-GB")} m of climbing ·{" "}
        {b.direction === "forward" ? "as the route runs" : "the other way"}
      </p>
    </div>
  );
}

// --- the plan -----------------------------------------------------------------------------------------------

/** A call's option shown on the plan before the rider applies it (11.7). */
interface Preview {
  label: string;
  state: PlanState;
  callId: string;
  optionId: string;
}

function PlanPage({ start }: { start: Start }) {
  const [files, setFiles] = useState<RouteFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every change is a plan action (D52); the history keeps the states for undo and redo.
  const history = usePlanHistory();
  const { reset, apply: applyStep, commit, undo, redo } = history;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hidden, setHidden] = useState<Step | null>(null);
  const inputs = history.present?.inputs ?? null;
  const choices = history.present?.choices ?? NO_CHOICES;
  const [suggested, setSuggested] = useState<number | null>(null);
  const [datesConfirmed, setDatesConfirmed] = useState(Boolean(start.doc));
  const [meta, setMeta] = useState(() => ({ id: start.doc?.id ?? newId(), name: start.doc?.name ?? "", created: start.doc?.created, notes: start.doc?.notes ?? "" }));
  const [readOnly, setReadOnly] = useState(start.readOnly);
  const [pass, setPass] = useState(readPass);
  const [full, setFull] = useState<FullFiles | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  // A day opened from elsewhere on the page (the to-do, a call): its card is scrolled into view, at Sleep for a night.
  const [focus, setFocus] = useState<{ part: "card" | "sleep"; at: number } | null>(null);
  const showDay = useCallback((n: number, part: "card" | "sleep" = "card") => {
    setSelected(n);
    setFocus({ part, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!focus) return;
    const el = (focus.part === "sleep" && document.getElementById("day-sleep")) || document.getElementById("day-card");
    el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [focus]);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(!start.doc);

  useEffect(() => {
    loadRoute(start.network, start.ref)
      .then((f) => {
        setFiles(f);
        const init = initialInputs(f, start.inputs);
        reset({ inputs: init.inputs, choices: start.doc ? choicesOf(start.doc) : NO_CHOICES });
        setSuggested(init.suggested);
        document.title = `${f.manifest.route.name} · Kilometrica Plan`;
        if (start.doc && start.doc.route.runId !== f.manifest.run_id) {
          setError(null);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [start, reset]);

  const blockKey = inputs ? `${Math.floor(Math.min(inputs.fromM, inputs.toM) / 50_000)}-${Math.ceil(Math.max(inputs.fromM, inputs.toM) / 50_000)}` : "";
  useEffect(() => {
    if (!files || !inputs || !pass) return;
    let live = true;
    loadFull(start.network, start.ref, files.manifest.run_id, inputs.fromM, inputs.toM)
      .then((f) => live && setFull(f))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setRetrying(false));
    return () => {
      live = false;
    };
    // Re-fetched only when the stretch crosses into other 50 km blocks (D31), or the rider tries again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, blockKey, pass, attempt]);

  const data: PlanData | null = useMemo(() => (files ? { ...files.free, full: pass && full ? full.full : null } : null), [files, full, pass]);
  // The device's languages pick Wikipedia articles (they stay on the device, D30); the route's lines place the
  // street-level photo links (D58).
  const options = useMemo(() => ({ languages: [...navigator.languages], geometry: files?.geometry }), [files]);
  // Each state is planned once: undo, previews and "what changed" reuse the plans.
  const plans = useMemo(() => new WeakMap<PlanState, PlanResult>(), [data]);
  const planFor = useCallback(
    (s: PlanState) => {
      let p = plans.get(s);
      if (!p) {
        p = makePlan(data!, s.inputs, s.choices, options);
        plans.set(s, p);
      }
      return p;
    },
    [plans, data, options],
  );
  const plan = useMemo(() => (data && history.present ? planFor(history.present) : null), [data, history.present, planFor]);
  // What the screen shows: the preview while there is one, else the plan.
  const shown = useMemo(() => (preview && data ? planFor(preview.state) : plan), [preview, data, planFor, plan]);
  const changes = useMemo(() => {
    if (!plan || !data) return null;
    if (preview) return planChanges(plan, planFor(preview.state));
    return history.last ? planChanges(planFor(history.last.before), planFor(history.last.after)) : null;
  }, [plan, data, preview, history.last, planFor]);
  const doc = useMemo(() => (plan ? toDocument(plan, { ...meta, name: meta.name || plan.brief.title }) : null), [plan, meta]);

  // Plans stay on this device (principle 5); a shared plan is kept only when the rider asks.
  useEffect(() => {
    if (!doc || readOnly) return;
    savePlan(doc);
    if (!new URLSearchParams(window.location.search).has("plan")) window.history.replaceState(null, "", `/plan?plan=${doc.id}`);
  }, [doc, readOnly]);

  // A change from the screen applies at once (with Undo) and ends any preview.
  const apply = useCallback(
    (a: PlanAction) => {
      setPreview(null);
      applyStep(a);
    },
    [applyStep],
  );
  const edit = useCallback(
    (next: PlanInputs, confirm?: boolean) => {
      apply({ type: "set", inputs: next });
      if (confirm) setDatesConfirmed(true);
    },
    [apply],
  );
  const back = useCallback(() => {
    setPreview(null);
    undo();
  }, [undo]);
  const forward = useCallback(() => {
    setPreview(null);
    redo();
  }, [redo]);

  // A call's option is previewed first; "Keep it" changes nothing on the plan, so it applies at once.
  const onOption = (item: PlanItem, id: string) => {
    const out = optionOutcome(item, id);
    if (!out || !history.present) return;
    if ("showDay" in out) return showDay(out.showDay);
    if (out.action.type === "dismiss") return apply(out.action);
    const label = item.options?.find((o) => o.id === id)?.label ?? "a change";
    setPreview({ label, state: applyAction(history.present, out.action), callId: item.id, optionId: id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))) return;
      if (e.key === "Escape") return setPreview(null);
      if (readOnly || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        back();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward, readOnly]);

  if (error)
    return (
      <Page>
        <p className="text-destructive">{error}</p>
      </Page>
    );
  if (!files || !inputs || !plan || !shown || !data || !doc)
    return (
      <Page>
        <p className="text-muted-foreground">Loading the route…</p>
      </Page>
    );

  const free = !data.full;
  const calls = plan.items.filter((i) => i.kind === "call" && !choices.dismissed.includes(i.id));
  const day = shown.days.find((d) => d.number === selected) ?? null;
  const origin = window.location.origin;
  const links = { full: `${origin}/plan#${shareFragment(doc)}`, itinerary: `${origin}/plan#${shareFragment(itineraryOf(plan, doc.name))}` };
  const isPrivate = files.manifest.visibility === "private";
  const stale = start.doc && start.doc.route.runId !== files.manifest.run_id;
  const lockNight = (k: number, id: string) => apply({ type: "lock-night", night: k, stop: id });
  const toggleDone = (id: string) => apply({ type: "done", item: id, on: !choices.done.includes(id) });
  const unloaded = data.full
    ? shown.days.filter((d) => d.kind === "ride" && placesMissing(data.full!, Math.min(d.fromM, d.toM), Math.max(d.fromM, d.toM)).length).map((d) => d.number)
    : [];
  const levelName = data.dream.levels.find((l) => l.level === inputs.level)?.name ?? `level ${inputs.level}`;
  const routeName = files.manifest.route.name;
  if (printing)
    return (
      <TripBook
        plan={plan}
        data={data}
        geometry={files.geometry}
        attribution={files.manifest.attribution}
        auditedAt={files.manifest.created_at}
        routeName={routeName}
        levelName={levelName}
        link={isPrivate ? null : links.full}
        onDone={() => setPrinting(false)}
      />
    );

  const onExport = (k: ExportKind) => {
    const name = fileSafe(doc.name);
    if (k === "trip-book") return setPrinting(true);
    if (k === "trip-gpx") return download(`${name}.gpx`, "application/gpx+xml", tripGpx(plan, files.geometry));
    if (k === "ics") return download(`${name}.ics`, "text/calendar", calendarFile(plan, doc.id));
    download(`${name}.kilometrica.json`, "application/json", JSON.stringify(doc, null, 2));
  };
  const onGpx = (d: DayPlan) => download(`${fileSafe(doc.name)}-day-${d.number}.gpx`, "application/gpx+xml", dayGpx(plan, files.geometry, d));
  const setPassOn = (on: boolean) => {
    setPass(on);
    try {
      localStorage.setItem(PASS_KEY, on ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  const answer = (icon: ReactNode, label: string) => (
    <Button variant="outline" size="sm" isDisabled={readOnly} onPress={() => setEditing(true)}>
      {icon}
      {label}
    </Button>
  );

  const header = (
    <Header phase="plan" dreamHref={`/dream?route=${start.network}/${start.ref}`}>
      <span className="hidden text-muted-foreground lg:inline">{routeName}</span>
      {!readOnly && (
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" isDisabled={!history.canUndo} onPress={back} aria-label="Undo (Ctrl+Z)">
            <Icons.Undo2 data-icon="inline-start" />
            Undo
          </Button>
          <Button variant="ghost" size="sm" isDisabled={!history.canRedo} onPress={forward} aria-label="Redo (Ctrl+Y)">
            <Icons.Undo2 data-icon="inline-start" className="-scale-x-100" />
            Redo
          </Button>
        </span>
      )}
      <span className="flex items-center gap-2" title="Prototype switch: the teaser shows the outline only (D45)">
        <Switch id="trip-pass" isSelected={pass} onChange={setPassOn} />
        <Label htmlFor="trip-pass" className="font-normal">
          Trip Pass <span className="text-muted-foreground">(prototype)</span>
        </Label>
      </span>
    </Header>
  );

  return (
    <div className="min-h-screen bg-background font-sans text-sm text-foreground">
      {header}
      {!readOnly && (preview || (history.last && history.last !== hidden && changes?.summary)) && (
        <div className="sticky top-0 z-20">
          {preview ? (
            <ChangeBar
              mode="preview"
              label={preview.label}
              summary={changes?.summary || "The days stay as they are."}
              lines={changes?.lines ?? []}
              onApply={() => {
                commit(preview.state);
                setPreview(null);
              }}
              onDiscard={() => setPreview(null)}
            />
          ) : (
            <ChangeBar
              mode={history.last!.undone ? "undone" : "changed"}
              summary={changes!.summary}
              lines={changes!.lines}
              onUndo={back}
              onHide={() => setHidden(history.last)}
            />
          )}
        </div>
      )}

      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-7 pb-14 sm:px-8">
        {readOnly && (
          <Alert>
            <Icons.Share2 />
            <AlertTitle>A shared plan, read-only</AlertTitle>
            <AlertDescription>Keep a copy on this device to change it. Without a Trip Pass you see it as shared.</AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                onPress={() => {
                  setMeta((m) => ({ ...m, id: newId() }));
                  setReadOnly(false);
                }}
              >
                Keep a copy
              </Button>
            </AlertAction>
          </Alert>
        )}
        {stale && (
          <Alert>
            <Icons.Info />
            <AlertDescription>This plan was made on an earlier audit of the route; it has been re-timed on the current one.</AlertDescription>
          </Alert>
        )}
        {unloaded.length > 0 && (
          <Alert>
            <Icons.TriangleAlert className="text-headsup-foreground" />
            <AlertTitle>Some places didn't load for {dayList(unloaded)}</AlertTitle>
            <AlertDescription>Water, food and places to stay may be missing there. We don't say "none" where we don't know.</AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                isDisabled={retrying}
                onPress={() => {
                  setRetrying(true);
                  setAttempt((a) => a + 1);
                }}
              >
                {retrying ? "Trying…" : "Try again"}
              </Button>
            </AlertAction>
          </Alert>
        )}

        <div className="grid gap-3">
          <TitleBlock plan={shown} />
          {!editing && (
            <div role="group" aria-label="Your answers" className="flex flex-wrap items-center gap-2">
              {answer(<Icons.Calendar />, `Starts ${dayText(inputs.startDate)}`)}
              {answer(null, `${inputs.days} riding ${inputs.days === 1 ? "day" : "days"}`)}
              {answer(<Icons.Bike />, `${levelName}, ${inputs.bike === "ebike" ? "e-bike" : `${inputs.bike} bike`}`)}
              {answer(<Icons.Bed />, inputs.sleep === "mix" ? "Rooms or camping" : inputs.sleep === "rooms" ? "Rooms" : "Camping")}
              {answer(<Icons.Clock />, `Off at ${clock(inputs.startMinutes)}`)}
            </div>
          )}
        </div>

        <Alert className={calls.length ? "border-primary/30 bg-primary/5" : ""}>
          <Icons.Info className="text-primary" />
          <AlertTitle className="font-semibold">{plan.brief.readiness}</AlertTitle>
          {pass && !full && <AlertDescription>Loading the Trip Pass detail for this stretch…</AlertDescription>}
        </Alert>

        {free && !readOnly && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-3xl bg-muted px-5 py-4">
            <Icons.Info className="size-5 shrink-0 text-primary" />
            <div className="grid min-w-0 flex-[1_1_360px] gap-0.5">
              <span className="font-semibold">This is the outline of your trip</span>
              <span className="text-muted-foreground">
                A Trip Pass adds each day in full, the places to stay with their links, your calls, moving stops, the exports and sharing.
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-7">
          <div className="flex max-w-[620px] min-w-0 flex-[1_1_480px] flex-col gap-5">
            {editing && !readOnly && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">A few questions</CardTitle>
                  <CardDescription>We draft the whole trip from these. Each has a default; change any of them later.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <Questions
                    inputs={inputs}
                    levels={data.dream.levels}
                    daily={data.daily}
                    suggestedMonth={suggested}
                    datesConfirmed={datesConfirmed}
                    ownNights={ownNights(data, inputs.fromM, inputs.toM).length}
                    towns={data.stops.stops
                      .filter((s) => s.name && s.at_m > Math.min(inputs.fromM, inputs.toM) && s.at_m < Math.max(inputs.fromM, inputs.toM))
                      .sort((a, b) => (inputs.direction === "reverse" ? b.at_m - a.at_m : a.at_m - b.at_m))
                      .map((s) => ({ id: s.id, name: s.name! }))}
                    onRestIn={
                      plan
                        ? (id) => {
                            const at = data.stops.stops.find((s) => s.id === id)?.at_m ?? 0;
                            const night = plan.nights.reduce((b, n, i) => (Math.abs(n.stop.at_m - at) < Math.abs(plan.nights[b]!.stop.at_m - at) ? i : b), 0);
                            if (plan.nights.length) apply({ type: "rest-in", night, stop: id, add: true, current: plan.restAfter });
                          }
                        : undefined
                    }
                    readOnly={readOnly}
                    onChange={edit}
                  />
                  <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                    <Button size="lg" onPress={() => setEditing(false)}>
                      Show the plan
                      <Icons.ArrowRight data-icon="inline-end" />
                    </Button>
                    <span className="text-xs text-muted-foreground">Your answers stay in this browser. No account needed.</span>
                  </div>
                </CardContent>
              </Card>
            )}
            <Brief plan={shown} free={free} onShowDay={showDay} />
            <Calls
              calls={calls}
              free={free}
              readOnly={readOnly}
              previewing={preview ? `${preview.callId}/${preview.optionId}` : null}
              onOption={onOption}
              onShowDay={showDay}
            />
            <DayList plan={shown} selected={selected} onPick={(n) => setSelected(selected === n ? null : n)} free={free} changed={preview ? changes?.days : undefined} />
            <BeforeYouGo
              plan={plan}
              free={free}
              readOnly={readOnly}
              isPrivate={isPrivate}
              done={choices.done}
              onDone={toggleDone}
              onShowDay={showDay}
              onExport={onExport}
              links={links}
            />
            <Compare
              data={data}
              current={plan}
              pinned={pinned}
              readOnly={readOnly}
              onUnpin={(i) => setPinned((p) => p.filter((_, j) => j !== i))}
              onPin={() =>
                setPinned((p) => [
                  ...p.slice(-1),
                  {
                    label: `${String.fromCharCode(65 + p.length)}: ${inputs.days} days, ${inputs.sleep === "mix" ? "rooms or camping" : inputs.sleep}`,
                    inputs,
                    choices,
                  },
                ])
              }
            />
          </div>

          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
            <Card className="gap-0 overflow-hidden py-0">
              <PlanMap
                geometry={files.geometry}
                plan={shown}
                selectedDay={selected}
                onSelectDay={setSelected}
                attribution={files.manifest.attribution}
                className="h-[min(52vh,520px)] min-h-64 w-full"
              />
              <div className="border-t">
                <Profile
                  plan={shown}
                  effort={files.free.effort}
                  range={day && day.kind === "ride" ? { t0: day.fromT, t1: day.toT } : null}
                  onMoveStop={readOnly || free || day ? undefined : lockNight}
                  onPickDay={setSelected}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
                {day ? (
                  <>
                    <span>
                      Day {day.number} on the map and the profile.
                    </span>
                    <Button variant="link" size="xs" className="px-0" onPress={() => setSelected(null)}>
                      Show the whole trip
                    </Button>
                  </>
                ) : (
                  <span>Pick a day for its card.{!readOnly && !free ? " Drag a night's number along the profile to move it; that night is then kept." : ""}</span>
                )}
              </div>
            </Card>
            {day && (
              <DayCard
                plan={shown}
                data={data}
                day={day}
                free={free}
                readOnly={readOnly}
                choices={shown.choices}
                onLockNight={lockNight}
                onToggleBooked={(k) => {
                  const stop = plan.nights[k]?.stop.id;
                  if (stop) apply({ type: "booked", night: k, stop, on: !choices.booked.includes(k), date: plan.nights[k]?.date });
                }}
                onChooseBed={(k, id) => apply({ type: "bed", night: k, place: id })}
                onStay={(k, stop, place) => apply({ type: "stay", night: k, stop, place })}
                onToggleRest={(r) =>
                  apply({ type: "rest", afterRide: r, on: !plan.restAfter.includes(r), current: plan.restAfter, night: r - 1, stop: plan.nights[r - 1]?.stop.id })
                }
                onMoveRest={(from, to) => apply({ type: "rest-move", from, to, current: plan.restAfter, nights: plan.nights.map((n) => n.stop.id) })}
                onRemoveRest={(r) => apply({ type: "rest", afterRide: r, on: false, current: plan.restAfter })}
                onDone={toggleDone}
                onGpx={onGpx}
                onClose={() => setSelected(null)}
                onNext={() => setSelected(day.number + 1)}
              />
            )}
            <Card>
              <CardContent>
                <EffortChart plan={shown} selected={selected} onPick={(n) => setSelected(selected === n ? null : n)} changed={preview ? changes?.days : undefined} />
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Ends {dayText(shown.endDate)}. Kilometrica doesn't navigate or book: it hands you to the apps and sites that do.
        </p>
      </main>
    </div>
  );
}

/** "day 4", "days 15–21", "days 3, 7–9 and 12". */
const dayList = (ns: number[]) => `${ns.length === 1 ? "day" : "days"} ${numberList(ns)}`;

export function RiderApp() {
  const [{ start, itinerary, error }] = useState(readStart);
  useEffect(() => {
    if (!start) document.title = itinerary ? `${itinerary.name} · Kilometrica` : "Kilometrica Plan";
  }, [start, itinerary]);
  if (error)
    return (
      <Page wide={false}>
        <p className="text-destructive">{error}</p>
      </Page>
    );
  if (itinerary) return <ItineraryView it={itinerary} />;
  if (!start) return <StartPage />;
  return <PlanPage start={start} />;
}
