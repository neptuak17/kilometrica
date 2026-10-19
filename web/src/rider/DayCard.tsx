/**
 * A day card (11.6) in the new look (D53, D54): one day in the rider's own terms. In the teaser it shows the outline
 * only (D45); with the Trip Pass, water and food, heads-ups, highlights, where to sleep (places with their links,
 * D48), plan B and bail-out.
 */
import type { Place } from "@dpg/contracts";
import {
  bedsFor,
  CAPS,
  clock,
  day as dayText,
  dayItems,
  dayStory,
  hours,
  km,
  MONTHS_LONG,
  monthOf,
  placeLinks,
  type DayPlan,
  type Handoff,
  type PlanData,
  type PlanItem,
  type PlanResult,
  placesMissing,
  stopName,
} from "@dpg/planner";
import { Badge, Button, Card, CardContent, Checkbox, cn, Icons, Label, LinkButton } from "@dpg/ui";
import { type ReactNode, useId, useState } from "react";
import { LockIcon } from "./Locked";

const EFFORT = { within: "within your level", harder: "a harder day", beyond: "beyond your level" } as const;

/** Handoffs to other sites (D41): each opens in a new tab. */
export function Links({ links, size = "xs" }: { links: Handoff[]; size?: "xs" | "sm" }) {
  if (!links.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {links
        .filter((l, i) => links.findIndex((x) => x.url === l.url) === i)
        .map((l) => (
          <LinkButton key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" variant="outline" size={size} className="h-auto min-h-6 max-w-full py-1 text-left whitespace-normal">
            {l.label}
            <Icons.ExternalLink data-icon="inline-end" />
          </LinkButton>
        ))}
    </span>
  );
}

/** A labelled part of the card: the label on the left, the content beside it (stacked when narrow). */
function Part({ icon, label, tone, children }: { icon: ReactNode; label: string; tone?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-5 gap-y-1.5 border-t pt-4 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      <div className={cn("flex items-center gap-2 self-start font-semibold [&_svg]:size-4", tone)}>
        {icon}
        {label}
      </div>
      <div className="grid min-w-0 gap-2">{children}</div>
    </div>
  );
}

function Done({ id, on, onToggle }: { id: string; on: boolean; onToggle: () => void }) {
  return <Checkbox id={id} isSelected={on} onChange={onToggle} aria-label="Done" className="mt-0.5" />;
}

