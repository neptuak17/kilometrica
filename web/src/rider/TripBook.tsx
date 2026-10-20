/**
 * The trip book (11.6, D55): the plan on paper, A4 portrait, saved as a PDF from the print dialog for when there's no
 * signal. It is drawn from the live plan each time, with the kit's pieces where the screens use them (D53). Page 1 is
 * the trip, page 2 before you go, then a page per day (a long day runs onto a second sheet), and about this book last.
 *
 * It reads in black and white: every colour also has its icon or word, and nothing is filled in but the effort bars.
 * Paper can't open links, so phone numbers and web addresses are written out. Our places have no street addresses, so
 * none are printed (D37). Route sketches are drawn from our own route data, never map tiles.
 */
import type { Place } from "@dpg/contracts";
import {
  bedsKnown,
  clock,
  day as dayText,
  dayIndex,
  dayItems,
  dayStory,
  type DayPlan,
  foodOnDay,
  type Geometry,
  type Handoff,
  hours,
  km,
  KNOWN_ENOUGH,
  locate,
  monthOf,
  oneIn,
  placeLinks,
  type PlanData,
  type PlanItem,
  type PlanResult,
  slice,
  stopName,
  WEEKDAYS_LONG,
  weekday,
  wikiLinks,
} from "@dpg/planner";
import { Button, cn, EffortChart, ElevationProfile, Icons } from "@dpg/ui";
import { type ReactNode, useEffect, useMemo } from "react";
import { GROUPS, Qr } from "./BeforeYouGo";
import { TOPIC } from "./Brief";
import { dayFacts } from "./dayFacts";
import { eleAt } from "./Profile";

interface Props {
  plan: PlanResult;
  data: PlanData;
  geometry: Geometry;
  /** Every credit the route's data requires (the bundle's attribution). */
  attribution: string[];
  /** When the route was audited (ISO). */
  auditedAt: string;
  routeName: string;
  levelName: string;
  /** The plan's link for the QR code; null for a plan on a private route. */
  link: string | null;
  onDone: () => void;
}

const BIKE: Record<string, string> = { touring: "touring bike", road: "road bike", gravel: "gravel bike", ebike: "e-bike" };
const SLEEP: Record<string, string> = { rooms: "rooms", camping: "camping", mix: "rooms or camping" };
const EFFORT: Record<string, { word: string; dot: string }> = {
  within: { word: "Within your level", dot: "bg-effort-within" },
  harder: { word: "A harder day", dot: "bg-effort-harder" },
  beyond: { word: "Beyond your level", dot: "bg-effort-beyond" },
};

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** A web address as it reads on paper: no scheme, no "www.", no query, at most 44 characters. */
function address(url: string): string {
  const plain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  return cut(plain, 44);
}

/** A hand-off written out for paper (D41): the number, the address, the article; map links have no paper form. */
function handoffText(h: Handoff): string | null {
  if (h.kind === "phone") return h.label;
  // "Hôtel Sainte-Anne: Website" keeps its name: "Hôtel Sainte-Anne: hotel-sainte-anne.fr".
  if (h.kind === "website") return h.label.endsWith("Website") ? `${h.label.slice(0, -"Website".length)}${address(h.url)}` : address(h.url);
  if (h.kind === "rail" || h.kind === "ferry") return `${h.label} · ${address(h.url)}`;
  if (h.kind === "wiki") {
    const title = decodeURIComponent(h.url.split("/wiki/")[1] ?? "").replaceAll("_", " ");
    return title ? `${h.label}: ${title}` : h.label;
  }
  return null;
}
/** Several hand-offs on one line, each place's number and address together under its name. */
function handoffsText(hs: Handoff[]): string {
  const byName = new Map<string, string[]>();
  for (const t of hs.map(handoffText)) {
    if (!t) continue;
    const at = t.indexOf(": ");
    const [name, value] = at > 0 && !t.startsWith("Wikipedia") ? [t.slice(0, at), t.slice(at + 2)] : ["", t];
    const list = byName.get(name) ?? [];
    if (!list.includes(value)) list.push(value);
    byName.set(name, list);
  }
  return [...byName].map(([name, values]) => (name ? `${name}: ${values.join(", ")}` : values.join(" · "))).join(" · ");
}

function Sheet({ page, pages, left, children }: { page: number; pages: number; left: string; children: ReactNode }) {
  return (
    <section className="mx-auto flex min-h-[296mm] w-[210mm] flex-col gap-3 bg-white px-[12mm] pt-[10mm] pb-[7mm] text-[13.5px] leading-snug text-foreground tabular-nums shadow-md not-last:break-after-page print:mx-0 print:shadow-none">
      {children}
      <footer className="mt-auto flex justify-between gap-4 border-t pt-2 text-xs text-muted-foreground">
        <span>{left}</span>
        <span>
          Page {page} of {pages}
        </span>
      </footer>
    </section>
  );
}

const Kicker = ({ children }: { children: ReactNode }) => <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</span>;

/** A tick box to mark with a pen; ticked when the plan already says so. */
const Tick = ({ on = false }: { on?: boolean }) => (
  <span aria-hidden="true" className="mt-0.5 grid size-[14px] shrink-0 place-items-center rounded-[3px] border-[1.5px] border-foreground">
    {on && <Icons.Check className="size-3" strokeWidth={3} />}
  </span>
);

/** A label and its content, side by side: the day pages' sections. */
function Part({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-1.5 font-semibold [&_svg]:size-[15px]">
        {icon}
        {label}
      </div>
      <div className="grid min-w-0 gap-1">{children}</div>
    </>
  );
}

