/** The audit viewer and Plan, with their own styles (the shadcn kit's styles load only on /ui and /dream, D53). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import "./styles.css";
import { App } from "./App";
import { RiderApp } from "./rider/RiderApp";

export function mount(root: HTMLElement, path: string) {
  // /plan is the rider view (M4, A1): apart from the audit viewer, which is ours (D43). /dream has its own entry.
  const page = path.startsWith("/plan") ? <RiderApp /> : <App />;
  createRoot(root).render(<StrictMode>{page}</StrictMode>);
}
