/**
 * Plan rules (11.6): facts on the rider's days become a few plan items, each with why it matters to this rider and
 * the evidence behind it (D38). Thresholds live here, in one place to tune (D13).
 *
 * The teaser (D45) has only the free files, so it gets the rules that need nothing else: effort, sunset, days, beds by
 * count, gaps, getting there, borders and missing data. The Trip Pass adds findings, water and food, opening on the
 * date, climbs and highlights.
 */
import type { Finding, Highlight, Place, Stop } from "@dpg/contracts";
import { bearing, type Geometry, locate } from "./geometry";
import type { PlanCore } from "./plan";
import { bedsFor } from "./stages";
import { addDays, clock, dayIndex, monthOf, weekday } from "./sun";
import { country, day as dayText, hours, KNOWN_ENOUGH, km, plural, sleepNoun, stopName, WEEKDAYS_LONG } from "./text";
import { type DayPlan, type Handoff, type NightPlan, type PlanChoices, type PlanData, type PlanItem, placesMissing, type Sleep } from "./types";

export const CAPS = { headsup: 3, highlight: 3, brief: 5 };

/** Schengen members (2025); crossing out of or into the area needs documents checked. Source: European Commission. */
export const SCHENGEN = new Set([
  "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU",
  "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
]);
// Microstates with open borders to Schengen neighbours count as inside for this purpose.
const OPEN_BORDER = new Set(["MC", "SM", "VA", "AD"]);
const inSchengen = (cc: string | null) => !!cc && (SCHENGEN.has(cc) || OPEN_BORDER.has(cc));

/**
 * National rail operators' sites, for getting there and back and for bail-outs (D41, D63), with the operator's own page
 * on bikes where it covers the whole country (from engine/profiles/transport/bike-carriage.yaml, D20). France has none:
 * each region sets its TER rules. None of these sites takes stations and a date in a link (checked 2026-10-20).
 */
export const RAIL: Record<string, { name: string; url: string; bikes?: { name: string; url: string } }> = {
  ES: { name: "Renfe", url: "https://www.renfe.com", bikes: { name: "Renfe", url: "https://www.renfe.com/es/ca/viajar/informacion-util/equipajes/bicicletas-y-patines" } },
  FR: { name: "SNCF Connect", url: "https://www.sncf-connect.com" },
  MC: {
    name: "SNCF Connect",
    url: "https://www.sncf-connect.com",
    bikes: { name: "TER Sud", url: "https://www.ter.sncf.com/sud-provence-alpes-cote-d-azur/services-contacts/voyager-avec-velo/reservation-velo" },
  },
  IT: { name: "Trenitalia", url: "https://www.trenitalia.com", bikes: { name: "Trenitalia", url: "https://www.trenitalia.com/en/services/travelling-with-your-bike.html" } },
  SI: { name: "Slovenske železnice", url: "https://potniski.sz.si", bikes: { name: "Slovenske železnice", url: "https://potniski.sz.si/take-your-bike-on-the-train/" } },
  HR: { name: "HŽPP", url: "https://www.hzpp.hr", bikes: { name: "HŽPP", url: "https://hzpp.hr/en/international/bicycle-transport" } },
  GR: { name: "Hellenic Train", url: "https://www.hellenictrain.gr" },
  PT: { name: "CP", url: "https://www.cp.pt" },
  DE: { name: "Deutsche Bahn", url: "https://www.bahn.de", bikes: { name: "Deutsche Bahn", url: "https://www.bahn.de/angebot/zusatzticket/fahrrad" } },
  CH: {
    name: "SBB",
    url: "https://www.sbb.ch",
    bikes: { name: "SBB", url: "https://www.sbb.ch/en/travel-information/individual-needs/travelling-with-bikes/carriage-bikes-train.html" },
  },
  AT: { name: "ÖBB", url: "https://www.oebb.at", bikes: { name: "ÖBB", url: "https://www.oebb.at/en/reiseplanung-services/im-zug/fahrradmitnahme" } },
  LI: { name: "ÖBB", url: "https://www.oebb.at", bikes: { name: "ÖBB", url: "https://www.oebb.at/en/reiseplanung-services/im-zug/fahrradmitnahme" } },
  NL: { name: "NS", url: "https://www.ns.nl/en", bikes: { name: "NS", url: "https://www.ns.nl/en/travel-information/bikes-on-the-train.html" } },
};

/**
 * Rail handoffs for stations in these countries (D41, D63): each operator's site, then its bike rules where we have
 * them, once per operator, in the order the countries come.
 */
export function railLinks(countries: (string | null | undefined)[]): Handoff[] {
  const out: Handoff[] = [];
  for (const cc of countries) {
    const rail = cc ? RAIL[cc] : undefined;
    if (!rail) continue;
    if (!out.some((h) => h.url === rail.url)) out.push({ kind: "rail", label: rail.name, url: rail.url });
    if (rail.bikes && !out.some((h) => h.url === rail.bikes!.url)) out.push({ kind: "rail", label: `${rail.bikes.name}'s bike rules`, url: rail.bikes.url });
  }
  return out;
}

/** Languages tried after the rider's own when a sight has no article in them: English, then the local ones. */
const FALLBACK_LANGUAGES = ["en", "fr", "es", "it", "de", "pt", "ca", "nl", "el", "hr", "sl", "tr", "eu"];