// --- route sketches: our own geometry, projected flat; no map tiles (D55) ---------------------------------------

type Pt = [number, number];
interface Label {
  at: Pt;
  text: string;
  /** Room to leave around the point (a marker's radius). */
  r: number;
  strong?: boolean;
  muted?: boolean;
}

function projector(all: Pt[], w: number, h: number, pad: number) {
  const lons = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = Math.min((w - 2 * pad) / Math.max((x1 - x0) * k, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return (p: Pt): Pt => [w / 2 + (p[0] - cx) * k * s, h / 2 - (p[1] - cy) * s];
}

/** Labels beside their points, right, left, above or below, wherever they fit without covering another; else left out. */
function placeLabels(labels: Label[], w: number, h: number, taken: [number, number, number, number][]) {
  const out: { x: number; y: number; anchor: "start" | "end" | "middle"; l: Label }[] = [];
  const boxes = [...taken];
  for (const l of labels) {
    const tw = l.text.length * 6.4;
    const [x, y] = l.at;
    // Centred labels stay inside the edges; a second, farther ring is tried when the near one is full.
    const mx = Math.min(Math.max(x, tw / 2 + 2), w - tw / 2 - 2);
    const ring = (d: number): [number, number, "start" | "end" | "middle", [number, number, number, number]][] => [
      [x + d, y + 4, "start", [x + d, y - 8, x + d + tw, y + 5]],
      [x - d, y + 4, "end", [x - d - tw, y - 8, x - d, y + 5]],
      [mx, y - d - 1, "middle", [mx - tw / 2, y - d - 13, mx + tw / 2, y - d]],
      [mx, y + d + 9, "middle", [mx - tw / 2, y + d - 2, mx + tw / 2, y + d + 11]],
      [x + d, y - d, "start", [x + d, y - d - 12, x + d + tw, y - d + 1]],
      [x + d, y + d + 8, "start", [x + d, y + d - 4, x + d + tw, y + d + 9]],
      [x - d, y - d, "end", [x - d - tw, y - d - 12, x - d, y - d + 1]],
      [x - d, y + d + 8, "end", [x - d - tw, y + d - 4, x - d, y + d + 9]],
    ];
    const tries = [...ring(l.r + 4), ...ring(l.r + 16)];
    const fit = tries.find(([, , , b]) => b[0] >= 2 && b[2] <= w - 2 && b[1] >= 2 && b[3] <= h - 2 && !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]));
    if (!fit) continue;
    boxes.push(fit[3]);
    out.push({ x: fit[0], y: fit[1], anchor: fit[2], l });
  }
  return out;
}

const box = ([x, y]: Pt, r: number): [number, number, number, number] => [x - r, y - r, x + r, y + r];
/** The drawn line as small boxes every few units, so labels sit beside the route, not on it. */
function lineBoxes(segs: Pt[][], P: (p: Pt) => Pt): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const seg of segs) {
    let last: Pt | null = null;
    for (const p of seg.map(P)) {
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 6) continue;
      out.push(box(p, 3.5));
      last = p;
    }
  }
  return out;
}
const points = (seg: Pt[], P: (p: Pt) => Pt) => seg.map((p) => P(p).map((v) => v.toFixed(1)).join(",")).join(" ");

function SketchLabels({ placed }: { placed: ReturnType<typeof placeLabels> }) {
  return (
    <>
      {placed.map(({ x, y, anchor, l }, i) => (
        <text key={i} x={x} y={y} textAnchor={anchor} className={cn("text-[12px]", l.strong && "font-semibold", l.muted ? "fill-muted-foreground" : "fill-foreground")}>
          {l.text}
        </text>
      ))}
    </>
  );
}

/** The whole trip: the line, the nights numbered (two nights in one place share a marker), start and end. */
function TripSketch({ plan, geometry }: { plan: PlanResult; geometry: Geometry }) {
  const W = 640;
  const H = 250;
  const segs = slice(geometry, plan.inputs.fromM, plan.inputs.toM) as Pt[][];
  const groups: { stop: PlanResult["nights"][number]["stop"]; nums: number[] }[] = [];
  for (const n of plan.nights) {
    const last = groups[groups.length - 1];
    if (last && last.stop.id === n.stop.id) last.nums.push(n.index + 1);
    else groups.push({ stop: n.stop, nums: [n.index + 1] });
  }
  const first = segs[0]?.[0];
  const lastSeg = segs[segs.length - 1];
  const end = lastSeg?.[lastSeg.length - 1];
  if (!first || !end) return null;
  const P = projector([...segs.flat(), ...groups.map((g) => [g.stop.lon, g.stop.lat] as Pt)], W, H, 28);
  const marks = groups.map((g) => ({ g, at: P([g.stop.lon, g.stop.lat]), text: g.nums.join("·") }));
  const ends = [P(first), P(end)];
  const rides = plan.days.filter((d) => d.kind === "ride");
  const placed = placeLabels(
    [
      { at: ends[0]!, text: `${rides[0]?.startName ?? "Start"} (start)`, r: 8, strong: true },
      { at: ends[1]!, text: `${rides[rides.length - 1]?.endName ?? "End"} (end)`, r: 8, strong: true },
      ...marks.map((m) => ({ at: m.at, text: stopName(m.g.stop), r: 12 })),
    ],
    W,
    H,
    [...marks.map((m) => box(m.at, 12)), ...ends.map((e) => box(e, 8)), ...lineBoxes(segs, P)],
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route sketch with the nights numbered" className="block h-[50mm] w-full">
      {segs.map((s, i) => (
        <polyline key={i} points={points(s, P)} className="fill-none stroke-route stroke-[5] [stroke-linecap:round] [stroke-linejoin:round]" />
      ))}
      {ends.map((e, i) => (
        <circle key={i} cx={e[0]} cy={e[1]} r={7} className="fill-white stroke-foreground stroke-[2.5]" />
      ))}
      {marks.map(({ at, text }, i) => {
        const wide = text.length > 1;
        return (
          <g key={i}>
            {wide ? (
              <rect x={at[0] - 7 - text.length * 3.4} y={at[1] - 11} width={14 + text.length * 6.8} height={22} rx={11} className="fill-foreground" />
            ) : (
              <circle cx={at[0]} cy={at[1]} r={11} className="fill-foreground" />
            )}
            <text x={at[0]} y={at[1] + 4} textAnchor="middle" className="fill-white text-[12px] font-bold">
              {text}
            </text>
          </g>
        );
      })}
      <SketchLabels placed={placed} />
    </svg>
  );
}

