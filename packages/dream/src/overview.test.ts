import type { RouteOverview } from "@dpg/contracts";
import { describe, expect, it } from "vitest";
import { aboutKm, monthRuns, routeDescription, sightName } from "./overview";

const months = (best: number[], high = 80, low = 50) => Array.from({ length: 12 }, (_, m) => (best.includes(m) ? high : low));

function overview(over: Partial<RouteOverview> = {}): RouteOverview {
  return {
    start: "Andermatt",
    end: "Hook of Holland",
    length_m: 1_000_000,
    countries: [
      { cc: "CH", length_m: 400_000, climb_per_km: 8, best_time: months([5, 6, 7]) },
      { cc: "DE", length_m: 600_000, climb_per_km: 3, best_time: months([4, 5, 8]) },
    ],
    climb_m: 5000,
    climb_per_km: 5,
    strong_m: { coast: 0, water: 900_000, wine: 100_000, protected: 0 },
    unesco: [],
    unesco_count: 0,
    passes: [],
    sight_kinds: [],
    surfaces_m: { road: 600_000, cycle_path: 380_000, gravel: 20_000 },
    best_time: months([4, 5, 8]),
    undeveloped_m: 0,
    remote_m: 0,
    longest_remote_m: 0,
    busy_m: 0,
    ferries: 0,
    ...over,
  };
}

describe("words", () => {
  it("rounds km for a description", () => {
    expect(aboutKm(626_000)).toBe("about 630 km");
    expect(aboutKm(1_049_000)).toBe("about 1,050 km");
    expect(aboutKm(2_000)).toBe("about 10 km");
  });

  it("names a sight from its Wikipedia title", () => {
    expect(sightName("Grande Île, Strasbourg")).toBe("Grande Île in Strasbourg");
    expect(sightName("Tombs of the Kings (Paphos)")).toBe("Tombs of the Kings");
    expect(sightName("Ephesus")).toBe("Ephesus");
  });

  it("joins consecutive months, across the new year too", () => {
    expect(monthRuns([3, 4, 8, 9])).toBe("April–May and September–October");
    expect(monthRuns([4])).toBe("May");
    expect(monthRuns([10, 11, 0, 1])).toBe("November–February");
    expect(monthRuns([...Array(12).keys()])).toBe("every month");
  });

});

describe("routeDescription", () => {
  it("says where, the terrain, when and the surface", () => {
    expect(routeDescription(overview())).toEqual([
      "1,000 km from Andermatt to Hook of Holland, through Switzerland and Germany.",
      "Beside lakes and rivers; mostly rolling, flat across Germany.",
      "Best in May–June and September.",
      "Mostly paved.",
    ]);
  });

  it("names the hillier countries and the passes on a mountain route", () => {
    const o = overview({
      climb_per_km: 16,
      climb_m: 16_000,
      countries: [{ cc: "FR", length_m: 1_000_000, climb_per_km: 16, best_time: months([5]) }],
      passes: [{ name: "Col d'Aubisque", kind: "pass", wikidata: null, at_m: 1 }],
    });
    expect(routeDescription(o)[0]).toBe("1,000 km from Andermatt to Hook of Holland, all in France.");
    expect(routeDescription(o)[1]).toBe("Beside lakes and rivers; mountainous, with 16,000 m of climbing, over Col d'Aubisque.");
  });

  it("names World Heritage sites, else the kinds that stand out, and wine country", () => {
    const named = overview({ unesco: [{ name: "Cologne Cathedral", kind: "heritage", wikidata: "Q4176", at_m: 1 }], unesco_count: 1 });
    expect(routeDescription(named)).toContain("World Heritage sites along the way include Cologne Cathedral.");
    const kinds = overview({ sight_kinds: ["castle", "archaeological_site"], strong_m: { water: 0, wine: 300_000 } });
    expect(routeDescription(kinds)).toContain("Castles and ancient sites along the way.");
    expect(routeDescription(kinds)).toContain("It runs through wine country.");
  });

  it("suggests a bike for gravel by how much there is", () => {
    const some = routeDescription(overview({ surfaces_m: { road: 750_000, gravel: 250_000 } }));
    expect(some).toContain("About 250 km of gravel: tyres that handle gravel help.");
    const mostly = routeDescription(overview({ surfaces_m: { road: 400_000, gravel: 600_000 } }));
    expect(mostly).toContain("Mostly gravel (about 600 km): a gravel bike or wide tyres is the better choice.");
    const paths = routeDescription(overview({ surfaces_m: { road: 500_000, cycle_path: 500_000 } }));
    expect(paths).toContain("Paved throughout and largely on cycle paths.");
    const unknown = routeDescription(overview({ surfaces_m: { road: 850_000, unknown: 150_000 } }));
    expect(unknown).toContain("Mostly paved; we don't know the surface for about 150 km.");
  });

  it("says where there's no route yet, remote stretches and ferries", () => {
    const o = overview({ undeveloped_m: 200_000, remote_m: 300_000, ferries: 2 });
    expect(routeDescription(o)).toEqual(
      expect.arrayContaining([
        "About 200 km has no developed route yet, so you'll find your own way there.",
        "Long stretches are far from shops and water: carry enough.",
        "There are 2 ferry crossings.",
      ]),
    );
    expect(routeDescription(overview({ longest_remote_m: 60_000 }))).toContain("One stretch runs about 60 km far from shops and water: carry enough.");
    // A rider's own route isn't rated, so nothing is said about developed routes.
    expect(routeDescription(overview({ undeveloped_m: null })).join(" ")).not.toContain("developed");
  });

  it("says when the best months differ along the way, and when there's no weather data", () => {
    const o = overview({ countries: [{ cc: "ES", length_m: 500_000, climb_per_km: 5, best_time: months([0, 1]) }, ...overview().countries] });
    expect(routeDescription(o)).toContain("Best in May–June and September. It varies along the way: Dream shows each country month by month.");
    expect(routeDescription(overview({ best_time: Array(12).fill(null) }))).toContain("We don't have weather data for it yet.");
  });

  it("never says busy roads (D89)", () => {
    expect(routeDescription(overview({ busy_m: 900_000 })).join(" ")).not.toMatch(/busy/i);
  });
});
