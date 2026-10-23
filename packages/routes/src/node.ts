/**
 * Route files in Node, outside the browser (A2, D77): the API's own code answers each request in-process, so places
 * are filtered exactly as the rider view's requests are, with no server to start. Bundles are read from
 * `DPG_DATA_DIR` (the repo's `.env` sets it to the Ubuntu filesystem), else the repo's `data/`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "@dpg/api/app";
import { FsBundleStore } from "@dpg/api/store";
import type { Fetch } from "./index";

const REPO = resolve(import.meta.dirname, "../../..");

export function dataDir(): string {
  const env = resolve(REPO, ".env");
  if (!process.env.DPG_DATA_DIR && existsSync(env)) process.loadEnvFile(env);
  return resolve(process.env.DPG_DATA_DIR ?? resolve(REPO, "data"));
}

/** A fetch answered by the API in this process, over the bundles in `dir`. */
export function localFetch(dir = dataDir()): Fetch {
  const app = createApp(new FsBundleStore(dir));
  return async (url) => app.request(url);
}
