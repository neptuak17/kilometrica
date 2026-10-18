/**
 * Dream's map (11.7): the whole route in grey, the stretches that fit on top, the chosen one in orange. Clicking a
 * stretch chooses it. MapLibre with the OpenFreeMap basemap, as in Plan.
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
type FC = { type: "FeatureCollection"; features: { properties: { key: string }; geometry: { coordinates: [number, number][] } }[] };

export interface MapStretch {
  key: string;
  fromM: number;
  toM: number;
  /** Chosen, or one of the two compared. */
  on: boolean;
}

interface Props {
  geometry: Geometry;
  stretches: MapStretch[];
  /** The stretch to frame; null frames them all. */
  focus: string | null;
  onPick: (key: string) => void;
  attribution: string[];
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

export function DreamMap({ geometry, stretches, focus, onPick, attribution }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const data = useMemo(() => features(geometry, stretches), [geometry, stretches]);
  const frame = useMemo(() => {
    const picked = data.features.filter((f) => focus === null || f.properties.key === focus).map((f) => f.geometry.coordinates);
    return boundsOf(picked) ?? boundsOf(geometry.lines.map((l) => l.coords));
  }, [data, focus, geometry]);
  const latest = useRef({ data, frame, onPick });
  latest.current = { data, frame, onPick };

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
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#adb5bd", "line-width": 2 } });
      m.addLayer({ id: "stretch-casing", type: "line", source: "stretches", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["match", ["get", "on"], 1, 9, 7] } });
      m.addLayer({
        id: "stretches",
        type: "line",
        source: "stretches",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "on"], 1, "#f08c00", "#1c7ed6"], "line-width": ["match", ["get", "on"], 1, 6, 4] },
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
      if (frame) m.fitBounds(frame, { padding: 40, maxZoom: 11, duration: 400 });
    };
    if (ready.current) update();
    else m.once("style.load", update);
  }, [data, frame]);

  return <div className="dream-map" ref={container} />;
}
