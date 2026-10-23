/**
 * Hand-offs (D41): links to the sites and apps that do what we don't. Rail operators, Wikipedia and Commons, Google
 * Maps, the booking searches and street-level photos, each filled in for the place, the night or the point on the route.
 */
import type { Highlight } from "@dpg/contracts";
import { bearing, type Geometry, locate } from "../geometry";
import type { PlanCore } from "../plan";
import { addDays } from "../sun";
import { country } from "../text";
import { restLengthOf } from "../rest";
import type { Handoff, NightPlan, PlanData, PlanInputs, PlanItem, Sleep } from "../types";
import { dayKm } from "./shared";

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
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

/** The nights at a stop: in that night, out the next morning, or after the rest days that follow (D74, D80). */
export function nightStay(night: NightPlan, restAfter: number[], inputs?: Pick<PlanInputs, "restLength">): { checkIn: string; checkOut: string } {
  const rest = restAfter.includes(night.afterRide) ? restLengthOf(inputs ?? {}, night.afterRide) : 0;
  return { checkIn: night.date, checkOut: addDays(night.date, 1 + rest) };
}

/** How many nights at a stop: 1, or more before rest days. */
export const nightsAt = (night: NightPlan, restAfter: number[], inputs?: Pick<PlanInputs, "restLength">) =>
  restAfter.includes(night.afterRide) ? 1 + restLengthOf(inputs ?? {}, night.afterRide) : 1;

/**
 * A night's fallback, for when none of our places suit (D60): Booking.com and Expedia searched for the stop and the
 * nights there. By town and country, or by the stop's position, nearest first, when it has no town name. Guests are
 * left to the rider. None for riders who only camp: the two sites list few campsites.
 */
export function bookingSearches(night: NightPlan, inputs: { sleep: Sleep; restAfter: number[]; restLength?: PlanInputs["restLength"] }): Handoff[] {
  if (inputs.sleep === "camping") return [];
  const { checkIn, checkOut } = nightStay(night, inputs.restAfter, inputs);
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

/** Street-level photos where each heads-up about the way begins, in the direction of travel (D58). */
export function addStreetPhotos(data: PlanData, core: PlanCore, items: PlanItem[], geo: Geometry) {
  const { inputs, days } = core;
  const reverse = inputs.direction === "reverse";
  for (const i of items) {
    if (i.fromM === null || !SEE_IT.some((s) => i.id.startsWith(s))) continue;
    if (i.evidence.findings?.some((id) => NOT_SEEN.some((r) => data.full?.findings.find((f) => f.id === id)?.rule_id === r))) continue;
    // A day's ferries: photos at each, by its km of the day.
    const day = days.find((x) => x.number === i.day);
    if (i.id.startsWith("ferry:") && i.id.includes("+") && day) {
      for (const m of i.id.slice("ferry:".length).split("+").map(Number)) {
        const country = data.dream.sections.find((s) => m >= s.from_m && m <= s.to_m)?.country ?? null;
        const at = Math.round(dayKm(core, day, m));
        i.handoffs.push(...streetPhotos(geo, m, inputs.direction, country).map((h) => ({ ...h, label: `km ${at}: ${h.label}` })));
      }
      continue;
    }
    const ends = [i.fromM, i.toM ?? i.fromM];
    const m = reverse ? Math.max(...ends) : Math.min(...ends);
    const country = data.dream.sections.find((s) => m >= s.from_m && m <= s.to_m)?.country ?? null;
    i.handoffs.push(...streetPhotos(geo, m, inputs.direction, country));
  }
}