const wikiUrl = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_")).replaceAll("%2F", "/")}`;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A sight's Wikipedia article in the rider's language (the device's languages, best first), else English, else the
 * local one, labelled with its language when it isn't the rider's; and its Commons photo gallery. Wikipedia keeps
 * each language as a separate site, so the language is chosen here, from the articles the audit looked up
 * (Wikidata). A bare Wikidata page tells a rider little, so it is never linked.
 */
export function wikiLinks(h: Highlight, languages: string[]): Handoff[] {
  const out: Handoff[] = [];
  const own = [...new Set(languages.map((l) => l.toLowerCase().split("-")[0]!).filter(Boolean))];
  const articles: Record<string, string> = { ...(h.articles ?? {}) };
  let local: string | null = null;
  if (h.wikipedia?.includes(":")) {
    const [lang, ...rest] = h.wikipedia.split(":");
    if (lang && rest.length && !articles[lang]) articles[lang] = rest.join(":");
    local = lang ?? null;
  }
  const order = [...own, ...FALLBACK_LANGUAGES.filter((l) => !own.includes(l))];
  if (local && !order.includes(local)) order.splice(own.length + 1, 0, local);
  const lang = order.find((l) => articles[l]) ?? Object.keys(articles)[0];
  if (lang && articles[lang]) {
    const label = own[0] === lang ? "Wikipedia" : `Wikipedia (in ${languageName(lang)})`;
    out.push({ kind: "wiki", label, url: wikiUrl(lang, articles[lang]!) });
  }
  if (h.commons) {
    out.push({ kind: "photos", label: "Photos", url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(h.commons.replaceAll(" ", "_")).replaceAll("%3A", ":")}` });
  }
  return out;
}

/** The kind of place as a search word, for places whose name doesn't say it already. */
const KIND_WORD: Record<string, string> = {
  campsite: "Camping",
  hotel: "Hotel",
  guest_house: "Guest house",
  hostel: "Hostel",
  hut: "Mountain hut",
};
const KIND_IN_NAME =
  /\b(camping|campsite|campeggio|kamp|hotel|hostal|hostel|albergue|auberge|refugio|refuge|rifugio|gite|chambres? d|pension|guest ?house|apartamentos?|apartments?|residence|residencia|b ?& ?b|hut|xenonas|otel|pansiyon)\b/;
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * A Google Maps search that finds this place, not a namesake near the person looking (Google resolves a bare name
 * near the viewer): kind, name and town, e.g. "Camping La Corniche, Hendaye". The town is the place's own (the audit
 * names it, `detail.town`). Unnamed, or with no town to anchor it: its coordinates. Google's listing is theirs and
 * may occasionally be the wrong place (D41, D51).
 */
export function mapsSearch(
  p: { name: string | null; kind?: string; lat: number; lon: number; detail?: Record<string, unknown> },
  fallbackTown?: string | null,
): string {
  const base = "https://www.google.com/maps/search/?api=1&query=";
  const town = (p.detail?.town as string | undefined) ?? fallbackTown ?? null;
  if (!p.name || !town) return `${base}${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const name = fold(p.name);
  const kind = p.kind && KIND_WORD[p.kind] && !KIND_IN_NAME.test(name) ? `${KIND_WORD[p.kind]} ` : "";
  const words = (s: string) => ` ${fold(s).replace(/[^a-z0-9]+/g, " ").trim()} `;
  const where = words(p.name).includes(words(town)) ? "" : `, ${town}`; // "Eaux Bonnes" names "Eaux-Bonnes"
  return `${base}${encodeURIComponent(`${kind}${p.name}${where}`)}`;
}

/** Website, phone and Google Maps links for a place (D41, D48): its own site where we have one. */
export function placeLinks(
  p: { name: string | null; kind?: string; lat: number; lon: number; detail: Record<string, unknown> },
  town?: string | null,
): Handoff[] {
  const out: Handoff[] = [];
  const site = (p.detail.website ?? p.detail["contact:website"]) as string | undefined;
  const phone = (p.detail.phone ?? p.detail["contact:phone"]) as string | undefined;
  if (site) out.push({ kind: "website", label: "Website", url: site.startsWith("http") ? site : `https://${site}` });
  if (phone) out.push({ kind: "phone", label: phone, url: `tel:${phone.replace(/[^\d+]/g, "")}` });
  out.push({ kind: "maps", label: "See it in Google Maps", url: mapsSearch(p, town) });
  return out;
}

/** The nights at a stop: in that night, out the next morning, or the morning after when a rest day follows. */
export function nightStay(night: NightPlan, restAfter: number[]): { checkIn: string; checkOut: string } {
  return { checkIn: night.date, checkOut: addDays(night.date, restAfter.includes(night.afterRide) ? 2 : 1) };
}

/**
 * A night's fallback, for when none of our places suit (D60): Booking.com and Expedia searched for the stop and the
 * nights there. By town and country, or by the stop's position, nearest first, when it has no town name. Guests are
 * left to the rider. None for riders who only camp: the two sites list few campsites.
 */
export function bookingSearches(night: NightPlan, inputs: { sleep: Sleep; restAfter: number[] }): Handoff[] {
  if (inputs.sleep === "camping") return [];
  const { checkIn, checkOut } = nightStay(night, inputs.restAfter);
  const s = night.stop;
  const where = s.name && (s.country ? `${s.name}, ${country(s.country)}` : s.name);
  const lat = s.lat.toFixed(5);
  const lon = s.lon.toFixed(5);
  const booking = where
    ? `ss=${encodeURIComponent(where)}`
    : `latitude=${lat}&longitude=${lon}&dest_type=latlong&order=distance_from_search`;
  const expedia = where ? `destination=${encodeURIComponent(where)}` : `latLong=${lat}%2C${lon}&sort=DISTANCE`;
  return [
    { kind: "booking", label: "Booking.com", url: `https://www.booking.com/searchresults.html?${booking}&checkin=${checkIn}&checkout=${checkOut}` },
    { kind: "booking", label: "Expedia", url: `https://www.expedia.com/Hotel-Search?${expedia}&startDate=${checkIn}&endDate=${checkOut}` },
  ];
}

const dayKm = (core: PlanCore, d: DayPlan, m: number) => Math.max(0, (core.axis.tOf(m) - d.fromT) / 1000);

/**
 * Street-level photos at a point on the route (D58): Street View facing the way the rider rides, and Mapillary
 * everywhere; Panoramax in France, where nearly all its photos are. Hand-offs (D41): each link carries the route
 * point only, never the rider's position, and nothing is fetched until the rider opens it. Google opens on its nearest
 * photo itself; Mapillary and Panoramax need a photo's id, so their links carry the point to look one up by on tap
 * (`photoAt`), and open their map there when there's none.
 */
export function streetPhotos(geo: Geometry, m: number, direction: "forward" | "reverse", country: string | null): Handoff[] {
  const p = locate(geo, m);
  if (!p) return [];
  const ahead = locate(geo, m + (direction === "reverse" ? -30 : 30));
  const heading = ahead ? bearing(p, ahead) : null;
  const lat = p[1].toFixed(6);
  const lon = p[0].toFixed(6);
  const out: Handoff[] = [
    {
      kind: "street",
      label: "Street View",
      url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}${heading === null ? "" : `&heading=${Math.round(heading)}`}`,
    },
    {
      kind: "street",
      label: "Mapillary",
      url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17`,
      photoAt: { service: "mapillary", lon: p[0], lat: p[1], heading },
    },
  ];
  if (country === "FR") {
    out.push({
      kind: "street",
      label: "Panoramax",
      url: `https://explore.panoramax.fr/#focus=map&map=17/${lat}/${lon}`,
      photoAt: { service: "panoramax", lon: p[0], lat: p[1], heading },
    });
  }
  return out;
}

/** Heads-ups about the way itself, where seeing it helps: the audit's findings, gaps, steps, the steepest and big climbs. */
const SEE_IT = ["finding:", "gap:", "ferry:", "transport:", "steep:", "climb:"];
/** Findings about something other than the way (the distance to a station), where photos don't help. */
const NOT_SEEN = ["services.bail_out"];

function inDay(core: PlanCore, d: DayPlan, m0: number, m1: number): boolean {
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  const a = Math.min(m0, m1);
  const b = Math.max(m0, m1);
  return b >= lo && a <= hi && core.axis.length > 0;
}

function holidayOn(data: PlanData, cc: string | null, iso: string) {
  const cal = data.calendar?.countries.find((c) => c.country === cc);
  if (!cal || cal.public_year !== Number(iso.slice(0, 4))) return null;
  return cal.public.find((h) => h.date === iso && h.nationwide) ?? null;
}

/**
 * A riding day's food places, and how many are open that day among those whose hours we know (D37: the known part
 * only). Null where the day's places didn't load: not loaded isn't none.
 */
export function foodOnDay(data: PlanData, d: DayPlan): { all: number; known: number; open: number; holiday: string | null; ids: string[] } | null {
  const full = data.full;
  const lo = Math.min(d.fromM, d.toM);
  const hi = Math.max(d.fromM, d.toM);
  if (!full || placesMissing(full, lo, hi).length) return null;
  const food = full.places.filter((p) => p.service === "food" && p.counts && p.access_at_m >= lo && p.access_at_m <= hi);
  const known = food.filter((p) => typeof p.detail.days === "string");
  const di = dayIndex(d.date);
  const hol = holidayOn(data, d.stop?.country ?? null, d.date);
  const open = known.filter((p) => !(hol && /\bPH\b/.test(p.opening_hours ?? "")) && (p.detail.days as string)[di] === "o").length;
  return { all: food.length, known: known.length, open, holiday: hol?.name ?? null, ids: known.map((p) => p.id) };
}

function schoolOn(data: PlanData, cc: string | null, iso: string) {
  const cal = data.calendar?.countries.find((c) => c.country === cc);
  if (!cal || cal.school_year !== Number(iso.slice(0, 4))) return null;
  return cal.school.find((s) => s.start <= iso && iso <= s.end) ?? null;
}

function bedPlaces(full: NonNullable<PlanData["full"]>, stop: Stop, sleep: string): Place[] {
  return full.places
    .filter(
      (p) =>
        p.service === "accommodation" &&
        p.counts &&
        Math.abs(p.access_at_m - stop.at_m) <= 5000 &&
        (sleep === "mix" || (sleep === "camping") === (p.kind === "campsite")),
    )
    .sort((a, b) => Math.abs(a.access_at_m - stop.at_m) - Math.abs(b.access_at_m - stop.at_m));
}

/**
 * Whether most of the stretch has no station that carries bikes (D70): then getting home is the rider's own affair,
 * said once, with no warning on each day. Routes like the Trans Canada Trail draw riders who expect that.
 */
function fewTrains(data: PlanData, core: PlanCore): boolean {
  const lo = Math.min(core.axis.startM, core.axis.endM);
  const hi = Math.max(core.axis.startM, core.axis.endM);
  const none = (data.full?.findings ?? [])
    .filter((f) => f.rule_id === "services.bail_out")
    .reduce((a, f) => a + Math.max(0, Math.min(hi, Math.max(f.from_m, f.to_m)) - Math.max(lo, Math.min(f.from_m, f.to_m))), 0);
  return hi > lo && none / (hi - lo) > 0.5;
}

export function planItems(data: PlanData, core: PlanCore, geo?: Geometry): PlanItem[] {
  const items: PlanItem[] = [];
  const { inputs, level, usual, days, nights } = core;
  const rides = days.filter((d) => d.kind === "ride");
  const add = (i: PlanItem) => items.push(i);

  // --- effort and daylight ---------------------------------------------------------------------------------
  for (const d of rides) {
    if (d.effort === "beyond") {
      add({
        id: `effort:beyond:${d.number}`,
        kind: "call",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Day ${d.number} is beyond ${level.name}: ${km(d.km)} km, ${Math.round(d.climbM)} m`,
        why: `About ${hours(d.hoursSlow)} riding, against your usual ${hours(usual.hours)}.`,
        rank: 36,
        topic: "able",
        evidence: { source: "pace model (level presets, D36)" },
        handoffs: [],
        options: [
          { id: "add-day", label: "Add a day", effect: "one more riding day; the others re-plan around it" },
          { id: `move:${d.number}`, label: "Move this stop", effect: "pick another night's stop on the day" },
          { id: "keep", label: "Keep it", effect: "a long day, ridden as it is" },
        ],
      });
    }
    if (d.sunset !== null && d.endMinutes > d.sunset) {
      const early = Math.ceil((d.endMinutes - d.sunset + 15) / 15) * 15;
      add({
        id: `sunset:${d.number}`,
        kind: "call",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Day ${d.number} ends after sunset at your pace`,
        why: `In at about ${clock(d.endMinutes)}; sunset ${clock(d.sunset)}${d.clockApprox ? " (approximate clock)" : ""}.`,
        rank: 45,
        topic: "risk",
        evidence: { source: "pace model; NOAA sunset" },
        handoffs: [],
        options: [
          { id: `earlier:${early}`, label: `Leave at ${clock(inputs.startMinutes - early)}`, effect: `start ${early} min earlier` },
          { id: `move:${d.number}`, label: "Stop earlier", effect: "end the day at an earlier stop" },
          { id: "keep", label: "Keep it", effect: "ride the last part in the dusk" },
        ],
      });
    }
  }
  for (let i = 0; i + 2 < rides.length; i++) {
    const run = rides.slice(i, i + 3);
    if (run.every((d) => d.effort !== "within") && !items.some((x) => x.id.startsWith("effort:run:"))) {
      add({
        id: `effort:run:${run[0]!.number}`,
        kind: "call",
        day: run[1]!.number,
        fromM: run[0]!.fromM,
        toM: run[2]!.toM,
        title: `Days ${run[0]!.number}–${run[2]!.number} are all harder than your usual`,
        why: "Three long days in a row add up.",
        rank: 32,
        topic: "able",
        evidence: { source: "pace model" },
        handoffs: [],
        options: [
          { id: `rest:${run[1]!.ride}`, label: `Rest after day ${run[1]!.number}`, effect: "one more day on the calendar" },
          { id: "keep", label: "Keep it", effect: "no rest day" },
        ],
      });
    }
  }
  for (const o of core.offers) {
    add({
      id: `days:${o.days}`,
      kind: "call",
      day: null,
      fromM: null,
      toM: null,
      title: o.why,
      why: `You chose ${plural(inputs.days, "riding day")}; this is the planner's suggestion, not a change.`,
      rank: 34,
      topic: "able",
      evidence: { source: "stage planner" },
      handoffs: [],
      options: [
        { id: `days:${o.days}`, label: `${o.days} days`, effect: o.days > inputs.days ? "one more riding day" : "one riding day fewer" },
        { id: "keep", label: `Keep ${inputs.days}`, effect: "as you chose" },
      ],
    });
  }
  // The steepest 500 m of each day, from the effort profile: a heads-up when it is steep for the rider's level.
  const steepFor: Record<number, number> = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 14 };
  for (const d of rides) {
    const limit = steepFor[level.level] ?? 10;
    if (d.steepest && d.steepest.grade >= limit) {
      add({
        id: `steep:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: core.axis.mOf(d.fromT + d.steepest.atKm * 1000),
        toM: core.axis.mOf(d.fromT + d.steepest.atKm * 1000 + 500),
        title: `km ${Math.round(d.steepest.atKm)}: 500 m at ${Math.round(d.steepest.grade)}%`,
        short: `Steep ${Math.round(d.steepest.grade)}%`,
        why: `The steepest part of the day, steep for ${level.name} riders; from a 30 m terrain model, so short ramps can be steeper.`,
        rank: 35,
        topic: "able",
        evidence: { source: "Copernicus DEM GLO-30 (effort.json)" },
        handoffs: [],
      });
    }
  }
  for (const d of rides) {
    if (d.unknownKm >= 1) {
      add({
        id: `terrain:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Terrain unknown for ${km(d.unknownKm)} km: climbing and time are minimums`,
        short: "Terrain unknown",
        why: "The official track is a straight line or a gap there, so nobody has measured the real road (D37).",
        rank: 29,
        topic: "risk",
        evidence: { source: "effort.json" },
        handoffs: [],
      });
    }
  }

  // --- gaps (D47, D50) -------------------------------------------------------------------------------------
  for (const d of rides) {
    for (const g of d.gaps) {
      const at = Math.round(dayKm(core, d, g.atM));
      if (g.type === "ferry") {
        add({
          id: `ferry:${Math.round(g.atM)}`,
          kind: "todo",
          day: d.number,
          fromM: g.atM,
          toM: g.atM,
          title: `Ferry on day ${d.number}: check its season and times`,
          short: "Ferry: check times",
          why: `A ${km(g.km)} km crossing at km ${at} of the day; we have no timetables, so it isn't timed.`,
          rank: 38,
          topic: "prepare",
          evidence: { source: "OSM ferry route (effort.json gaps)" },
          handoffs: [],
        });
      } else if (g.type === "public_transport") {
        add({
          id: `transport:${Math.round(g.atM)}`,
          kind: "todo",
          day: d.number,
          fromM: g.atM,
          toM: g.atM,
          title: `Public-transport link on day ${d.number}: check times and bike rules`,
          short: "Transport link",
          why: `The network advises public transport across ${km(g.km)} km at km ${at} of the day.`,
          rank: 38,
          topic: "prepare",
          evidence: { source: "network's published advice" },
          handoffs: [],
        });
      } else if (g.type === "missing" || g.type === "unclassified") {
        add({
          id: `gap:${Math.round(g.atM)}`,
          kind: "headsup",
          day: d.number,
          fromM: g.atM,
          toM: g.atM,
          title: `The route has a ${km(g.km)} km gap here, counted as ridden`,
          short: `Route gap ${km(g.km)} km`,
          why: `At km ${at} of the day the official track stops: no track, ferry or published link. Draw your own line across it in your route tool.`,
          rank: 52,
          topic: "risk",
          evidence: { source: "effort.json gaps (D50)" },
          handoffs: [],
        });
      }
    }
  }

  // --- nights (D18, D64) -----------------------------------------------------------------------------------
  // One line per night, until the day card settles it: a place chosen there, or Booked. The line is a nudge, not a
  // copy of the day card: the places, their links and the plan B are on the card, which its Day button opens. The
  // id carries the stop, so a night moved to another town is a new line.
  for (const n of nights) {
    const d = days.find((x) => x.ride === n.afterRide)!;
    const name = stopName(n.stop);
    const twoNights = inputs.restAfter.includes(n.afterRide);
    const nudges: string[] = [];
    let rank = 30;
    if (n.own && n.beds.count === 0) {
      // The rider's own stop (D70): they have a place in mind.
    } else if (n.wildCamp) {
      nudges.push(n.wildCamp);
      rank = 48;
    } else if (n.stop.beds.length === 0 || n.beds.count === 0) {
      nudges.push(`No known ${sleepNoun(inputs.sleep)} within 5 km of the route: look further, or change how you sleep.`);
      rank = 48;
    } else {
      if (n.beds.open + n.beds.partly + n.beds.unmanaged === 0) {
        nudges.push(`Check ahead if ${n.beds.count === 1 ? "it's" : "they're"} open.`);
        rank = 42;
      }
      if (n.beds.count === 1) {
        const b = n.planB.after ?? n.planB.before;
        nudges.push(`Only one place nearby${b ? `; plan B: ${stopName(b.stop)}, ${km(Math.abs(b.km))} km ${b.km > 0 ? "on" : "back"}` : ""}.`);
        rank = Math.max(rank, 41);
      }
      const hol = holidayOn(data, n.stop.country, n.date);
      const school = schoolOn(data, n.stop.country, n.date);
      const sec = data.dream.sections.find((s) => s.from_m <= n.stop.at_m && n.stop.at_m <= s.to_m);
      const busy = sec?.crowding.tourism_index[monthOf(n.date)];
      const why = hol ? `a public holiday (${hol.name})` : school ? `school holidays (${school.name})` : busy && busy >= 1.3 ? `a busy month for tourism there` : null;
      if (why && n.beds.count <= 3) {
        nudges.push(`Book ahead: ${why}.`);
        rank = Math.max(rank, 40);
      }
    }
    const chosen = chosenBed(data, n, core.choices, inputs.sleep);
    add({
      id: `bed:${n.index}:${n.stop.id}`,
      kind: "todo",
      day: d.number,
      fromM: n.stop.at_m,
      toM: n.stop.at_m,
      title: `${n.wildCamp ? "Find a place to camp" : "Find accommodation"} at ${name} for ${dayText(n.date)}${twoNights ? ", 2 nights" : ""}`,
      why: nudges.join(" "),
      rank,
      topic: "sleep",
      evidence: { source: "stops.json (D18); OpenHolidays; Eurostat" },
      handoffs: [],
      settled: core.choices.booked.includes(n.index) ? "Booked" : chosen ? `Chosen: ${chosen.name ?? "a place without a name"}` : undefined,
    });
  }

  // --- getting there and back, borders ---------------------------------------------------------------------
  const ends = [
    { id: "start", m: core.axis.startM, d: rides[0]!, word: "to the start" },
    { id: "end", m: core.axis.endM, d: rides[rides.length - 1]!, word: "home from the end" },
  ];
  const ownWay = fewTrains(data, core);
  for (const e of ends) {
    const near = data.stops.stops
      .filter((s) => s.station && s.station_at_m !== null && Math.abs(s.station_at_m - e.m) <= 10_000)
      .sort((a, b) => Math.abs(a.station_at_m! - e.m) - Math.abs(b.station_at_m! - e.m))[0];
    add({
      // The station in the id: a tick belongs to it, not to whichever station the start moves to (D64).
      id: `travel:${e.id}:${near?.id ?? "none"}`,
      kind: "todo",
      day: e.d.number,
      fromM: e.m,
      toM: e.m,
      title: near ? `Train ${e.word}: ${near.station}` : ownWay ? `Getting ${e.word}: your own arrangements` : `Getting ${e.word}: no bike-carrying station found nearby`,
      why: near
        ? `${near.station} carries bikes (our bike-carriage table) and is ${km(Math.abs(near.station_at_m! - e.m) / 1000)} km from the ${e.id}.`
        : ownWay
          ? "No trains that carry bikes along most of this route: you organise your own way there and back."
          : "Plan how you get there and back; we found no station within 10 km.",
      rank: 25,
      topic: "prepare",
      evidence: { source: "M2 stations, bike-carriage table (D20)" },
      handoffs: railLinks([near?.country]),
    });
  }
  let prev: string | null = null;
  for (const d of rides) {
    const cc = d.stop?.country ?? null;
    if (prev && cc && cc !== prev && (!inSchengen(prev) || !inSchengen(cc))) {
      add({
        id: `border:${prev}-${cc}`,
        kind: "todo",
        day: d.number,
        fromM: d.fromM,
        toM: d.toM,
        title: `Border into ${country(cc)} on day ${d.number}: check entry rules`,
        why: `${country(prev)} and ${country(cc)} are not both in the Schengen area.`,
        rank: 26,
        topic: "prepare",
        evidence: { source: "Schengen members (European Commission)" },
        handoffs: [],
      });
    }
    if (cc) prev = cc;
  }

  // --- missing data (D37) ----------------------------------------------------------------------------------
  const countries = [...new Set(nights.map((n) => n.stop.country).filter((c): c is string => !!c))];
  const year = Number(inputs.startDate.slice(0, 4));
  for (const cc of countries) {
    const cal = data.calendar?.countries.find((c) => c.country === cc);
    if (!cal || cal.public_year === null) {
      add({ id: `data:holidays:${cc}`, kind: "todo", day: null, fromM: null, toM: null, title: `Public holidays in ${country(cc)}: no data`, why: "Shops and some places close on public holidays: check the local calendar.", rank: 15, topic: "prepare", evidence: { source: "OpenHolidays" }, handoffs: [] });
    } else if (cal.public_year !== year) {
      add({ id: `data:holidays:${cc}`, kind: "todo", day: null, fromM: null, toM: null, title: `Public holidays in ${country(cc)} for ${year} aren't published yet`, why: "Check the local calendar before you go.", rank: 15, topic: "prepare", evidence: { source: "OpenHolidays" }, handoffs: [] });
    }
  }
  const unknownSurface = rides.reduce((a, d) => a + d.surfaces.u * d.km, 0);
  const total = rides.reduce((a, d) => a + d.km, 0);
  if (total > 0 && unknownSurface / total > 0.1) {
    add({
      id: "data:surface",
      kind: "todo",
      day: null,
      fromM: null,
      toM: null,
      title: `Surface unknown for ${km(unknownSurface)} km of the way`,
      why: "Times there are ranges; look at the line in your route tool or street-level imagery.",
      rank: 14,
      topic: "prepare",
      evidence: { source: "OSM surface tags (M1)" },
      handoffs: [],
    });
  }

  if (data.full) fullRules(data, core, add);

  // Street-level photos where the heads-up begins, in the direction of travel (D58).
  if (geo) {
    const reverse = inputs.direction === "reverse";
    for (const i of items) {
      if (i.fromM === null || !SEE_IT.some((s) => i.id.startsWith(s))) continue;
      if (i.evidence.findings?.some((id) => NOT_SEEN.some((r) => data.full?.findings.find((f) => f.id === id)?.rule_id === r))) continue;
      const ends = [i.fromM, i.toM ?? i.fromM];
      const m = reverse ? Math.max(...ends) : Math.min(...ends);
      const country = data.dream.sections.find((s) => m >= s.from_m && m <= s.to_m)?.country ?? null;
      i.handoffs.push(...streetPhotos(geo, m, inputs.direction, country));
    }
  }

  return items.sort((a, b) => b.rank - a.rank || (a.day ?? 0) - (b.day ?? 0));
}

