/** Will I like it? The highlights on a day (D48), with their Wikipedia and Commons links (D51). */
import type { PlanCore } from "../plan";
import { km } from "../text";
import type { DayPlan, FullData } from "../types";
import { wikiLinks } from "./links";
import { type Add, dayKm, inDay } from "./shared";

export function highlightItems(full: FullData, core: PlanCore, d: DayPlan, add: Add) {
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
