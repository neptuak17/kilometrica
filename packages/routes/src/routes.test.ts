import { describe, expect, it } from "vitest";
import { type Fetch, joinRanges, loadFull, loadRoute } from "./index";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const place = (id: string, at: number) => ({ id, access_at_m: at });

describe("route files", () => {
  it("joins touching ranges and keeps apart ones apart", () => {
    expect(joinRanges([{ fromM: 50_000, toM: 100_000 }, { fromM: 0, toM: 50_000 }, { fromM: 150_000, toM: 200_000 }])).toEqual([
      { fromM: 0, toM: 100_000 },
      { fromM: 150_000, toM: 200_000 },
    ]);
  });

  it("pins every request to the run asked for", async () => {
    const urls: string[] = [];
    const fetch: Fetch = async (url) => {
      urls.push(url);
      if (url.startsWith("/v1/routes/user/u1?")) return json({ run_id: "R", route: { name: "Mine" }, files: { stops: 1, effort: 1, dream: 1 } });
      if (url.includes("/sections")) return json({ daily: [] });
      if (url.includes("/path")) return json({ features: [] });
      return json({});
    };
    const files = await loadRoute("user", "U1", { fetch, run: "R" });
    expect(files.free.route).toEqual({ network: "user", ref: "u1", runId: "R", name: "Mine" });
    expect(urls.length).toBe(6);
    expect(urls.every((u) => u.endsWith("?run=R"))).toBe(true);
  });

  it("names the places that didn't load, never passing them on as none (D37)", async () => {
    const fetch: Fetch = async (url) => {
      const q = new URL(url, "http://x").searchParams;
      if (url.includes("/places")) {
        const from = Number(q.get("from_km")) * 1000;
        if (q.get("service") === "station") return json({ places: [], truncated: false });
        // The first block is cut off after its second place; the second fails; the third comes whole.
        if (from === 0) return json({ places: [place("a", 10_000), place("b", 30_000)], truncated: true });
        if (from === 50_000) return new Response("busy", { status: 503 });
        return json({ places: [place("c", 120_000)], truncated: false });
      }
      if (url.includes("/findings")) return json({ findings: [] });
      if (url.includes("/highlights")) return new Response("none", { status: 404 });
      if (url.includes("/scores")) return json({ climbs: [] });
      if (url.includes("/services")) return json({ types: [] });
      throw new Error(url);
    };
    const { full } = await loadFull("eurovelo", "ev8", "R", 0, 150_000, { fetch });
    expect(full.places.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(full.placesMissing).toEqual([{ fromM: 30_000, toM: 100_000 }]);
    expect(full.highlights).toEqual([]);
  });
});