/** One day: km marks every 10 km, water and food, heads-ups and highlights, the plan B and the night's stop. */
function DaySketch({ plan, data, d, geometry }: { plan: PlanResult; data: PlanData; d: DayPlan; geometry: Geometry }) {
  const W = 640;
  const H = 190;
  const facts = dayFacts(plan, data, d, !data.full);
  const mine = dayItems(plan.items, d.number);
  const segs = slice(geometry, d.fromM, d.toM) as Pt[][];
  const night = facts.night;
  const planB = night ? [night.planB.before?.stop, night.planB.after?.stop].filter((s): s is NonNullable<typeof s> => !!s) : [];
  const first = segs[0]?.[0];
  const lastSeg = segs[segs.length - 1];
  const end = lastSeg?.[lastSeg.length - 1];
  if (!first || !end) return null;
  const P = projector([...segs.flat(), ...planB.map((s) => [s.lon, s.lat] as Pt), ...(night ? [[night.stop.lon, night.stop.lat] as Pt] : [])], W, H, 26);
  const at = (m: number) => {
    const p = locate(geometry, m);
    return p ? P(p) : null;
  };
  // Km marks: a short tick across the line, its km beside it.
  const ticks: { k: number; a: Pt; b: Pt; c: Pt }[] = [];
  for (let k = 10; k < d.km - 3; k += 10) {
    const m = plan.axis.mOf(d.fromT + k * 1000);
    const p = at(m);
    const q = at(m + (plan.inputs.direction === "reverse" ? -60 : 60));
    if (!p || !q) continue;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const [nx, ny] = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
    ticks.push({ k, a: [p[0] - nx * 7, p[1] - ny * 7], b: [p[0] + nx * 7, p[1] + ny * 7], c: [p[0] + nx * 17, p[1] + ny * 17 + 4] });
  }
  const water = facts.thinned.map((w) => at(w.p.access_at_m)).filter((p): p is Pt => !!p);
  const stretch = (i: PlanItem) => {
    const a = Math.min(i.fromM!, i.toM ?? i.fromM!);
    const b = Math.max(i.fromM!, i.toM ?? i.fromM!);
    return (b - a < 300 ? slice(geometry, a - 150, b + 150) : slice(geometry, a, b)) as Pt[][];
  };
  const heads = mine.headsups.shown.filter((i) => i.fromM !== null && i.handoffs.some((h) => h.kind === "street"));
  const sights = mine.highlights.shown.filter((i) => i.fromM !== null).map((i) => ({ i, p: at(i.fromM!) })).filter((x): x is { i: PlanItem; p: Pt } => !!x.p);
  const bs = planB.map((s) => ({ s, p: P([s.lon, s.lat]) }));
  const stay = night ? P([night.stop.lon, night.stop.lat]) : null;
  const [s0, s1] = [P(first), P(end)];
  const placed = placeLabels(
    [
      { at: s0, text: d.startName, r: 8, strong: true },
      { at: stay ?? s1, text: d.endName, r: stay ? 11 : 8, strong: true },
      ...heads.map((i) => {
        const seg = stretch(i)[0] ?? [];
        const mid = seg[Math.floor(seg.length / 2)];
        return { at: mid ? P(mid) : s0, text: `! ${cut(i.short ?? i.title, 26)}`, r: 6, strong: true };
      }),
      ...sights.map(({ i, p }) => ({ at: p, text: cut(i.short ?? i.title, 24), r: 8 })),
      ...bs.map(({ s, p }) => ({ at: p, text: `Plan B: ${stopName(s)}`, r: 9, muted: true })),
      ...ticks.map((t, n) => ({ at: t.c, text: n === 0 ? `km ${t.k}` : String(t.k), r: 0, muted: true })),
    ],
    W,
    H,
    [box(s0, 8), box(s1, 8), ...(stay ? [box(stay, 11)] : []), ...sights.map((x) => box(x.p, 8)), ...bs.map((x) => box(x.p, 9)), ...lineBoxes(segs, P)],
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sketch of day ${d.number} from ${d.startName} to ${d.endName}`} className="block h-[40mm] w-full">
      {segs.map((s, i) => (
        <polyline key={i} points={points(s, P)} className="fill-none stroke-route-chosen stroke-[4.5] [stroke-linecap:round] [stroke-linejoin:round]" />
      ))}
      {heads.flatMap((i) =>
        stretch(i).map((s, n) => (
          <polyline key={`${i.id}-${n}`} points={points(s, P)} className="fill-none stroke-foreground stroke-[9] [stroke-dasharray:4_3]" />
        )),
      )}
      {ticks.map((t) => (
        <line key={t.k} x1={t.a[0]} y1={t.a[1]} x2={t.b[0]} y2={t.b[1]} className="stroke-foreground stroke-[1.5]" />
      ))}
      {water.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4.5} className="fill-foreground" />
      ))}
      {sights.map(({ i, p }) => (
        <rect key={i.id} x={p[0] - 7} y={p[1] - 7} width={14} height={14} transform={`rotate(45 ${p[0]} ${p[1]})`} className="fill-white stroke-foreground stroke-2" />
      ))}
      {bs.map(({ s, p }) => (
        <circle key={s.id} cx={p[0]} cy={p[1]} r={9} className="fill-white stroke-foreground stroke-2 [stroke-dasharray:3_3]" />
      ))}
      <circle cx={s0[0]} cy={s0[1]} r={7} className="fill-white stroke-foreground stroke-[2.5]" />
      {stay && night ? (
        <g>
          <circle cx={stay[0]} cy={stay[1]} r={11} className="fill-foreground" />
          <text x={stay[0]} y={stay[1] + 4} textAnchor="middle" className="fill-white text-[12px] font-bold">
            {night.index + 1}
          </text>
        </g>
      ) : (
        <circle cx={s1[0]} cy={s1[1]} r={7} className="fill-white stroke-foreground stroke-[2.5]" />
      )}
      <SketchLabels placed={placed} />
    </svg>
  );
}

const Legend = ({ items }: { items: [ReactNode, string][] }) => (
  <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
    {items.map(([mark, text]) => (
      <span key={text} className="inline-flex items-center gap-1.5">
        {mark}
        {text}
      </span>
    ))}
    <span className="flex-1" />
    <span>Our route data, not a map: navigate with your GPX.</span>
  </figcaption>
);
const NIGHT_MARK = <span className="grid size-4 place-items-center rounded-full bg-foreground text-[10px] font-bold text-white">1</span>;
const DOT = <span className="size-2.5 rounded-full bg-foreground" />;
const DASH = <span className="h-[7px] w-4 bg-[repeating-linear-gradient(90deg,var(--foreground)_0_4px,transparent_4px_7px)]" />;
const DIAMOND = <span className="size-2.5 rotate-45 border-2 border-foreground" />;
const PLAN_B = <span className="size-3 rounded-full border-2 border-dashed border-foreground" />;

// --- the pages ---------------------------------------------------------------------------------------------------

function TripPage({ plan, geometry, routeName, levelName, link, pages, pageOf }: Props & { pages: number; pageOf: (n: number) => number }) {
  const b = plan.brief;
  const rides = plan.days.filter((d) => d.kind === "ride").length;
  const rests = plan.days.length - rides;
  return (
    <Sheet page={1} pages={pages} left={`${b.title} · Kilometrica trip book`}>
      <header className="grid gap-1">
        <Kicker>Kilometrica trip book · {routeName}</Kicker>
        <h1 className="text-[30px] leading-tight font-bold tracking-tight">{b.title}</h1>
        <p className="text-[15px]">
          {b.dates} · {rides} riding {rides === 1 ? "day" : "days"}
          {rests ? ` and ${rests === 1 ? "a rest day" : `${rests} rest days`}` : ""} · {km(b.km)} km · {Math.round(b.climbM).toLocaleString("en-GB")} m of
          climbing · {b.direction === "forward" ? "as the route runs" : "the other way"}
        </p>
        <p className="text-xs text-muted-foreground">
          {levelName}, {BIKE[plan.inputs.bike] ?? plan.inputs.bike} · {SLEEP[plan.inputs.sleep] ?? plan.inputs.sleep} · off at {clock(plan.inputs.startMinutes)}
        </p>
      </header>

      <figure className="m-0 overflow-hidden rounded-xl border">
        <div className="px-3 pt-2">
          <TripSketch plan={plan} geometry={geometry} />
        </div>
        <Legend items={[[NIGHT_MARK, "Night's stop"], [<span key="o" className="size-3 rounded-full border-2 border-foreground" />, "Start and end"]]} />
      </figure>

      <div className="grid grid-cols-2 items-start gap-6">
        <section className="grid">
          <h2 className="mb-0.5 text-lg font-semibold">The trip at a glance</h2>
          {b.lines.map((l, i) => (
            <div key={l.topic} className={cn("grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 py-1.5", i < b.lines.length - 1 && "border-b")}>
              <span className="pt-0.5 [&_svg]:size-4">{TOPIC[l.topic]?.icon}</span>
              <div className="grid">
                <span className="text-xs text-muted-foreground">{l.question}</span>
                <span>
                  {l.answer}
                  {l.topic === "prepare" ? " See page 2." : l.more > 0 ? ` +${l.more} more in this book.` : ""}
                </span>
              </div>
            </div>
          ))}
        </section>
        <EffortChart
          days={b.effort.map((e) => ({ day: e.day, hours: e.hours, label: hours(e.hours), effort: e.effort }))}
          usual={plan.usual.hours}
          usualLabel={`Your usual day at ${plan.level.name}, about ${hours(plan.usual.hours)}`}
        />
      </div>

      <div className="grid grid-cols-2 items-start gap-6">
        <section className="grid">
          <h2 className="mb-1 text-lg font-semibold">The days</h2>
          {plan.days.map((d) => (
            <div key={d.number} className="grid grid-cols-[108px_minmax(0,1fr)_50px_30px] gap-1.5 border-b py-0.5">
              <span className="font-semibold">
                Day {d.number} · {dayText(d.date).replace(/ \w+$/, "")}
              </span>
              <span className="truncate">{d.kind === "rest" ? `Rest day at ${d.endName}` : `→ ${d.endName}`}</span>
              <span className="text-right">{d.kind === "ride" ? `${km(d.km)} km` : ""}</span>
              <span className="text-right text-muted-foreground">p. {pageOf(d.number)}</span>
            </div>
          ))}
        </section>
        <section className="grid gap-3.5">
          <div className="grid gap-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Icons.CircleHelp className="size-4" />
              How well we know these days
            </h2>
            <p>{b.confidence.map((c) => cap(c)).join(". ")}.</p>
          </div>
          {link ? (
            <div className="flex items-center gap-3.5">
              <Qr text={link} className="size-[26mm] rounded-lg p-1" />
              <p>Scan to open this plan on your phone, with its links and any changes since. The link holds the plan; nothing is stored on our side.</p>
            </div>
          ) : (
            <p className="text-muted-foreground">This plan is on your own route, which stays private: open it from your plan file.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

function BeforeYouGoPage({ plan, pages, pageOf }: { plan: PlanResult; pages: number; pageOf: (n: number) => number }) {
  const todos = plan.items.filter((i) => i.kind === "todo");
  const calls = plan.items.filter((i) => i.kind === "call" && !plan.choices.dismissed.includes(i.id));
  const groups = [{ title: "Still your call", items: calls }, ...GROUPS.map((g) => ({ title: g.title, items: todos.filter(g.test) }))].filter((g) => g.items.length);
  const counts = [calls.length && `${calls.length} ${calls.length === 1 ? "call" : "calls"} still yours`, todos.length && `${todos.length} things to sort out`].filter(Boolean);
  return (
    <Sheet page={2} pages={pages} left={`${plan.brief.title} · Kilometrica trip book`}>
      <header className="grid gap-1">
        <Kicker>{plan.brief.title}</Kicker>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">Before you go</h1>
        <p className="text-[15px]">{counts.length ? `${counts.join(", ")}. Tick them off as you go.` : "Nothing to sort out."}</p>
      </header>
      {groups.map((g) => (
        <section key={g.title} className="grid">
          <h2 className="mb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h2>
          {g.items.map((i) => {
            const where = [handoffsText(i.handoffs), i.day !== null ? `Day ${i.day}, page ${pageOf(i.day)}` : ""].filter(Boolean).join(" · ");
            return (
              <div key={i.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 border-b py-1.5 break-inside-avoid">
                <Tick on={plan.choices.done.includes(i.id)} />
                <div className="grid">
                  <span>{i.title}</span>
                  <span className="text-[12.5px] text-muted-foreground">{i.why}</span>
                  {where && <span className="text-[12.5px]">{where}</span>}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
        <Icons.Info className="mt-0.5 size-3.5 shrink-0" />
        Each day's page lists up to 6 places to stay with their phone numbers and web addresses. Links can't be clicked on paper, so they're written out.
      </p>
    </Sheet>
  );
}

function DayPage({ plan, data, d, geometry, page, pages }: { plan: PlanResult; data: PlanData; d: DayPlan; geometry: Geometry; page: number; pages: number }) {
  const free = !data.full;
  const f = dayFacts(plan, data, d, free);
  const mine = dayItems(plan.items, d.number);
  const night = f.night;
  const range = d.hoursFast !== d.hoursSlow && Math.abs(d.hoursSlow - d.hoursFast) > 0.05;
  const eat = foodOnDay(data, d);
  const profile = useMemo(() => {
    const n = 300;
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = d.fromT + ((d.toT - d.fromT) * i) / n;
      return { km: (t - d.fromT) / 1000, m: eleAt(data.effort, plan.axis.mOf(t)) };
    });
  }, [plan, data.effort, d]);
  const booked = night ? plan.choices.booked.includes(night.index) : false;
  const chosen = night ? plan.choices.beds[night.index] : undefined;
  return (
    <Sheet page={page} pages={pages} left={`${plan.brief.title} · Day ${d.number} · ${dayText(d.date)}`}>
      <header className="flex items-end justify-between gap-4">
        <div className="grid min-w-0 gap-0.5">
          <Kicker>
            Day {d.number} · {dayText(d.date)}
          </Kicker>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight text-balance">
            {d.startName} → {d.endName}
          </h1>
          <span className="text-[15px]">
            {km(d.km)} km · {Math.round(d.climbM).toLocaleString("en-GB")} m of climbing
            {d.unknownKm >= 1 && ` (at least: terrain unknown for ${km(d.unknownKm)} km)`}
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-0.5 text-[13px]">
          <span className={cn("size-2.5 rounded-full", EFFORT[d.effort]!.dot)} />
          {EFFORT[d.effort]!.word}
        </span>
      </header>

      <dl className="grid grid-cols-5 rounded-lg border">
        {[
          ["Riding", range ? `${hours(d.hoursFast)}–${hours(d.hoursSlow)}` : hours(d.hoursSlow)],
          ["With stops", `about ${hours(d.hoursSlow + d.stopsMin / 60)}`],
          ["Off at", clock(d.startMinutes)],
          ["In by", clock(d.endMinutes)],
          ["Sunset", d.sunset !== null ? `${clock(d.sunset)}${d.clockApprox ? " (approx.)" : ""}` : "–"],
        ].map(([k, v], i) => (
          <div key={k} className={cn("px-3 py-1.5", i < 4 && "border-r")}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[15px]">
        {dayStory(data, d, plan.items)}
        {d.steepest && <span className="text-[12.5px] text-muted-foreground"> Steepest 500 m: {Math.round(d.steepest.grade)}% at km {Math.round(d.steepest.atKm)}.</span>}
      </p>

      <figure className="m-0 overflow-hidden rounded-lg border break-inside-avoid">
        <div className="px-3 pt-1.5">
          <DaySketch plan={plan} data={data} d={d} geometry={geometry} />
        </div>
        <ElevationProfile points={profile} tone="chosen" marks={10} label={`Elevation for day ${d.number}`} className="border-t px-3 pt-1.5 pb-0.5 [&>div:first-child]:h-16" />
        <Legend items={[[DOT, "Water, food"], [DASH, "Heads-up"], [DIAMOND, "Highlight"], [PLAN_B, "Plan B"]]} />
      </figure>

      {free ? (
        <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
          <Icons.Lock className="mt-0.5 size-4 shrink-0" />
          Water and food, heads-ups, highlights, where to sleep and the plan B for this day come with a Trip Pass.
        </p>
      ) : (
        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-4 gap-y-2">
          <Part icon={<Icons.Droplet />} label="Water, food">
            {f.waterFood.length ? (
              <span>
                km {f.thinned.map((w) => Math.round(w.at)).join(" · ")}
                {!f.unloaded.length && `. Longest gap ${Math.round(f.longest)} km.`}
              </span>
            ) : (
              !f.unloaded.length && <span>None that counts along this day: you judge what to carry.</span>
            )}
            {f.unloaded.length > 0 && (
              <span className="flex items-start gap-1.5 text-[12.5px] text-unknown-foreground">
                <Icons.CircleHelp className="mt-0.5 size-3.5 shrink-0" />
                Places for {f.unloaded.map(([a, b]) => `km ${a}–${b}`).join(", ")} didn't load: any there aren't listed.
              </span>
            )}
            {eat && eat.all > 0 && eat.known / eat.all < KNOWN_ENOUGH && (
              <span className="flex items-start gap-1.5 text-[12.5px] text-unknown-foreground">
                <Icons.CircleHelp className="mt-0.5 size-3.5 shrink-0" />
                We're not sure when food places are open: check ahead.
              </span>
            )}
          </Part>
          {mine.calls.length > 0 && (
            <Part icon={<Icons.Route />} label="Your call">
              {mine.calls.map((i) => (
                <span key={i.id}>{i.title}</span>
              ))}
            </Part>
          )}
          {mine.headsups.shown.length > 0 && (
            <Part icon={<Icons.TriangleAlert />} label="Heads-up">
              {mine.headsups.shown.map((i) => (
                <span key={i.id}>{i.title}</span>
              ))}
              {mine.headsups.more > 0 && <span className="text-[12.5px] text-muted-foreground">+{mine.headsups.more} more in the plan.</span>}
            </Part>
          )}
          {mine.highlights.shown.length > 0 && (
            <Part icon={<Icons.Check />} label="Highlights">
              {mine.highlights.shown.map((i) => {
                const wiki = handoffsText(i.handoffs.filter((h) => h.kind === "wiki"));
                return (
                  <span key={i.id}>
                    {i.title}
                    {wiki && <span className="text-[12.5px] text-muted-foreground"> {wiki}.</span>}
                  </span>
                );
              })}
            </Part>
          )}
          {mine.todos.length > 0 && (
            <Part icon={<Icons.Flag />} label="Before you go">
              <span>
                {mine.todos.length} {mine.todos.length === 1 ? "thing" : "things"} to sort out for this day: page 2.
              </span>
            </Part>
          )}
          {night && (
            <Part icon={<Icons.Bed />} label="Sleep">
              <span className="flex flex-wrap items-center gap-x-3">
                <span>
                  <b>{stopName(night.stop)}</b>: {bedsKnown(night.beds, f.month, "places to stay")}.{night.beds.count ? " Open first, then nearest." : ""}
                </span>
                {booked && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Icons.Check className="size-3.5" />
                    Booked
                  </span>
                )}
              </span>
              {f.beds.length > 0 && (
                <div className="grid grid-cols-2 overflow-hidden rounded-lg border">
                  {f.beds.slice(0, 6).map((p, i, all) => (
                    <BedCell key={p.id} p={p} month={f.month} code={p.months[monthOf(night.date)]} chosen={chosen === p.id} right={i % 2 === 0} bottom={i < all.length - (all.length % 2 === 0 ? 2 : 1)} />
                  ))}
                </div>
              )}
              {f.bedsUnloaded && <span className="text-[12.5px] text-unknown-foreground">The names of places to stay here didn't load: the count is from the route's stops.</span>}
              <span className="text-[12.5px]">
                {f.beds.length > 6 && `+${f.beds.length - 6} more: scan the QR code on page 1. `}
                <b>Plan B:</b> {f.planB || "no other stop of your kind nearby."}
              </span>
            </Part>
          )}
          {f.stations.length > 0 && (
            <Part icon={<Icons.Train />} label="Bail-out">
              <span>
                {f.stations
                  .slice(0, 6)
                  .map((s) => `${s.p.name ?? "Station"} (km ${Math.round(s.at)})`)
                  .join(" · ")}
              </span>
            </Part>
          )}
        </div>
      )}
    </Sheet>
  );
}

function BedCell({ p, month, code, chosen, right, bottom }: { p: Place; month: string; code: string | undefined; chosen: boolean; right: boolean; bottom: boolean }) {
  const m = month.slice(0, 3);
  // Only what we know: an unknown month is said once, on the night's line (D61).
  const open = code === "o" ? `Open in ${m}` : code === "p" ? `Partly open in ${m}` : null;
  const contact = handoffsText(placeLinks(p));
  return (
    <div className={cn("grid px-2.5 py-1", right && "border-r", bottom && "border-b")}>
      <span className="flex items-center gap-1.5">
        <Tick on={chosen} />
        <span className="truncate font-semibold">
          {p.name ?? "Unnamed"}
          {p.detail.stars ? <span className="font-normal"> {String(p.detail.stars)}★</span> : null}
        </span>
      </span>
      <span className="text-[12.5px]">
        {cap(p.kind.replace("_", " "))} · {p.on_route ? "on route" : `${km((p.access_m ?? 0) / 1000)} km off`}
        {open && (
          <>
            {" · "}
            <b>{open}</b>
          </>
        )}
      </span>
      <span className="truncate text-[12.5px] text-muted-foreground">{contact || "No phone or website in our data"}</span>
    </div>
  );
}

function RestDayPage({ plan, data, d, page, pages, pageOf }: { plan: PlanResult; data: PlanData; d: DayPlan; page: number; pages: number; pageOf: (n: number) => number }) {
  const stop = d.stop;
  const month = monthOf(d.date);
  const sec = stop ? data.dream.sections.find((s) => stop.at_m >= s.from_m && stop.at_m <= s.to_m) : undefined;
  const tmax = sec?.climate?.tmax_c[month] ?? null;
  const rain = sec?.climate?.rain_days[month] ?? null;
  const near = (m: number, r: number) => !!stop && Math.abs(m - stop.at_m) <= r;
  const sights = (data.full?.highlights ?? []).filter((h) => near(h.at_m, 5000) && h.offset_m <= 3000).slice(0, 3);
  const di = dayIndex(d.date);
  const day = WEEKDAYS_LONG[weekday(d.date)]!;
  const food = (data.full?.places ?? [])
    .filter((p) => p.service === "food" && p.counts && near(p.access_at_m, 3000))
    .map((p) => ({ p, open: typeof p.detail.days === "string" ? (p.detail.days as string)[di] === "o" : null }));
  const known = food.filter((x) => x.open === true);
  const shown = [...known, ...food.filter((x) => x.open === null)].sort((a, b) => Number(b.open === true) - Number(a.open === true) || (a.p.access_m ?? 0) - (b.p.access_m ?? 0)).slice(0, 6);
  const services = stop?.services ?? {};
  const there = [
    services.food ? `${services.food} places to eat` : null,
    services.pharmacy ? `${services.pharmacy} ${services.pharmacy === 1 ? "pharmacy" : "pharmacies"}` : null,
    services.atm ? `${services.atm} cash ${services.atm === 1 ? "machine" : "machines"}` : null,
    services.bike_shop ? `${services.bike_shop} bike ${services.bike_shop === 1 ? "shop" : "shops"}` : null,
    services.water ? `${services.water} water ${services.water === 1 ? "point" : "points"}` : null,
    stop?.station ? `Station: ${stop.station}` : null,
  ].filter((x): x is string => !!x);
  const before = plan.days.filter((x) => x.number < d.number && x.kind === "ride").pop();
  return (
    <Sheet page={page} pages={pages} left={`${plan.brief.title} · Day ${d.number} · ${dayText(d.date)}`}>
      <header className="grid gap-0.5">
        <Kicker>
          Day {d.number} · {dayText(d.date)}
        </Kicker>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Rest day at {d.endName}</h1>
        <span className="text-[15px]">A day off the bike, and another night in the same place.</span>
      </header>
      <dl className="grid grid-cols-3 rounded-lg border">
        {[
          ["Typically", tmax !== null ? `${Math.round(tmax)} °C` : "No data: check the forecast"],
          ["Rain", rain !== null ? cap(oneIn(rain)) : "No data"],
          ["Sunset", d.sunset !== null ? clock(d.sunset) : "–"],
        ].map(([k, v], i) => (
          <div key={k} className={cn("px-3 py-1.5", i < 2 && "border-r")}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-4 gap-y-3.5">
        {sights.length > 0 && (
          <Part icon={<Icons.Check />} label="What to see">
            {sights.map((h) => {
              const wiki = handoffsText(wikiLinks(h, plan.languages).filter((x) => x.kind === "wiki"));
              return (
                <span key={h.id}>
                  <b>{h.name}</b>, {h.kind.replace("_", " ")}
                  {wiki && <span className="text-[12.5px] text-muted-foreground"> {wiki}.</span>}
                </span>
              );
            })}
          </Part>
        )}
        {food.length > 0 && (
          <Part icon={<Icons.Utensils />} label="Where to eat">
            <span>
              {food.length} places to eat in town, {known.length} known to be open on {day}s. Listed by what we know, open first, never by quality: we have no
              reviews.
            </span>
            {shown.length > 0 && (
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border">
                {shown.map(({ p, open }, i, all) => (
                  <div key={p.id} className={cn("grid px-2.5 py-1.5", i % 2 === 0 && "border-r", i < all.length - (all.length % 2 === 0 ? 2 : 1) && "border-b")}>
                    <span className="truncate font-semibold">{p.name ?? "Unnamed"}</span>
                    <span className="text-[12.5px]">
                      {cap(p.kind.replace("_", " "))} · <b>{open ? `Open on ${day}s` : `${day} unknown: check`}</b>
                    </span>
                    <span className="truncate text-[12.5px] text-muted-foreground">{handoffsText(placeLinks(p)) || "No phone or website in our data"}</span>
                  </div>
                ))}
              </div>
            )}
            {food.length > shown.length && <span className="text-[12.5px]">+{food.length - shown.length} more: scan the QR code on page 1.</span>}
          </Part>
        )}
        {there.length > 0 && (
          <Part icon={<Icons.MapPin />} label="What's there">
            <span>{there.join(" · ")}</span>
          </Part>
        )}
        <Part icon={<Icons.Bed />} label="Sleep">
          <span>
            Another night at {d.endName}: ask for every night when you book.
            {before && ` The places are on Day ${before.number}'s page, page ${pageOf(before.number)}.`}
          </span>
        </Part>
      </div>
    </Sheet>
  );
}