/** A day's items within the attention budget: `cap` shown, the rest behind "N more" (11.6). Each opens its why. */
function ItemList({ items, cap, done, onDone }: { items: PlanItem[]; cap?: number; done?: string[]; onDone?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const base = useId();
  const shown = open || cap === undefined ? items : items.slice(0, cap);
  const more = items.length - shown.length;
  return (
    <>
      <ul className="grid gap-2">
        {shown.map((i) => (
          <li key={i.id} className={cn("flex items-start gap-2.5", done?.includes(i.id) && "text-muted-foreground line-through")}>
            {onDone && <Done id={`${base}-${i.id}`} on={done?.includes(i.id) ?? false} onToggle={() => onDone(i.id)} />}
            <div className="grid min-w-0 gap-1.5">
              <details className="group">
                <summary className="cursor-pointer list-none">
                  {i.title}
                  <span className="ml-1.5 text-xs text-primary group-open:hidden">Why</span>
                </summary>
                <div className="mt-1 grid gap-1 text-muted-foreground">
                  <p>{i.why}</p>
                  {i.evidence.source && <p className="text-xs">Source: {i.evidence.source}</p>}
                </div>
              </details>
              <Links links={i.handoffs} />
            </div>
          </li>
        ))}
      </ul>
      {more > 0 && !open && (
        <div>
          <Button variant="link" size="sm" className="px-0" onPress={() => setOpen(true)}>
            +{more} more
          </Button>
        </div>
      )}
    </>
  );
}

interface Props {
  plan: PlanResult;
  data: PlanData;
  day: DayPlan;
  free: boolean;
  readOnly: boolean;
  choices: { done: string[]; booked: number[]; beds: Record<number, string> };
  onLockNight: (night: number, stopId: string) => void;
  onToggleBooked: (night: number) => void;
  onChooseBed: (night: number, placeId: string | null) => void;
  onToggleRest: (ride: number) => void;
  onDone: (id: string) => void;
  onGpx: (day: DayPlan) => void;
  onClose?: () => void;
  onNext?: () => void;
}

function dayPlaces(data: PlanData, d: DayPlan, services: string[], counting = true): Place[] {
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  return (data.full?.places ?? []).filter((p) => services.includes(p.service) && (!counting || p.counts) && p.access_at_m >= lo && p.access_at_m <= hi);
}

export function DayCard({ plan, data, day: d, free, readOnly, choices, onLockNight, onToggleBooked, onChooseBed, onToggleRest, onDone, onGpx, onClose, onNext }: Props) {
  const ids = useId();
  const mine = dayItems(plan.items, d.number);
  const all = (kind: PlanItem["kind"]) => plan.items.filter((i) => i.day === d.number && i.kind === kind);
  const night = plan.nights.find((n) => n.afterRide === d.ride && d.kind === "ride");
  const kmOf = (m: number) => Math.max(0, (plan.axis.tOf(m) - d.fromT) / 1000);
  const range = d.hoursFast !== d.hoursSlow && Math.abs(d.hoursSlow - d.hoursFast) > 0.05;
  const ride = d.kind === "ride";
  const isLastRide = d.ride === plan.inputs.days;
  const next = plan.days.find((x) => x.number === d.number + 1);

  // Parts of the day whose places didn't load, in the day's km: nothing is "none" there (D37).
  const unloaded = (data.full ? placesMissing(data.full, Math.min(d.fromM, d.toM), Math.max(d.fromM, d.toM)) : []).map((r) =>
    [kmOf(r.fromM), kmOf(r.toM)].sort((a, b) => a - b).map((x) => Math.round(Math.min(x, d.km))),
  );
  const unloadedText = unloaded.map(([a, b]) => `km ${a}–${b}`).join(", ");
  const waterFood = free ? [] : dayPlaces(data, d, ["water", "food"]).map((p) => ({ p, at: kmOf(p.access_at_m) })).sort((a, b) => a.at - b.at);
  const thinned: { p: Place; at: number }[] = [];
  for (const w of waterFood) if (!thinned.length || w.at - thinned[thinned.length - 1]!.at >= 5) thinned.push(w);
  let longest = 0;
  const pts = [0, ...waterFood.map((w) => w.at), d.km];
  for (let i = 1; i < pts.length; i++) longest = Math.max(longest, pts[i]! - pts[i - 1]!);
  const stations = free
    ? []
    : dayPlaces(data, d, ["station"], false)
        .filter((p) => ["yes", "reservation", "limited"].includes(String(p.detail.bikes)) && (p.access_m ?? 1e9) <= 10_000)
        .map((p) => ({ p, at: kmOf(p.access_at_m) }))
        .sort((a, b) => a.at - b.at);
  const beds =
    !free && night
      ? (data.full?.places ?? [])
          .filter(
            (p) =>
              p.service === "accommodation" &&
              p.counts &&
              Math.abs(p.access_at_m - night.stop.at_m) <= 5000 &&
              (plan.inputs.sleep === "mix" || (plan.inputs.sleep === "camping") === (p.kind === "campsite")) &&
              p.months[monthOf(night.date)] !== "c",
          )
          .sort((a, b) => {
            const known = (p: Place) => (["o", "p"].includes(p.months[monthOf(night.date)] ?? "?") ? 0 : 1);
            return known(a) - known(b) || (a.access_m ?? 0) - (b.access_m ?? 0);
          })
      : [];
  const bedsUnloaded = !!night && !!data.full && placesMissing(data.full, night.stop.at_m - 5000, night.stop.at_m + 5000).length > 0;
  const chosen = night ? choices.beds[night.index] : undefined;
  const month = night ? MONTHS_LONG[monthOf(night.date)] : "";
  const planB = night
    ? [night.planB.before && `${stopName(night.planB.before.stop)}, ${km(Math.abs(night.planB.before.km))} km back`, night.planB.after && `${stopName(night.planB.after.stop)}, ${km(night.planB.after.km)} km on`]
        .filter(Boolean)
        .join(" · ")
    : "";
  const headsups = all("headsup");
  const highlights = all("highlight");

  return (
    <Card className="break-inside-avoid">
      <CardContent className="grid gap-5 px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <span className="text-xs text-muted-foreground">
              Day {d.number} · {dayText(d.date)}
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-balance">{ride ? `${d.startName} → ${d.endName}` : `Rest day at ${d.endName}`}</h2>
            {ride && (
              <span className="text-base tabular-nums">
                {km(d.km)} km · {Math.round(d.climbM).toLocaleString("en-GB")} m of climbing
                {d.unknownKm >= 1 && <span className="text-unknown-foreground"> (at least: terrain unknown for {km(d.unknownKm)} km)</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ride && (
              <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
                <span className={cn("size-2.5 rounded-full", d.effort === "within" ? "bg-effort-within" : d.effort === "harder" ? "bg-effort-harder" : "bg-effort-beyond")} />
                {EFFORT[d.effort][0]!.toUpperCase() + EFFORT[d.effort].slice(1)}
              </span>
            )}
            {onClose && (
              <Button variant="ghost" size="icon-sm" aria-label="Back to the trip" onPress={onClose} className="print:hidden">
                <Icons.X />
              </Button>
            )}
          </div>
        </div>

        {ride && (
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-muted px-4 py-3.5 tabular-nums sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Riding</dt>
              <dd className="font-semibold">{range ? `${hours(d.hoursFast)}–${hours(d.hoursSlow)}` : hours(d.hoursSlow)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">With stops</dt>
              <dd className="font-semibold">about {hours(d.hoursSlow + d.stopsMin / 60)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Off at, in by</dt>
              <dd className="font-semibold">
                {clock(d.startMinutes)}, {clock(d.endMinutes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sunset</dt>
              <dd className="font-semibold">{d.sunset !== null ? `${clock(d.sunset)}${d.clockApprox ? " (approx.)" : ""}` : "–"}</dd>
            </div>
          </dl>
        )}
        {ride && (range || d.steepest) && (
          <p className="-mt-2 text-xs text-muted-foreground">
            {range && "A range, since the surface is unknown on part of the day. "}
            {d.steepest && `Steepest 500 m: ${Math.round(d.steepest.grade)}% at km ${Math.round(d.steepest.atKm)}.`}
          </p>
        )}

        <p className="text-base leading-relaxed">{dayStory(data, d, plan.items)}</p>

        {free ? (
          <div className="flex items-start gap-2 rounded-2xl border border-dashed px-4 py-3 text-muted-foreground">
            <LockIcon className="mt-0.5 size-4 shrink-0" />
            Water and food, heads-ups, highlights, where to sleep and the plan B for this day, with a Trip Pass.
          </div>
        ) : (
          <div className="grid gap-4">
            {ride && (
              <Part icon={<Icons.Droplet />} label="Water, food">
                {unloaded.length ? (
                  <>
                    {waterFood.length > 0 && <span className="tabular-nums">km {thinned.map((w) => Math.round(w.at)).join(" · ")}</span>}
                    <span className="flex items-start gap-1.5 text-unknown-foreground">
                      <Icons.CircleHelp className="mt-0.5 size-4 shrink-0" />
                      Places for {unloadedText} of this day didn't load: any there aren't shown.
                    </span>
                  </>
                ) : waterFood.length ? (
                  <span className="tabular-nums">
                    km {thinned.map((w) => Math.round(w.at)).join(" · ")}, longest gap {Math.round(longest)} km
                  </span>
                ) : (
                  <span>None that counts along this day: you judge what to carry.</span>
                )}
              </Part>
            )}
            {mine.calls.length > 0 && (
              <Part icon={<Icons.Route />} label="Your call">
                <ItemList items={mine.calls} />
              </Part>
            )}
            {headsups.length > 0 && (
              <Part icon={<Icons.TriangleAlert />} label="Heads-up" tone="text-headsup-foreground">
                <ItemList items={headsups} cap={CAPS.headsup} />
              </Part>
            )}
            {highlights.length > 0 && (
              <Part icon={<Icons.Check />} label="Highlights" tone="text-highlight-foreground">
                <ItemList items={highlights} cap={CAPS.highlight} />
              </Part>
            )}
            {mine.todos.length > 0 && (
              <Part icon={<Icons.Flag />} label="Before you go">
                <ItemList items={mine.todos} done={choices.done} onDone={readOnly ? undefined : onDone} />
              </Part>
            )}
            {night && (
              <Part icon={<Icons.Bed />} label="Sleep">
                <span>
                  <b>{stopName(night.stop)}</b>:{" "}
                  {night.beds.count
                    ? `${night.beds.count} ${night.beds.count === 1 ? "place" : "places"} of your kind, ${night.beds.open + night.beds.partly} known open in ${month}`
                    : "no known place of your kind"}
                  {night.stop.station ? ` · station: ${night.stop.station}` : ""}
                </span>
                <span className="text-muted-foreground">{night.why}</span>
                {beds.length > 0 && (
                  <ul className="overflow-hidden rounded-2xl border">
                    {beds.slice(0, 6).map((p) => {
                      const code = p.months[monthOf(night.date)];
                      const open = code === "o" || code === "p";
                      return (
                        <li key={p.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3.5 py-2.5 last:border-b-0", chosen === p.id && "bg-primary/8")}>
                          <div className="grid min-w-0 flex-[1_1_200px]">
                            <span className="font-semibold">
                              {p.name ?? "Unnamed"}
                              {p.detail.stars ? <span className="font-normal text-muted-foreground"> {String(p.detail.stars)}★</span> : null}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {p.kind.replace("_", " ")} · {km((p.access_m ?? 0) / 1000)} km off the route
                            </span>
                          </div>
                          {open ? (
                            <Badge variant="secondary">{code === "o" ? `Open in ${month}` : `Partly open in ${month}`}</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-unknown px-2 py-0.5 text-xs font-medium text-unknown-foreground">
                              <Icons.CircleHelp className="size-3" />
                              {month} unknown: check
                            </span>
                          )}
                          <Links links={placeLinks(p)} />
                          {!readOnly && (
                            <Button variant={chosen === p.id ? "secondary" : "ghost"} size="xs" onPress={() => onChooseBed(night.index, chosen === p.id ? null : p.id)}>
                              {chosen === p.id ? (
                                <>
                                  <Icons.Check data-icon="inline-start" />
                                  Chosen
                                </>
                              ) : (
                                "Choose"
                              )}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {bedsUnloaded && <span className="text-xs text-unknown-foreground">The names of places to stay here didn't load: the count above is from the route's stops.</span>}
                <span className="text-xs text-muted-foreground">Listed by what we know (open first, then by detour), never by quality: we have no prices or reviews.</span>
                <span>
                  <span className="text-muted-foreground">Plan B: </span>
                  {planB || "no other stop of your kind nearby"}
                </span>
                {!readOnly && (
                  <div className="grid gap-2.5 print:hidden">
                    <div className="flex items-center gap-2">
                      <Checkbox id={`${ids}-booked`} isSelected={choices.booked.includes(night.index)} onChange={() => onToggleBooked(night.index)} />
                      <Label htmlFor={`${ids}-booked`} className="font-normal">
                        Booked (keeps this night when the plan changes)
                      </Label>
                    </div>
                    {night.alternatives.length > 0 && (
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-primary">
                          Stay somewhere else this night
                          <Icons.ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                        </summary>
                        <ul className="mt-2 grid gap-1.5">
                          {night.alternatives.map((a) => {
                            const b = bedsFor(a.stop, plan.inputs.sleep, monthOf(night.date));
                            return (
                              <li key={a.stop.id} className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" size="xs" onPress={() => onLockNight(night.index, a.stop.id)}>
                                  {stopName(a.stop)}
                                </Button>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  this day {km(a.dayKm)} km, next day {a.nextKm === null ? "–" : `${km(a.nextKm)} km`} · {b.count - b.closed} places, {b.open + b.partly} known open
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </Part>
            )}
            {ride && stations.length > 0 && (
              <Part icon={<Icons.Train />} label="Bail-out">
                <span className="tabular-nums">
                  {stations
                    .slice(0, 6)
                    .map((s) => `${s.p.name ?? "Station"} (km ${Math.round(s.at)})`)
                    .join(" · ")}
                </span>
              </Part>
            )}
          </div>
        )}

        {(ride && !readOnly) || (onNext && next) ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4 print:hidden">
            {ride && !readOnly && !isLastRide && !free && (
              <div className="flex items-center gap-2">
                <Checkbox id={`${ids}-rest`} isSelected={plan.inputs.restAfter.includes(d.ride!)} onChange={() => onToggleRest(d.ride!)} />
                <Label htmlFor={`${ids}-rest`} className="font-normal">
                  Rest day after this day
                </Label>
              </div>
            )}
            {ride && !readOnly && !free && (
              <Button variant="outline" size="sm" onPress={() => onGpx(d)}>
                <Icons.Download data-icon="inline-start" />
                Day {d.number} GPX
              </Button>
            )}
            <span className="flex-1" />
            {onNext && next && (
              <Button variant="link" className="px-0 font-semibold" onPress={onNext}>
                Day {next.number}: {next.kind === "rest" ? `rest at ${next.endName}` : `→ ${next.endName}`}
                <Icons.ChevronRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
