/**
 * Dream for riders (11.7, D48) in the new look (D53, D54): which stretch suits me, when, and which way (D35). It opens
 * on the whole route: its length, its countries and when each is good to ride, on a map of all of it. The rider
 * starts from an example or the chips; stretches appear once their level and days are known (nothing is assumed).
 * Every stretch that fits is counted, the best three are shown, two can be compared, and any stretch can be picked by
 * hand. "Plan this" opens Plan. Everything comes from the route's free files (D35); the audit viewer's Dream tab stays,
 * for us (D43). The question lives in the address, so a search can be shared or reopened.
 */
import type { DreamSection } from "@dpg/contracts";
import { type DreamRoute, fileNights, pickedStretch, planLink, stretchesFor, type StretchResult } from "@dpg/dream";
import { km } from "@dpg/planner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Icons,
  Label,
  LinkButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StretchCard,
} from "@dpg/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { loadDreamFiles, type DreamFiles } from "@dpg/routes";
import { useRouteList } from "../rider/routes";
import { Header } from "../shared/Header";
import {
  addressOf,
  and,
  type Ask,
  climbText,
  compareRows,
  countryRows,
  EMPTY,
  examplesFor,
  factsText,
  gradeText,
  keyOf,
  type Level,
  daysText,
  type Point,
  pointsOf,
  readAsk,
  stretchName,
  stretchSurfaces,
  whenText,
  whole,
  watchLines,
  whyLines,
} from "@dpg/dream";
import { type ChipId, Chips } from "./Chips";
import { DreamMap, type MapStretch } from "./DreamMap";
import { Glance } from "./Glance";

const SHOWN = 3;
const MORE = 5;
const OWN = "own";

type View = "results" | "compare" | "own";

/** The page around every Dream view: the header and a centred column. */
function Page({ routeName, children }: { routeName?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans text-sm text-foreground">
      <Header phase="dream">
        {routeName && <span className="text-muted-foreground">{routeName}</span>}
        {routeName && (
          <LinkButton href="/dream" variant="outline" size="sm">
            Change route
          </LinkButton>
        )}
      </Header>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-7 pb-14 sm:px-8">{children}</main>
    </div>
  );
}

/** The map in its card, with a legend. */
function MapCard({ files, stretches, focus, onPick, legend }: {
  files: DreamFiles;
  stretches: MapStretch[];
  focus: string | string[] | null;
  onPick: (key: string) => void;
  legend: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <DreamMap
        geometry={files.geometry}
        stretches={stretches}
        focus={focus}
        onPick={onPick}
        attribution={files.manifest.attribution}
        className="h-[min(62vh,620px)] min-h-80 w-full"
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground">{legend}</div>
    </Card>
  );
}

const Swatch = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-2">
    <span className={cn("h-1.5 w-6 rounded-full", className)} />
    {label}
  </span>
);

function BackTo({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <div>
      <Button variant="ghost" size="sm" onPress={onPress} className="-ml-2 text-muted-foreground">
        <Icons.ArrowLeft data-icon="inline-start" />
        {label}
      </Button>
    </div>
  );
}

