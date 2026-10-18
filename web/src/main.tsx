import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import "./styles.css";
import { App } from "./App";
import { DreamApp } from "./rider/DreamPage";
import { RiderApp } from "./rider/RiderApp";

// /dream and /plan are the rider view (M4, A1): apart from the audit viewer, which is ours (D43).
const path = window.location.pathname;
const page = path.startsWith("/dream") ? <DreamApp /> : path.startsWith("/plan") ? <RiderApp /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