interface FindingRule {
  rank: number;
  title: (f: Finding, len: number) => string;
  short: (len: number) => string;
  why: string;
  relevant?: (core: PlanCore, f: Finding, len: number) => boolean;
}

/** Audit findings that become heads-ups, in the rider's words (the audit's own wording is for us, D43). */
const FINDING_RULES: Record<string, FindingRule> = {
  "audit.busy_road": {
    rank: 55,
    title: (f, len) => {
      const roads = f.title.split(" on ").slice(2).join(" on ");
      return `${km(len)} km on busy roads${roads ? ` (${roads})` : ""}`;
    },
    short: (len) => `Busy road ${km(len)} km`,
    why: "Fast or heavy traffic and no cycle lane, estimated from the road's class and speed limit.",
    relevant: (core, _f, len) => len >= 1 || core.inputs.avoidBusy,
  },
  "audit.steps": { rank: 36, title: () => "steps", short: () => "Steps", why: "You'll need to carry or push the bike." },
  "audit.unpaved": {
    rank: 34,
    title: (_f, len) => `${km(len)} km unpaved`,
    short: (len) => `Unpaved ${km(len)} km`,
    why: "Loose gravel, dirt or sand: slow with a loaded bike, and harder when wet.",
    relevant: (core) => core.inputs.avoidGravel || core.inputs.bike === "road",
  },
  "services.bail_out": {
    rank: 46,
    title: (_f, len) => `${km(len)} km without a station that carries bikes`,
    short: (len) => `No bike station ${km(len)} km`,
    why: "No station within 10 km of the route where bikes are known to be carried.",
  },
  "eurovelo.undeveloped": {
    rank: 30,
    title: () => "the route is undeveloped here",
    short: () => "Undeveloped route",
    why: "EuroVelo has no reliable information here, or it isn't developed for cycling: expect no signs, and possibly busy roads.",
  },
  "eurovelo.partially_developed": {
    rank: 20,
    title: () => "the route is partially developed here",
    short: () => "Partly developed",
    why: "EuroVelo rates it partially developed: expect parts without cycle infrastructure or signs.",
  },
  "audit.unmatched": {
    rank: 31,
    title: (_f, len) => `${km(len)} km where the official track follows no mapped way`,
    short: (len) => `Off-map track ${km(len)} km`,
    why: "Check the line in your route tool.",
    relevant: (_core, _f, len) => len >= 1,
  },
};