function AboutPage({ plan, attribution, auditedAt, routeName, levelName, pages }: Props & { pages: number }) {
  const signs: [ReactNode, string, string][] = [
    [<Icons.TriangleAlert key="h" className="size-4" />, "Heads-up:", "something to know or watch"],
    [<Icons.Check key="c" className="size-4" />, "Highlight:", "a sight, or a reason to go"],
    [<Icons.CircleHelp key="u" className="size-4" />, "Unknown:", "we have no data, so check yourself"],
    [NIGHT_MARK, "Night's stop,", "numbered by night"],
    [PLAN_B, "Plan B:", "where to stop instead"],
    [DOT, "Water or food", "on the way"],
    [DIAMOND, "Highlight", "on a route sketch"],
    [DASH, "Heads-up", "stretch on a route sketch"],
  ];
  return (
    <Sheet page={pages} pages={pages} left={`${plan.brief.title} · Kilometrica trip book · kilometrica.com`}>
      <header className="grid gap-1">
        <Kicker>{plan.brief.title}</Kicker>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">About this book</h1>
      </header>
      <section className="grid gap-2">
        <h2 className="text-base font-semibold">Signs used in this book</h2>
        <div className="grid grid-cols-2 gap-x-7 gap-y-2">
          {signs.map(([mark, strong, rest]) => (
            <span key={strong + rest} className="flex items-center gap-2.5">
              <span className="grid w-4 place-items-center">{mark}</span>
              <span>
                <b>{strong}</b> {rest}
              </span>
            </span>
          ))}
        </div>
        <p>
          Each day's effort is written in words beside its colour: within your level, a harder day, or beyond your level. Route sketches are drawn from our
          route data, not a map: navigate with your GPX or a map app.
        </p>
      </section>
      <section className="grid gap-1.5">
        <h2 className="text-base font-semibold">How this plan was made</h2>
        <p>
          From Kilometrica's audit of {routeName} of {longDate(auditedAt)}, and your answers: {levelName}, a {BIKE[plan.inputs.bike] ?? plan.inputs.bike},{" "}
          {SLEEP[plan.inputs.sleep] ?? plan.inputs.sleep}, off at {clock(plan.inputs.startMinutes)}. Riding times come from your level and bike, never from
          fitness data.
        </p>
        <p>
          Opening dates, hours, timetables and the route itself change. Where we have no data we say so: check those before you rely on them. Kilometrica
          doesn't navigate or book: it hands you to the apps, sites and people that do.
        </p>
        <p>Printed {longDate(new Date().toISOString())}. For the latest, scan the QR code on page 1.</p>
      </section>
      <section className="grid gap-1.5">
        <h2 className="text-base font-semibold">Data sources and credits</h2>
        <ul className="grid list-disc gap-0.5 pl-4.5 text-[12.5px]">
          {attribution.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {plan.route.network === "eurovelo" && (
          <p className="text-[12.5px] text-muted-foreground">EuroVelo® is a registered trademark of the European Cyclists' Federation; Kilometrica is independent of it.</p>
        )}
      </section>
    </Sheet>
  );
}

export function TripBook(props: Props) {
  const { plan, onDone } = props;
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener("afterprint", after);
    const t = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", after);
    };
  }, [onDone]);
  const pages = plan.days.length + 3;
  const pageOf = (n: number) => n + 2;
  return (
    <div className="min-h-screen bg-muted py-6 font-sans [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:bg-white print:py-0">
      <style>{"@page { size: A4; margin: 0 } @media print { html, body { background: #fff !important } }"}</style>
      <div className="mx-auto mb-4 flex w-[210mm] flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" onPress={onDone}>
          <Icons.ArrowLeft data-icon="inline-start" />
          Back to the plan
        </Button>
        <Button size="sm" onPress={() => window.print()}>
          <Icons.Printer data-icon="inline-start" />
          Print or save as PDF
        </Button>
        <span className="text-xs text-muted-foreground">A4. In the print dialog, choose "Save as PDF" to keep it on your phone.</span>
      </div>
      <div className="grid gap-6 print:block">
        <TripPage {...props} pages={pages} pageOf={pageOf} />
        <BeforeYouGoPage plan={plan} pages={pages} pageOf={pageOf} />
        {plan.days.map((d) =>
          d.kind === "ride" ? (
            <DayPage key={d.number} plan={plan} data={props.data} d={d} geometry={props.geometry} page={pageOf(d.number)} pages={pages} />
          ) : (
            <RestDayPage key={d.number} plan={plan} data={props.data} d={d} page={pageOf(d.number)} pages={pages} pageOf={pageOf} />
          ),
        )}
        <AboutPage {...props} pages={pages} />
      </div>
    </div>
  );
}
