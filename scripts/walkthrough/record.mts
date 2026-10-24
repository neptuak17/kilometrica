/**
 * The recorded walkthrough of Dream and Plan on EV8 (D88): `npm run walkthrough` drives the local app in the installed
 * Edge, as a rider would, and saves a 1920×1080 WebM in `walkthrough/`. It starts the API and the web app if they
 * aren't running. The stretch is Dream's own first choice for the question asked; if a re-audit changes that, the
 * script stops and says so rather than picking one by hand. Counts in the captions are read from the screen.
 *
 *   npm run walkthrough              record (headless)
 *   npm run walkthrough -- --watch   record in a visible window
 *   npm run walkthrough -- --plan    Plan only, from Dream's link, for a retake of that part
 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright";
import { overlay } from "./overlay.mts";

const REPO = resolve(import.meta.dirname, "../..");
const OUT = resolve(REPO, "walkthrough");
const APP = "http://localhost:5173";
const API = "http://localhost:8787/v1/routes";
const FILE = "kilometrica-dream-plan-ev8.webm";

/** What Dream must rank first and second, or the walkthrough is no longer the one agreed. */
const FIRST = "Ulldecona → Blanes";
const SECOND = "Sollana → Vandellos i l'Hospitalet de l'Infant";
const EXAMPLE = "A week of coast and villages";
const REST_IN = "Barcelona";
/** Dream's link for the first stretch, for `--plan`. */
const PLAN = "/plan?route=eurovelo%2Fev8&first=33&last=38&way=forward&days=7&rest=1&month=4&level=2&gravel=ok&busy=1&stay=rooms&train=1";

// Laid out like a laptop at 125%, so the text reads in a 1920×1080 video. The browser itself draws at 125%, so
// popovers stay with their buttons and the video gets every pixel (Playwright's own scaling pads the frame instead).
const SCALE = 1.25;
const VIDEO = { width: 1920, height: 1080 };
const VIEW = { width: VIDEO.width / SCALE, height: VIDEO.height / SCALE };

const up = async (url: string) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

