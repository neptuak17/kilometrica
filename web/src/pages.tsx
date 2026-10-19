/** The audit viewer, with its own styles: it is ours, not the riders' (D43). Dream and Plan have their own entries. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import "./styles.css";
import { App } from "./App";

export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
