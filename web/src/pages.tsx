/** The audit viewer and the rider view, with their own styles (the shadcn kit's styles stay on /ui, D53). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import "./styles.css";
import { App } from "./App";
import { DreamApp } from "./rider/DreamPage";
import { RiderApp } from "./rider/RiderApp";

export function mount(root: HTMLElement, path: string) {
  // /dream and /plan are the rider view (M4, A1): apart from the audit viewer, which is ours (D43).
  const page = path.startsWith("/dream") ? <DreamApp /> : path.startsWith("/plan") ? <RiderApp /> : <App />;
  createRoot(root).render(<StrictMode>{page}</StrictMode>);
}