async function startApp(): Promise<ChildProcess | null> {
  if ((await up(APP)) && (await up(API))) return null;
  console.log("Starting the API and the web app…");
  const dev = spawn("npm run dev", { cwd: REPO, shell: true, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    if ((await up(APP)) && (await up(API))) return dev;
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopApp(dev);
  throw new Error("The app didn't start within two minutes: try `npm run dev` on its own.");
}

function stopApp(dev: ChildProcess | null) {
  if (!dev?.pid) return;
  try {
    execSync(process.platform === "win32" ? `taskkill /pid ${dev.pid} /T /F` : `kill -- -${dev.pid}`, { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

/** The rider's hand and the captions, at a pace a viewer can follow. */
function director(page: Page) {
  const pause = (ms: number) => page.waitForTimeout(ms);
  const caption = async (title: string, text: string, read = 0) => {
    await page.evaluate(([t, x]) => (window as any).__wt.caption(t, x), [title, text]);
    // About 18 characters a second, and never less than two seconds.
    await pause(read || Math.max(2000, (title.length + text.length) * 55));
  };
  const card = (title: string, text: string) => page.evaluate(([t, x]) => (window as any).__wt.card(t, x), [title, text]);
  const show = async (target: Locator, block: "start" | "center" = "center") => {
    await target.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await pause(900);
  };
  const point = async (target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("Nothing to point at on screen.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
    await pause(350);
  };
  const click = async (target: Locator) => {
    await point(target);
    await target.click();
    await pause(700);
  };
  const scrollBy = async (y: number) => {
    await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), y);
    await pause(1100);
  };
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await pause(1200);
  };
  return { pause, caption, card, show, point, click, scrollBy, settle };
}

/** Size the window so the page itself is VIEW. The headless window's frame takes 34×97 of its own units, so it is
 * usually exact at once; otherwise one correction, and a pixel or two out only scales the video by as much. */
const FRAME = { width: 34, height: 97 };

async function fitWindow(page: Page) {
  const size = async () => (await page.evaluate("[innerWidth, innerHeight]")) as [number, number];
  let [w, h] = await size();
  if (w === VIEW.width && h === VIEW.height) return;
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: bounds.width! + VIEW.width - w, height: bounds.height! + VIEW.height - h } });
  await page.waitForTimeout(300);
  [w, h] = await size();
  if (Math.abs(w - VIEW.width) > 2 || Math.abs(h - VIEW.height) > 2) throw new Error(`The page came out at ${w}×${h}, not ${VIEW.width}×${VIEW.height}.`);
  if (w !== VIEW.width || h !== VIEW.height) console.log(`The page is ${w}×${h}, a pixel or two off ${VIEW.width}×${VIEW.height}.`);
}

async function dream(page: Page, d: ReturnType<typeof director>) {
  await page.goto(`${APP}/dream`);
  await d.settle();
  await d.card("Kilometrica", "Dream and Plan, on EuroVelo 8");
  await d.pause(3000);
  await d.card("", "");
  await d.caption("Dream", "Where would you like to ride? We'll take EuroVelo 8, the Mediterranean Route.");
  const ev8 = page.locator("[data-slot=card]", { hasText: "EuroVelo 8" }).getByRole("link", { name: "Choose" });
  await d.click(ev8);
  await page.getByRole("heading", { name: /EuroVelo 8/ }).waitFor();
  await d.settle();

  const size = (await page.locator("main p").first().innerText()).trim();
  await d.caption("The whole route", `${size}. Before you answer anything, Dream shows when each part is good to ride.`);
  await d.point(page.getByRole("region", { name: "When to ride" }));
  await d.pause(1500);

  const example = page.locator("[data-slot=card]", { hasText: EXAMPLE });
  await d.show(example);
  await d.caption("Start from an example", `Not sure where to begin? "${EXAMPLE}" fills in a whole question in one tap.`);
  await d.click(example.getByRole("button", { name: "Start from this" }));
  await d.settle();

  const chips = page.getByRole("group", { name: "Your trip" });
  await d.show(chips, "start");
  await d.caption("Your answers", "Easy-moderate, a week, coast and villages, rooms, a train at both ends, no busy roads. Each one is a chip you can change.");
  await d.caption("When", "Let's ride in May.", 1600);
  await d.click(chips.getByRole("button", { name: /Any month/ }));
  const when = page.getByRole("dialog", { name: "When" });
  await d.click(when.getByText("May", { exact: true }));
  await d.click(when.getByRole("button", { name: "Done" }));
  await d.settle();

  // Dream's own ranking, never a stretch picked by hand (D88).
  const cards = page.locator("section[aria-labelledby=results-title] > div").filter({ has: page.getByRole("link", { name: "Plan this" }) });
  const names = await cards.evaluateAll((els) => els.map((el) => el.querySelector("button[aria-pressed]")?.textContent?.replace(/^\d+/, "").trim() ?? ""));
  if (names[0] !== FIRST || names[1] !== SECOND)
    throw new Error(`Dream now ranks "${names[0]}" and "${names[1]}" first, not "${FIRST}" and "${SECOND}": the walkthrough needs agreeing again.`);

  const fit = (await page.locator("#results-title").innerText()).split("·")[0]!.trim();
  await d.caption("Stretches that fit", `${fit} in May. The best three are on the map, each with what it's like, the usual weather, what to watch and what to check yourself.`);
  await d.show(cards.first(), "start");
  await d.pause(2500);

  await d.caption("Compare", "Tick two to see them side by side.", 1800);
  await d.click(cards.nth(0).getByText("Compare", { exact: true }));
  await d.click(cards.nth(1).getByText("Compare", { exact: true }));
  await d.click(page.getByRole("button", { name: "Compare", exact: true }));
  await page.getByRole("heading", { name: "Compare 2 stretches" }).waitFor();
  await d.settle();
  await d.caption("Compare", "The rows where they differ are shaded: the climbing, the surfaces, busy roads, the weather, the trains at each end.");
  await d.point(page.getByRole("row", { name: /Busy roads/ }));
  await d.pause(1500);
  await d.caption("Plan this", `We'll take ${FIRST}, through Tarragona, Sitges and Barcelona. Plan this takes the stretch, the days and the month into Plan.`);
  await d.click(page.getByRole("link", { name: "Plan this" }).first());
}

async function plan(page: Page, d: ReturnType<typeof director>) {
  await page.getByText("A few questions").waitFor({ timeout: 60_000 });
  await page.getByText("Loading the Trip Pass detail").waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
  await d.settle();
  const title = (await page.locator("main h1").first().innerText()).trim();
  const dates = (await page.locator("main h1 + p").first().innerText()).split("·")[1]?.trim() ?? "";
  await d.caption("Plan", `${title}, ${dates}. Plan drafts the whole trip from a few questions, each with a default you can change.`);

  const restIn = page.getByRole("button", { name: /Rest in/ });
  await d.show(restIn);
  await d.caption("Rest in…", `A day in ${REST_IN}? Pick the town, and the plan stops there and rests.`);
  await d.click(restIn);
  await d.click(page.getByRole("option", { name: REST_IN, exact: true }));
  await d.settle();

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await d.pause(900);
  await d.caption("What changed", "Plan says exactly what changed, and what it costs.", 2500);
  await d.click(page.getByText("All changes"));
  await d.caption("What changed", "Here, the last day gets longer. Keep it, or undo it in one click.", 4500);
  await d.click(page.getByRole("button", { name: "Hide this line" }));

  await d.click(page.getByRole("button", { name: "Show the plan" }));
  const glance = page.getByText("The trip at a glance");
  await d.show(glance, "start");
  await d.caption("The trip at a glance", "Can I do it? Where will I sleep? What should I look out for? What do I sort out before I go? And what will it be like?");

  const days = page.locator("[data-slot=card-title]", { hasText: "The days" });
  await d.show(days, "start");
  await d.caption("The days", "Every day, with its distance, time and effort. Each opens its own card.", 3000);
  const day5 = page.getByRole("button", { name: /^Day 5\b/ });
  await d.click(day5);
  await d.settle();
  const card = page.locator("h2", { hasText: "→" }).first();
  await d.show(card, "start");
  await d.caption("A day's card", `Day 5, ${(await card.innerText()).trim()}: the map and profile, water and food, heads-ups and highlights.`);
  const sleep = page.locator("#day-sleep");
  await d.show(sleep, "start");
  await d.caption("A place to stay", "Every night lists places to stay, your kind first, with links to their own sites. Choose one.");
  await d.click(sleep.getByRole("button", { name: "Choose" }).first());
  await d.caption("", "Kilometrica doesn't navigate or book: it hands you to the apps and sites that do.", 3500);

  const todo = page.getByText("To do", { exact: true });
  await d.show(todo, "start");
  await d.caption("Before you go", "The To do list gathers what to sort out before you leave. Each line takes you to its day.");

  await d.click(page.getByRole("button", { name: "Trip book" }));
  await page.getByRole("button", { name: "Back to the plan" }).waitFor();
  await d.settle();
  await d.caption("The trip book", "The brief and a page per day, to print or save as a PDF for when there's no signal.", 2500);
  for (let i = 0; i < 4; i++) await d.scrollBy(700);
  await d.pause(800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await d.pause(900);
  await d.click(page.getByRole("button", { name: "Back to the plan" }));
  await d.settle();

  const qr = page.getByRole("button", { name: "Show a QR code" });
  await d.show(qr);
  await d.caption("Send to your phone", "No account: the link holds the plan itself. Scan it, and Go takes over on the road.", 1800);
  await d.click(qr);
  await d.scrollBy(260);
  await d.pause(4000);
  await d.caption("", "");
  await d.card("Kilometrica", "Dream · Plan · Go");
  await d.pause(3500);
}

async function main() {
  // Playwright's own ffmpeg lives in the repo (D88), so it works from any terminal.
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(REPO, ".playwright");
  const { chromium } = await import("playwright");
  const argv = process.argv;
  const watch = argv.includes("--watch");
  const dev = await startApp();
  const tmp = resolve(OUT, ".takes");
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch({
    channel: "msedge",
    headless: !watch,
    args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.width + FRAME.width},${VIEW.height + FRAME.height}`],
  });
  try {
    const context = await browser.newContext({
      viewport: null,
      colorScheme: "light",
      locale: "en-GB",
      recordVideo: { dir: tmp, size: VIDEO },
    });
    // tsx keeps function names with a helper the page doesn't have.
    await context.addInitScript({ content: `var __name = (f) => f; (${overlay.toString()})();` });
    const page = await context.newPage();
    await fitWindow(page);
    const d = director(page);
    let failed: unknown = null;
    try {
      if (argv.includes("--plan")) await page.goto(`${APP}${PLAN}`);
      else await dream(page, d);
      await plan(page, d);
    } catch (e) {
      failed = e;
    }
    const video = page.video();
    await context.close();
    if (failed) {
      await video?.delete();
      throw failed;
    }
    const out = resolve(OUT, FILE);
    await video!.saveAs(out);
    await video!.delete();
    console.log(`Saved ${out}`);
  } finally {
    await browser.close();
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      /* a take still closing: the next run replaces it */
    }
    stopApp(dev);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