/** Two stretches side by side, with the rows where they differ shaded. */
function Comparison({ pair, names, a, levels, titles, planOf }: {
  pair: StretchResult[];
  names: string[];
  a: Ask;
  levels: Level[];
  titles: Record<string, string>;
  /** Plan's address for a stretch. */
  planOf: (r: StretchResult) => string;
}) {
  // Shares of the stretch in words and km, never percentages (D57).
  const rows = compareRows(a, levels, titles);
  return (
    <Card className="gap-0 py-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className="w-56 px-5 py-4 text-left align-top text-xs font-normal text-muted-foreground">
                {a.days} days · {levels.find((l) => l.level === a.level)?.name}
              </th>
              {pair.map((r, i) => (
                <th key={keyOf(r)} scope="col" className={cn("border-l px-5 py-4 text-left align-top", i === 0 && "border-l-[3px] border-l-route-chosen")}>
                  <div className="flex flex-col gap-2.5">
                    <span className="flex items-center gap-2 text-base font-semibold">
                      <span className={cn("grid size-6 place-items-center rounded-full text-xs text-white", i === 0 ? "bg-route-chosen" : "bg-primary")}>{i + 1}</span>
                      {names[i]}
                    </span>
                    <div>
                      <LinkButton href={planOf(r)} variant={i === 0 ? "default" : "outline"} size="sm">
                        Plan this
                        <Icons.ArrowRight data-icon="inline-end" />
                      </LinkButton>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = pair.map(row.f);
              const differ = values[0] !== values[1];
              return (
                <tr key={row.label} className={cn("border-b last:border-b-0", differ && "bg-secondary/60")}>
                  <th scope="row" className="px-5 py-3 text-left align-top font-normal text-muted-foreground">
                    {row.label}
                  </th>
                  {values.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "border-l px-5 py-3 align-top tabular-nums",
                        row.tone === "watch" && pair[i]!.watch.length > 0 && "text-headsup-foreground",
                        row.tone === "unknown" && pair[i]!.check.length > 0 && "text-unknown-foreground",
                      )}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-5 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="size-3.5 rounded bg-secondary" />
          Rows where they differ
        </span>
        <span className="inline-flex items-center gap-1.5 text-headsup-foreground">
          <Icons.TriangleAlert className="size-3.5" />
          Something to watch
        </span>
        <span className="inline-flex items-center gap-1.5 text-unknown-foreground">
          <Icons.CircleHelp className="size-3.5" />
          Check yourself
        </span>
      </div>
    </Card>
  );
}

/** Any stretch, from one town to another, for riders who know where they want to go. */
function TownPicker({ points, from, to, onChange }: { points: Point[]; from: number | null; to: number | null; onChange: (from: number | null, to: number | null) => void }) {
  const pick = (label: string, value: number | null, set: (v: number | null) => void) => (
    <div className="grid min-w-0 flex-[1_1_220px] gap-1.5">
      <Label>{label}</Label>
      <Select
        aria-label={label}
        placeholder="Choose a town…"
        selectedKey={value === null ? null : String(value)}
        onSelectionChange={(k) => set(k === null ? null : Number(k))}
        className="w-full"
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {points.map((p, i) => (
            <SelectItem key={i} id={String(i)} textValue={p.name}>
              {p.name} <span className="text-muted-foreground">(km {km(p.m / 1000)})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {pick("From", from, (v) => onChange(v, to))}
      {pick("To", to, (v) => onChange(from, v))}
    </div>
  );
}

/** Where a stretch's days come from until the rider sets theirs. */
const daysNote = (fileNights: boolean) =>
  fileNights
    ? "The days follow the nights your route file marks; set your days above and we find the stops instead."
    : "The days are those of a usual day at your level; set your days above to change them.";

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
  const [view, setView] = useState<View>("results");

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

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const sections = useMemo(() => [...(files?.dream.sections ?? [])].sort((x, y) => x.from_m - y.from_m), [files]);
  const daily = useMemo(() => new Map((files?.daily ?? []).map((d) => [d.number, d])), [files]);
  const points = useMemo(() => pointsOf(sections, daily), [sections, daily]);
  const countries = useMemo(() => countryRows(sections).length, [sections]);
  const examples = useMemo(() => examplesFor(sections), [sections]);
  // The route as Dream's tools see it (D77): the page and the assistant work from the same functions.
  const dr: DreamRoute | null = useMemo(
    () => (files ? { id: route, name: files.manifest.route.name, dream: files.dream, daily: files.daily, userPlaces: files.userPlaces, own: files.manifest.visibility === "private" } : null),
    [files, route],
  );
  // A rider's own file is the trip (D76); until the rider sets their days, the nights it marks set them (D70, D78).
  const ownRoute = !!dr?.own;
  const fileNightsMarked = useMemo(() => (dr ? fileNights(dr) : false), [dr]);
  // Every stretch that fits is counted; the list shows the best few.
  const results = useMemo(() => (dr ? stretchesFor(dr, a) : []), [dr, a]);
  const shown = useMemo(() => results.slice(0, count), [results, count]);
  const ownResult = useMemo(() => (dr && own.from !== null && own.to !== null ? pickedStretch(dr, a, own.from, own.to) : null), [dr, a, own]);
  const byNumber = useMemo(() => new Map(sections.map((s: DreamSection) => [s.number, s])), [sections]);
  const span = (r: StretchResult) => ({ fromM: byNumber.get(r.first)?.from_m ?? 0, toM: byNumber.get(r.last)?.to_m ?? 0 });
  const planOf = (r: StretchResult) => (dr ? planLink(dr, r, a) : "");
  const pair = compare.map((k) => results.find((r) => keyOf(r) === k)).filter((r): r is StretchResult => !!r);

  const resultStretches: MapStretch[] = useMemo(
    () => shown.map((r, i) => ({ key: keyOf(r), ...span(r), on: picked === keyOf(r) || compare.includes(keyOf(r)), label: String(i + 1) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, byNumber, picked, compare],
  );
  const pairStretches: MapStretch[] = useMemo(
    () => pair.map((r, i) => ({ key: keyOf(r), ...span(r), on: i === 0, label: String(i + 1) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare, results, byNumber],
  );
  const ownStretches: MapStretch[] = useMemo(
    () => (ownResult ? [{ key: OWN, ...span(ownResult), on: true, label: "" }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownResult, byNumber],
  );

  if (error)
    return (
      <Page>
        <p className="text-destructive">{error}</p>
      </Page>
    );
  if (!files)
    return (
      <Page>
        <p className="text-muted-foreground">Loading the route…</p>
      </Page>
    );

  const routeName = files.manifest.route.name;
  const levels = files.dream.levels;
  const titles = Object.fromEntries(files.dream.themes.map((t) => [t.id, t.title]));
  const total = sections.reduce((s, x) => s + x.length_m, 0);
  const asked = a.level !== null && (a.days !== null || ownRoute);
  const change = (patch: Partial<Ask>) => {
    setA((x) => ({ ...x, ...patch }));
    setPicked(null);
    setCompare([]);
    setCount(SHOWN);
  };
  const toggleCompare = (r: StretchResult) =>
    setCompare((c) => (c.includes(keyOf(r)) ? c.filter((x) => x !== keyOf(r)) : [...c.slice(-1), keyOf(r)]));
  const chips = <Chips a={a} levels={levels} themes={files.dream.themes} open={open} onOpen={setOpen} onChange={change} />;
  const footnote = (
    <p className="text-xs text-muted-foreground">
      From the audit of {routeName}: {files.dream.climate_source}. Where we have no data we say so, and it becomes a check for you.
    </p>
  );

  if (view === "compare" && pair.length === 2) {
    const names = pair.map((r) => stretchName(daily, r));
    return (
      <Page routeName={routeName}>
        <BackTo label={`${results.length} stretches that fit`} onPress={() => setView("results")} />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight">Compare 2 stretches</h1>
          <p className="text-base text-muted-foreground">{names.join(" and ")}, side by side.</p>
        </div>
        <Comparison pair={pair} names={names} a={a} levels={levels} titles={titles} planOf={planOf} />
        <MapCard
          files={files}
          stretches={pairStretches}
          focus={pair.map(keyOf)}
          onPick={() => {}}
          legend={
            <>
              <Swatch className="bg-route-chosen" label={`1 ${names[0]}`} />
              <Swatch className="bg-route" label={`2 ${names[1]}`} />
            </>
          }
        />
        {footnote}
      </Page>
    );
  }

  if (view === "own") {
    const ownName = own.from !== null && own.to !== null ? `${points[own.from]!.name} → ${points[own.to]!.name}` : "";
    return (
      <Page routeName={routeName}>
        <BackTo label={asked ? `${results.length} stretches that fit` : "The whole route"} onPress={() => setView("results")} />
        {chips}
        <div className="flex flex-wrap items-start gap-7">
          <section aria-labelledby="own-title" className="flex max-w-[600px] min-w-0 flex-[1_1_480px] flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 id="own-title" className="text-3xl font-bold tracking-tight">
                Your own stretch
              </h1>
              <p className="text-muted-foreground">
                Any two towns on the route. We describe it the same way as the others, and warn you where it doesn't fit, but never rule it out.
              </p>
            </div>
            <TownPicker
              points={points}
              from={own.from}
              to={own.to}
              onChange={(from, to) => {
                setOwn({ from, to });
                setPicked(from !== null && to !== null && from !== to ? OWN : null);
              }}
            />
            {own.from !== null && own.to !== null && own.from !== own.to && a.level === null && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Icons.Info className="size-4" />
                Set your level above to see the days it takes and how hard it is.
              </p>
            )}
            {ownResult && (
              <StretchCard
                name={ownName}
                facts={factsText(ownResult, levels, a)}
                when={whenText(ownResult, a)}
                why={whyLines(ownResult).slice(0, 4)}
                watch={watchLines(ownResult)}
                checks={ownResult.check}
                chosen
                planHref={planOf(ownResult)}
              />
            )}
            {ownResult && a.days === null && (
              <p className="text-xs text-muted-foreground">{daysNote(fileNightsMarked)}</p>
            )}
          </section>
          <section aria-label="Map of your stretch" className="min-w-0 flex-[999_1_560px] lg:sticky lg:top-6">
            <MapCard
              files={files}
              stretches={ownStretches}
              focus={ownResult ? OWN : null}
              onPick={() => {}}
              legend={
                <>
                  <Swatch className="bg-muted-foreground/60" label={routeName} />
                  <Swatch className="bg-route-chosen" label={ownResult ? `Your stretch, ${km(ownResult.km)} km` : "Your stretch"} />
                </>
              }
            />
          </section>
        </div>
        {footnote}
      </Page>
    );
  }

  return (
    <Page routeName={routeName}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight text-balance">{asked ? `Find your stretch of ${routeName}` : routeName}</h1>
        <p className="text-base tabular-nums">
          {whole(total / 1000)} km · {sections.length} daily sections · {countries} {countries === 1 ? "country" : "countries"}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {chips}
        {!asked && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Icons.Info className="size-4 shrink-0" />
            {a.level === null && a.days === null
              ? "Set your level and the number of days, or start from an example, and we'll show every stretch that fits."
              : a.level === null
                ? "Now your level, to see the stretches that fit."
                : "Now how many days, to see the stretches that fit."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-7">
        {asked ? (
          <section aria-labelledby="results-title" className="flex max-w-[600px] min-w-0 flex-[1_1_480px] flex-col gap-3.5">
            <h2 id="results-title" className="text-lg font-semibold">
              {ownRoute ? "Your route" : results.length === 0 ? "Nothing fits" : results.length === 1 ? "One stretch fits" : `${results.length} stretches fit`}
              {results.length > shown.length && <span className="font-normal text-muted-foreground"> · the best {shown.length} shown</span>}
            </h2>
            {results.length === 0 && (
              <p className="text-muted-foreground">
                Every stretch is more than your level can do in these days, or misses something you asked for (trains at both ends, avoiding busy roads). Try more days, a higher level or fewer needs, or pick your own stretch below.
              </p>
            )}
            {ownRoute && a.days === null && results.length > 0 && (
              <p className="text-xs text-muted-foreground">{daysNote(fileNightsMarked)}</p>
            )}
            {shown.map((r, i) => (
              <StretchCard
                key={keyOf(r)}
                rank={i + 1}
                name={stretchName(daily, r)}
                facts={factsText(r, levels, a)}
                when={whenText(r, a)}
                why={whyLines(r).slice(0, 4)}
                watch={watchLines(r)}
                checks={r.check}
                chosen={picked === keyOf(r)}
                comparing={compare.includes(keyOf(r))}
                planHref={planOf(r)}
                onPick={() => setPicked(picked === keyOf(r) ? null : keyOf(r))}
                onCompare={() => toggleCompare(r)}
              />
            ))}
            {(results.length > shown.length || shown.length > SHOWN) && (
              <div className="flex flex-wrap gap-2">
                {results.length > shown.length && (
                  <Button variant="outline" className="flex-1" onPress={() => setCount(count + MORE)}>
                    Show {Math.min(MORE, results.length - shown.length)} more
                  </Button>
                )}
                {shown.length > SHOWN && (
                  <Button variant="ghost" onPress={() => setCount(SHOWN)}>
                    Show the best {SHOWN}
                  </Button>
                )}
              </div>
            )}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="font-semibold">Or pick your own stretch</CardTitle>
                <CardDescription>Choose any two towns on the route. We describe your stretch the same way, and warn you about it, but never rule it out.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onPress={() => setView("own")}>
                  <Icons.MapPin data-icon="inline-start" />
                  Pick two towns
                </Button>
              </CardContent>
            </Card>
          </section>
        ) : (
          <section aria-label="When to ride" className="max-w-[820px] min-w-0 flex-[1_1_740px]">
            <Glance sections={sections} month={a.month} onMonth={(m) => change({ month: m })} />
          </section>
        )}

        <section aria-label="Map of the route" className="flex min-w-0 flex-[999_1_480px] flex-col gap-4 lg:sticky lg:top-6">
          <MapCard
            files={files}
            stretches={asked ? resultStretches : []}
            focus={asked ? picked : null}
            onPick={(k) => setPicked(k)}
            legend={
              <>
                <Swatch className="bg-muted-foreground/60" label={routeName} />
                {asked && <Swatch className="bg-route" label="Fits your trip" />}
                {asked && <Swatch className="bg-route-chosen" label="Chosen or compared" />}
              </>
            }
          />
          {asked && pair.length > 0 && (
            <Card size="sm">
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold">{pair.length === 2 ? "Compare 2 stretches" : "Compare"}</span>
                  <span className="text-muted-foreground">
                    {pair.length === 2 ? pair.map((r) => stretchName(daily, r)).join(" and ") : "Tick one more stretch to compare the two side by side."}
                  </span>
                </div>
                <Button variant="secondary" isDisabled={pair.length < 2} onPress={() => setView("compare")}>
                  Compare
                </Button>
              </CardContent>
            </Card>
          )}
          {!asked && (
            <div className="flex flex-col gap-2.5">
              <h2 className="text-lg font-semibold">Start from an example trip</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {examples.map((e) => (
                  <Card key={e.title} size="sm">
                    <CardHeader>
                      <CardTitle className="font-semibold">{e.title}</CardTitle>
                      <CardDescription>{e.sub}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" onPress={() => change({ ...EMPTY, month: a.month, ...e.q })}>
                        Start from this
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="w-fit" onPress={() => setView("own")}>
                <Icons.MapPin data-icon="inline-start" />
                Or pick your own stretch, town to town
              </Button>
            </div>
          )}
        </section>
      </div>
      {footnote}
    </Page>
  );
}

function DreamStart() {
  const routes = useRouteList();
  useEffect(() => {
    document.title = "Kilometrica Dream";
  }, []);
  return (
    <Page>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight">Where would you like to ride?</h1>
        <p className="text-base text-muted-foreground">Pick a route; we'll find the stretches that suit you, when and which way.</p>
      </div>
      <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
        {routes.map((r) => (
          <Card key={r.route.id} size="sm">
            <CardHeader>
              <CardTitle className="font-semibold">{r.route.name}</CardTitle>
              <CardDescription>
                {km(r.summary.ride_length_m / 1000)} km{r.route.network === "user" ? " · your own route" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LinkButton href={`/dream?route=${r.route.network}/${r.route.ref.toLowerCase()}`} size="sm">
                Choose
                <Icons.ArrowRight data-icon="inline-end" />
              </LinkButton>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}

export function DreamApp() {
  const route = new URLSearchParams(window.location.search).get("route")?.toLowerCase() ?? null;
  if (!route || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(route)) return <DreamStart />;
  return <DreamRoute route={route} />;
}