function fullRules(data: PlanData, core: PlanCore, add: (i: PlanItem) => void) {
  const full = data.full!;
  const rides = core.days.filter((d) => d.kind === "ride");
  const water = full.serviceTypes.find((t) => t.id === "water");
  const food = full.serviceTypes.find((t) => t.id === "food");
  const ownWay = fewTrains(data, core);
  const gaps: { item: PlanItem; km: number }[] = [];
  for (const d of rides) {
    // Findings on the day.
    for (const f of full.findings) {
      const rule = FINDING_RULES[f.rule_id];
      if (!rule || !inDay(core, d, f.from_m, f.to_m)) continue;
      if (ownWay && f.rule_id === "services.bail_out") continue;
      // Only the part of the finding on this day counts, and its km are the day's own.
      const lo = Math.max(Math.min(f.from_m, f.to_m), Math.min(d.fromM, d.toM));
      const hi = Math.min(Math.max(f.from_m, f.to_m), Math.max(d.fromM, d.toM));
      const len = Math.max(0, hi - lo) / 1000;
      if (rule.relevant && !rule.relevant(core, f, len)) continue;
      const clip = (m: number) => Math.min(Math.round(d.km), Math.round(dayKm(core, d, m)));
      const [a, b] = [clip(lo), clip(hi)].sort((x, y) => x - y) as [number, number];
      add({
        id: `finding:${f.id}:${d.number}`,
        kind: "headsup",
        day: d.number,
        fromM: lo,
        toM: hi,
        title: `${a === b ? `km ${a}` : `km ${a}–${b}`}: ${rule.title(f, len)}`,
        short: rule.short(len),
        why: rule.why,
        rank: rule.rank + Math.min(4, len / 5),
        topic: rule.rank >= 45 ? "risk" : "like",
        evidence: { findings: [f.id], source: "audit findings" },
        handoffs: [],
      });
    }
    // Water and food: where they are, and the longest stretch without (riders judge what to carry, D48). Where the
    // day's places didn't load, nothing is said: not loaded isn't none (D37).
    const lo = Math.min(d.fromM, d.toM);
    const hi = Math.max(d.fromM, d.toM);
    const loaded = !placesMissing(full, lo, hi).length;
    const on = (svc: string[]) =>
      full.places
        .filter((p) => svc.includes(p.service) && p.counts && p.access_at_m >= lo && p.access_at_m <= hi)
        .map((p) => dayKm(core, d, p.access_at_m))
        .sort((x, y) => x - y);
    for (const [svc, cfg, label] of [
      [["water", "food"], water, "water"],
      [["food"], food, "food"],
    ] as const) {
      if (!cfg?.gap_m || !loaded) continue;
      const pts = [0, ...on([...svc]), d.km];
      let worst = 0;
      let at = 0;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]! - pts[i - 1]! > worst) {
          worst = pts[i]! - pts[i - 1]!;
          at = pts[i - 1]!;
        }
      }
      if (worst * 1000 > cfg.gap_m) {
        gaps.push({ km: worst, item: {
          id: `${label}:gap:${d.number}`,
          kind: "headsup",
          day: d.number,
          fromM: d.fromM,
          toM: d.toM,
          title: `No ${label} for ${Math.round(worst)} km from km ${Math.round(at)}`,
          short: `No ${label} ${Math.round(worst)} km`,
          why: `The longest stretch on the day without ${label === "water" ? "water or a shop" : "food"}; you judge what to carry.`,
          rank: 47,
          topic: "risk",
          evidence: { source: "M2 places" },
          handoffs: [],
        } });
      }
    }
    // Few food places open on the date: said only when we know the hours of nearly all of them (D57), since a
    // conclusion drawn from the few that publish hours would be a guess.
    const eat = foodOnDay(data, d);
    if (eat && eat.all >= 3 && eat.known / eat.all >= KNOWN_ENOUGH) {
      if (eat.open / eat.known <= 0.5) {
        const what = eat.holiday ? `a public holiday (${eat.holiday})` : `a ${WEEKDAYS_LONG[weekday(d.date)]}`;
        add({
          id: `open:${d.number}`,
          kind: "headsup",
          day: d.number,
          fromM: d.fromM,
          toM: d.toM,
          title: `Day ${d.number} is ${what}: ${eat.open} of the ${eat.known} food places${eat.known < eat.all ? " with known hours" : ""} are open`,
          short: "Food: few open",
          why: "From their published hours; check the ones you count on.",
          rank: 44,
          topic: "risk",
          evidence: { places: eat.ids, source: "OSM opening_hours" },
          handoffs: [],
        });
      }
    }
    // The day's biggest climb.
    const climbs = full.climbs.filter((c) => c.direction === core.inputs.direction && inDay(core, d, c.from_m, c.to_m));
    const big = climbs.sort((a, b) => b.fiets - a.fiets)[0];
    if (big && big.gain_m >= 150) {
      const at = Math.round(dayKm(core, d, core.inputs.direction === "forward" ? big.from_m : big.to_m));
      const tough = core.level.level <= 2 && (big.avg_grade >= 5 || big.length_m >= 5000);
      add({
        id: `climb:${d.number}`,
        kind: tough ? "headsup" : "highlight",
        day: d.number,
        fromM: big.from_m,
        toM: big.to_m,
        title: `The day's big climb: ${km(big.length_m / 1000)} km at ${big.avg_grade.toFixed(1)}% from km ${at}, to ${Math.round(big.top_m)} m`,
        short: `Climb ${km(big.length_m / 1000)} km ${big.avg_grade.toFixed(1)}%`,
        why: `${Math.round(big.gain_m)} m up; steepest 500 m ${big.max_grade_500m.toFixed(0)}%.`,
        rank: tough ? 33 : 18,
        topic: tough ? "able" : "like",
        evidence: { source: "M1 climbs (FIETS)" },
        handoffs: [],
      });
    }
    // Highlights.
    for (const h of full.highlights) {
      if (!inDay(core, d, h.at_m, h.at_m)) continue;
      const links = wikiLinks(h, core.languages);
      add({
        id: `highlight:${h.id}`,
        kind: "highlight",
        day: d.number,
        fromM: h.at_m,
        toM: h.at_m,
        title: h.name,
        why: `${h.kind.replaceAll("_", " ")}${h.unesco ? ", UNESCO World Heritage" : ""}${h.offset_m >= 300 ? `, ${km(h.offset_m / 1000)} km off the route` : ""} at km ${Math.round(dayKm(core, d, h.at_m))}`,
        rank: 10 + 8 * h.rank,
        topic: "like",
        evidence: { highlights: [h.id], source: "OpenStreetMap" },
        handoffs: links,
      });
    }
  }
  // Water and food gaps on most days (sparse country, D69, D70): one piece of advice for the trip, not a warning a
  // day. The day cards still show each day's longest stretch.
  const gapDays = new Set(gaps.map((g) => g.item.day)).size;
  if (gapDays >= 3 && gapDays * 2 >= rides.length) {
    add({
      id: "supply:sparse",
      kind: "todo",
      day: null,
      fromM: null,
      toM: null,
      title: `Long stretches without water or food on ${gapDays} of ${plural(rides.length, "day")}, up to ${Math.round(Math.max(...gaps.map((g) => g.km)))} km`,
      why: "Bring a water filter and enough food: filter from streams and lakes on the way where there are any, your judgement. Each day card shows the day's longest stretch.",
      rank: 47,
      topic: "prepare",
      evidence: { source: "M2 places" },
      handoffs: [],
    });
  } else {
    for (const g of gaps) add(g.item);
  }
}

