/** Plan in the new look (D53, D54): the kit's styles load here and on /dream only, so the audit viewer keeps its own. */
import "@dpg/ui/theme.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "../maplibre-worker";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RiderApp } from "./RiderApp";

export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <RiderApp />
    </StrictMode>,
  );
}
