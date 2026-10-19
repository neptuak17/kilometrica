/**
 * Dream's map (11.7): the whole route, the stretches that fit on it with their numbers, the chosen one in orange.
 * It shows the whole route until a stretch is chosen, then frames that stretch. Clicking a stretch chooses it.
 * MapLibre with the OpenFreeMap basemap, as in Plan. The stretches use the kit's route colours (D53): teal for those that
 * fit, orange for the chosen one.
 */
import { type Geometry, slice } from "@dpg/planner";
import {
  AttributionControl,
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";

const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
// The kit's --route and --route-chosen (oklch teal and orange) as hex, since MapLibre doesn't read oklch.
const ROUTE = "#00786f";
const CHOSEN = "#ff6900";
type FC = { type: "FeatureCollection"; features: { properties: { key: string }; geometry: { coordinates: [number, number][] } }[] };
type Points = { type: "FeatureCollection"; features: unknown[] };

export interface MapStretch {
  key: string;
  fromM: number;
  toM: number;
  /** Chosen, or one of the two compared. */
  on: boolean;
  /** Its number in the list, shown on the map; empty for none. */
  label: string;
}

interface Props {
  geometry: Geometry;
  stretches: MapStretch[];
  /** The stretch or stretches to frame; null shows the whole route. */
  focus: string | string[] | null;
  onPick: (key: string) => void;
  attribution: string[];
  className?: string;
}

function features(geo: Geometry, stretches: MapStretch[]): FC {
  const out: FC["features"] = [];
  for (const s of stretches) {
    for (const seg of slice(geo, s.fromM, s.toM)) {
      out.push({ type: "Feature", properties: { key: s.key, on: s.on ? 1 : 0 }, geometry: { type: "LineString", coordinates: seg } } as FC["features"][number]);
    }
  }
  return { type: "FeatureCollection", features: out };
}

/** A stretch's number, at the middle of its longest piece. */
function labels(lines: FC, stretches: MapStretch[]): Points {
  const out: unknown[] = [];
  for (const s of stretches) {
    if (!s.label) continue;
    const pieces = lines.features.filter((f) => f.properties.key === s.key).map((f) => f.geometry.coordinates);
    const longest = pieces.sort((a, b) => b.length - a.length)[0];
    const at = longest?.[Math.floor(longest.length / 2)];
    if (at) out.push({ type: "Feature", properties: { label: s.label, on: s.on ? 1 : 0 }, geometry: { type: "Point", coordinates: at } });
  }
  return { type: "FeatureCollection", features: out };
}

function boundsOf(lines: [number, number][][]): LngLatBounds | null {
  const b = new LngLatBounds();
  let any = false;
  for (const l of lines)
    for (const c of l) {
      b.extend(c);
      any = true;
    }
  return any ? b : null;
}

export function DreamMap({ geometry, stretches, focus, onPick, attribution, className = "dream-map" }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const data = useMemo(() => features(geometry, stretches), [geometry, stretches]);
  const points = useMemo(() => labels(data, stretches), [data, stretches]);
  const whole = useMemo(() => boundsOf(geometry.lines.map((l) => l.coords)), [geometry]);
  // Framed only when the focus changes, so the rider's own panning survives a new list.
  const focusKey = focus === null ? null : typeof focus === "string" ? focus : focus.join("|");
  const frame = useMemo(() => {
    if (focusKey === null) return whole;
    const keys = focusKey.split("|");
    return boundsOf(data.features.filter((f) => keys.includes(f.properties.key)).map((f) => f.geometry.coordinates)) ?? whole;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, whole, focusKey === null ? null : data]);
  const latest = useRef({ data, points, frame, onPick });
  latest.current = { data, points, frame, onPick };

  useEffect(() => {
    if (!container.current) return;
    const initial = latest.current.frame;
    const m = new MapLibreMap({
      container: container.current,
      style: BASEMAP,
      attributionControl: false,
      ...(initial ? { bounds: initial, fitBoundsOptions: { padding: 40, maxZoom: 11 } } : { center: [10, 43], zoom: 5 }),
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.addControl(new AttributionControl({ compact: true, customAttribution: attribution }), "bottom-right");
    const el = container.current;
    const collapse = () => el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    collapse();
    m.once("load", collapse);
    map.current = m;
    m.once("style.load", () => {
      m.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: geometry.lines.map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.coords } })) } as GeoJSONSourceSpecification["data"],
      });
      m.addSource("stretches", { type: "geojson", data: latest.current.data as unknown as GeoJSONSourceSpecification["data"] });
      m.addSource("labels", { type: "geojson", data: latest.current.points as GeoJSONSourceSpecification["data"] });
      m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#495057", "line-width": 2.5, "line-opacity": 0.75 } });
      m.addLayer({ id: "stretch-casing", type: "line", source: "stretches", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["match", ["get", "on"], 1, 9, 7] } });
      m.addLayer({
        id: "stretches",
        type: "line",
        source: "stretches",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "on"], 1, CHOSEN, ROUTE], "line-width": ["match", ["get", "on"], 1, 6, 4] },
      });
      m.addLayer({
        id: "label-dots",
        type: "circle",
        source: "labels",
        paint: { "circle-radius": 10, "circle-color": ["match", ["get", "on"], 1, CHOSEN, ROUTE], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      });
      m.addLayer({
        id: "label-text",
        type: "symbol",
        source: "labels",
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true, "icon-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      m.on("click", "stretches", (e) => {
        const key = e.features?.[0]?.properties?.key;
        if (typeof key === "string") latest.current.onPick(key);
      });
      m.on("mouseenter", "stretches", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "stretches", () => (m.getCanvas().style.cursor = ""));
      ready.current = true;
    });
    return () => {
      ready.current = false;
      m.remove();
      map.current = null;
    };
    // The map is created once per route; the stretches change through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => {
      (m.getSource("stretches") as GeoJSONSource | undefined)?.setData(data as unknown as GeoJSONSourceSpecification["data"] & object);
      (m.getSource("labels") as GeoJSONSource | undefined)?.setData(points as GeoJSONSourceSpecification["data"] & object);
    };
    if (ready.current) update();
    else m.once("style.load", update);
  }, [data, points]);

  useEffect(() => {
    const m = map.current;
    if (!m || !frame) return;
    const fit = () => m.fitBounds(frame, { padding: 40, maxZoom: 11, duration: 400 });
    if (ready.current) fit();
    else m.once("style.load", fit);
  }, [frame]);

  return <div className={className} ref={container} />;
}
