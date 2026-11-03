"""Traffic along one route (D108): the country under each kilometre, counts on the roads the route rides, the
calibrated volume bands and the legal speed limits, for the classifier."""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

from dpg_audit.lrs import RoutePath
from dpg_audit.lrs.index import RouteIndex
from dpg_audit.match.matcher import LineMatch
from dpg_audit.osmdata import OsmData
from dpg_audit.services.policy import CountryLookup
from dpg_audit.sources.osm import geofabrik_index
from dpg_audit.traffic.calibrate import load_bands
from dpg_audit.traffic.counts import TRAFFIC_DIR, latest_per_station, load_sources, osm_refs, raw_dir, read

COUNT_REACH_M = 150.0
"""A count applies to the route where it lies this close to it, on a road of the same reference."""
COUNT_SPAN_M = 5000.0
"""A count stands for its road this far either side along the route, the nearest count winning."""
SAMPLE_M = 1000.0


@dataclass(frozen=True)
class Measured:
    aadt: float
    year: int | None
    source: str


@dataclass
class TrafficContext:
    countries: list[str | None] = field(default_factory=list)
    """Country every SAMPLE_M along the path."""
    anchors: dict[str, tuple[list[float], list[Measured]]] = field(default_factory=dict)
    """Road reference -> (measures, counts) of the counts on this route's roads."""
    bands: dict[str, dict[str, dict]] = field(default_factory=dict)
    legal: dict[str, dict[str, int]] = field(default_factory=dict)

    def country_at(self, m: float) -> str | None:
        if not self.countries:
            return None
        return self.countries[min(int(m // SAMPLE_M), len(self.countries) - 1)]

    def measured(self, refs: list[str], m: float) -> Measured | None:
        best: tuple[float, Measured] | None = None
        for ref in refs:
            ms, counts = self.anchors.get(ref, ([], []))
            lo, hi = bisect_left(ms, m - COUNT_SPAN_M), bisect_right(ms, m + COUNT_SPAN_M)
            for i in range(lo, hi):
                d = abs(ms[i] - m)
                if best is None or d < best[0]:
                    best = (d, counts[i])
        return best[1] if best else None


def load_legal(path: Path = TRAFFIC_DIR / "legal-speeds.yaml") -> dict[str, dict[str, int]]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["countries"]


def build(root: Path, path: RoutePath, matches: list[LineMatch], osm: OsmData, log=print) -> TrafficContext:
    ms = np.arange(0.0, path.length + SAMPLE_M, SAMPLE_M)
    pts = np.array([path.locate(float(min(m, path.length))) for m in ms])
    countries = CountryLookup(geofabrik_index(root)).lookup(pts[:, 0], pts[:, 1])
    ctx = TrafficContext(countries=countries, bands=load_bands(), legal=load_legal())

    # The route's roads by measure, with their references, to check a count lies on the road the route rides.
    pieces: list[tuple[float, float, list[str]]] = []
    for part, match in zip(path.parts, matches, strict=True):
        for piece in match.pieces:
            if piece.edge and (refs := osm_refs(osm.way_tags.get(piece.edge.get("way_id"), {}).get("ref"))):
                pieces.append((part.from_m + piece.from_m, part.from_m + piece.to_m, refs))
    starts = [p[0] for p in pieces]
    counts = []
    for sid, cfg in load_sources().items():
        if (raw_dir(root, sid) / cfg["file"]).exists():
            counts += latest_per_station(read(root, sid, cfg))
    if not counts or not pieces:
        return ctx
    index = RouteIndex(path)
    lon, lat = np.array([c.lon for c in counts]), np.array([c.lat for c in counts])
    near = index.within(lon, lat, COUNT_REACH_M)
    kept = [c for c, ok in zip(counts, near, strict=True) if ok]
    if not kept:
        return ctx
    projections = index.project(np.array([c.lon for c in kept]), np.array([c.lat for c in kept]))
    found: dict[str, list[tuple[float, Measured]]] = {}
    for c, pr in zip(kept, projections, strict=True):
        if pr.offset_m > COUNT_REACH_M:
            continue
        i = max(bisect_right(starts, pr.m - 200.0) - 1, 0)
        on_road = False
        while i < len(pieces) and pieces[i][0] <= pr.m + 200.0:
            if c.ref in pieces[i][2] and pieces[i][1] >= pr.m - 200.0:
                on_road = True
                break
            i += 1
        if on_road:
            found.setdefault(c.ref, []).append((pr.m, Measured(c.aadt, c.year, c.source)))
    for ref, items in found.items():
        items.sort(key=lambda t: t[0])
        ctx.anchors[ref] = ([m for m, _ in items], [x for _, x in items])
    log(f"traffic counts on this route's roads: {sum(len(v) for v in found.values()):,} on {len(found):,} roads")
    return ctx
