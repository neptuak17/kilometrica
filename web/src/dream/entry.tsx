/** Dream in the new look (D53, D54): the kit's styles load here only, so the pages not yet redesigned keep theirs. */
import "@dpg/ui/theme.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "../maplibre-worker";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DreamApp } from "./DreamPage";

export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <DreamApp />
    </StrictMode>,
  );
}