/** A day's items within the attention budget (11.6): calls and to-dos all, heads-ups and highlights capped. */
export function dayItems(items: PlanItem[], dayNumber: number) {
  const mine = items.filter((i) => i.day === dayNumber);
  const pick = (kind: PlanItem["kind"], cap: number) => {
    const all = mine.filter((i) => i.kind === kind);
    return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
  };
  return {
    calls: mine.filter((i) => i.kind === "call"),
    todos: mine.filter((i) => i.kind === "todo"),
    headsups: pick("headsup", CAPS.headsup),
    highlights: pick("highlight", CAPS.highlight),
  };
}

export const openItems = (items: PlanItem[], done: string[], dismissed: string[]) =>
  items.filter((i) => !done.includes(i.id) && !dismissed.includes(i.id));

/** A night's line in the to-do (D64). */
export const isNightLine = (i: PlanItem) => i.kind === "todo" && i.id.startsWith("bed:");

/**
 * The place the rider chose for a night on its day card, while it is still one of that night's places (D64). A
 * choice stays with its town: when the night moves elsewhere it no longer counts, and counts again if it moves back.
 */
export function chosenBed(data: PlanData, night: NightPlan, choices: Pick<PlanChoices, "beds">, sleep: Sleep): Place | null {
  const id = choices.beds[night.index];
  if (!id || !data.full) return null;
  return bedPlaces(data.full, night.stop, sleep).find((p) => p.id === id) ?? null;
}

/**
 * What's left to sort out before the trip (D64): the calls not yet answered, the nights not yet settled on their day
 * card, and the other to-dos not yet ticked, calls first; and what's done. The plan is complete when `open` is empty.
 */
export function toDo(items: PlanItem[], choices: PlanChoices): { open: PlanItem[]; done: PlanItem[] } {
  const isDone = (i: PlanItem) => (i.kind === "call" ? choices.dismissed.includes(i.id) : isNightLine(i) ? !!i.settled : choices.done.includes(i.id));
  // In the order of the trip: by day, the whole trip's lines last.
  const mine = items.filter((i) => i.kind === "call" || i.kind === "todo").sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity));
  const open = mine.filter((i) => !isDone(i));
  return { open: [...open.filter((i) => i.kind === "call"), ...open.filter((i) => i.kind !== "call")], done: mine.filter(isDone) };
}

export { bedsFor };
