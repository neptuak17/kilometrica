/**
 * The cases' world: real route data, read in Node through the API's own code (@dpg/routes/node), pinned to each case's
 * audit run, and the contexts the tools work in, built as the screens build them.
 */
import { type DreamRoute, EMPTY, keyOf, stretchesFor } from "@dpg/dream";
import { makePlan, NO_CHOICES, type PlanData, type PlanInputs, type PlanResult, type PlanState } from "@dpg/planner";
import { type Fetch, loadDreamFiles, loadFull, loadRoute, type RouteFiles } from "@dpg/routes";
import type { DreamContext } from "../dream";
import type { PlanContext } from "../plan";
import type { Case, PlanSpec } from "./cases";

export class World {
  private dreams = new Map<string, Promise<DreamRoute>>();
  private routes = new Map<string, Promise<RouteFiles>>();
  private fulls = new Map<string, Promise<PlanData["full"]>>();

  constructor(private readonly fetch: Fetch) {}

  dreamRoute(route: string, run: string): Promise<DreamRoute> {
    const key = `${route}@${run}`;
    if (!this.dreams.has(key)) {
      const [network, ref] = route.split("/") as [string, string];
      this.dreams.set(
        key,
        loadDreamFiles(network, ref, { fetch: this.fetch, run }).then((f) => ({
          id: route,
          name: f.manifest.route.name,
          dream: f.dream,
          daily: f.daily,
          userPlaces: f.userPlaces,
          own: f.manifest.visibility === "private",
          overview: f.manifest.summary.overview,
          stops: f.stops,
        })),
      );
    }
    return this.dreams.get(key)!;
  }

  async dreamContext(c: Case): Promise<DreamContext> {
    const route = await this.dreamRoute(c.route, c.run);
    const ask = { ...EMPTY, ...c.ask };
    const n = c.screen?.stretch;
    const shown = n ? stretchesFor(route, ask)[n - 1] : undefined;
    return { route, ask, ...(shown ? { screen: { stretch: keyOf(shown) } } : {}) };
  }

  private files(route: string, run: string): Promise<RouteFiles> {
    const key = `${route}@${run}`;
    if (!this.routes.has(key)) {
      const [network, ref] = route.split("/") as [string, string];
      this.routes.set(key, loadRoute(network, ref, { fetch: this.fetch, run }));
    }
    return this.routes.get(key)!;
  }

  /** A plan as Plan opens one from Dream's link (D48, D74, D79): the stretch, the days in all, the rest among them. */
  async planContext(c: Case): Promise<PlanContext> {
    const spec = c.plan!;
    const files = await this.files(c.route, c.run);
    const inputs = planInputs(files, spec);
    let full: PlanData["full"] = null;
    if (spec.pass !== false) {
      const [network, ref] = c.route.split("/") as [string, string];
      const key = `${c.route}@${c.run}:${inputs.fromM}-${inputs.toM}`;
      if (!this.fulls.has(key)) this.fulls.set(key, loadFull(network, ref, c.run, inputs.fromM, inputs.toM, { fetch: this.fetch }).then((x) => x.full));
      full = await this.fulls.get(key)!;
    }
    const data: PlanData = { ...files.free, full };
    const cache = new WeakMap<PlanState, PlanResult>();
    const planFor = (s: PlanState) => {
      let p = cache.get(s);
      if (!p) cache.set(s, (p = makePlan(data, s.inputs, s.choices, { geometry: files.geometry, languages: ["en"] })));
      return p;
    };
    return { data, state: { inputs, choices: { ...NO_CHOICES, ...spec.choices } }, planFor, ...(c.screen?.day ? { screen: { day: c.screen.day } } : {}) };
  }
}

export function planInputs(files: RouteFiles, spec: PlanSpec): PlanInputs {
  const daily = files.sections.daily;
  const first = daily.find((d) => d.number === spec.sections[0]) ?? daily[0]!;
  const last = daily.find((d) => d.number === spec.sections[1]) ?? daily[daily.length - 1]!;
  const rest = spec.rest ?? 0;
  return {
    fromM: Math.min(first.from_m, last.from_m),
    toM: Math.max(first.to_m, last.to_m),
    direction: spec.way ?? "forward",
    startDate: `${files.free.dream.season_year}-${String(spec.month + 1).padStart(2, "0")}-15`,
    days: Math.max(1, spec.days - rest),
    ...(rest ? { restDays: rest } : {}),
    level: spec.level,
    bike: spec.bike ?? "touring",
    sleep: spec.sleep ?? "mix",
    startMinutes: 9 * 60,
    stopStyle: "normal",
    restAfter: spec.restAfter ?? [],
    avoidGravel: false,
    avoidBusy: false,
    travel: spec.travel ?? false,
    ...(spec.bailouts ? { bailouts: true } : {}),
    ...(spec.stops ? { stops: spec.stops } : {}),
  };
}
