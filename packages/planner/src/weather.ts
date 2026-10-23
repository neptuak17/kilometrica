/**
 * The usual weather (M3's climate normals) in one wording everywhere it is shown (D77): Dream's stretch cards, the
 * trip brief and the day cards, and the assistant's tools, which may say nothing the screen doesn't. It is never a
 * forecast; forecasts belong to Go.
 */
import type { DreamSection } from "@dpg/contracts";
import { oneIn } from "./text";

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** The wind along the way in words: a tailwind or headwind of 1 m/s on average is worth saying. */
export const windText = (ms: number) => (ms >= 1 ? "a light tailwind on average" : ms <= -1 ? "a headwind on average" : "little wind along the way");

/**
 * "typically 12–21 °C, rain 1 day in 5, little wind along the way": night lows to day highs and the share of days with
 * rain, averaged over the sections, in this month; the wind along the way when it is given (the direction the rider
 * rides). Null when there is no climate data.
 */
export function usualWeather(sections: DreamSection[], month: number, windMs: number | null = null): string | null {
  const clim = sections.filter((s) => s.climate).map((s) => s.climate!);
  if (!clim.length) return null;
  const low = mean(clim.map((c) => c.tmin_c[month]));
  const high = mean(clim.map((c) => c.tmax_c[month]));
  const rain = mean(clim.map((c) => c.rain_days[month]));
  const parts: string[] = [];
  if (low !== null && high !== null) parts.push(`typically ${Math.round(low)}–${Math.round(high)} °C`);
  else if (high !== null) parts.push(`typically ${Math.round(high)} °C highs`);
  if (rain !== null) parts.push(`rain ${oneIn(rain)}`);
  if (windMs !== null) parts.push(windText(windMs));
  return parts.length ? parts.join(", ") : null;
}

/** The same as a sentence of its own: "Typically 12–21 °C, rain 1 day in 5." */
export const weatherSentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
