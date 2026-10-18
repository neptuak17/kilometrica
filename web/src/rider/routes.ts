/**
 * The routes a rider can pick: the network routes, plus private routes this browser has opened before (D25: private
 * routes are never listed by the server, so the browser remembers their ids).
 */
import { useEffect, useState } from "react";
import { listingOf, listRoutes, loadManifest, type RouteListing } from "../api";

const PRIVATE_KEY = "dpg.privateRoutes";

export function useRouteList(): RouteListing[] {
  const [routes, setRoutes] = useState<RouteListing[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await listRoutes().catch((): RouteListing[] => []);
      let remembered: string[] = [];
      try {
        remembered = JSON.parse(localStorage.getItem(PRIVATE_KEY) ?? "[]") as string[];
      } catch {
        /* none */
      }
      for (const key of remembered) {
        const [n = "", r = ""] = key.split("/");
        const m = await loadManifest(n, r).catch(() => null);
        if (m) list.push(listingOf(m));
      }
      if (live) setRoutes(list);
    })();
    return () => {
      live = false;
    };
  }, []);
  return routes;
}
