"""Traffic along one route (D108): the country under each kilometre, counts on the roads the route rides, the
calibrated volume bands and the legal speed limits, for the classifier."""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import yaml

from dpg_audit.lrs import RoutePath
from dpg_audit.lrs.index import RouteIndex
from dpg_audit.match.matcher import LineMatch
from dpg_audit.models import Licence, SourceSnapshot
from dpg_audit.osmdata import OsmData
from dpg_audit.services.policy import CountryLookup
from dpg_audit.sources.download import file_digest
from dpg_audit.sources.osm import geofabrik_index
from dpg_audit.traffic.calibrate import load_bands, town_distances
from dpg_audit.traffic.counts import TRAFFIC_DIR, latest_per_station, load_sources, osm_refs, raw_dir, read

COUNT_REACH_M = 150.0
"""A count applies to the route where it lies this close to it, on a road of the same reference."""
COUNT_SPAN_M = 5000.0
"""A count stands for its road this far either side along the route, the nearest count winning."""
SAMPLE_M = 1000.0
TOWN_SAMPLE_M = 250.0
FALLBACK_COUNTRY = "FR"
"""Countries with no counts of their own use this country's calibration, labelled as such (D109)."""


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
    town_m: list[float] = field(default_factory=list)
    """Distance to the nearest city or town every TOWN_SAMPLE_M along the path."""
    used_counts: set[str] = field(default_factory=set)
    """Count sources whose counts lie on the route's roads and were used."""
    used_calibrations: set[str] = field(default_factory=set)
    """Countries whose calibrated volumes were used."""
    used_legal: bool = False

    def note_use(self, detail: dict) -> None:
        """Remember what one stretch's traffic figure rests on, for the bundle's sources and credits (D110)."""
        basis = detail.get("volume_basis")
        if basis == "measured" and detail.get("volume_ref"):
            self.used_counts.add(str(detail["volume_ref"]).split(" ")[0])
        elif basis == "calibrated" and detail.get("volume_ref"):
            self.used_calibrations.add(str(detail["volume_ref"]))
        if str(detail.get("speed_source", "")).startswith("legal"):
            self.used_legal = True

    def snapshots(self, root: Path) -> list[SourceSnapshot]:
        """The traffic counts and the legal speed table the route's figures rest on, with their licences (D110)."""
        cfgs = load_sources()
        ids = set(self.used_counts)
        for country in self.used_calibrations:
            ids |= set(band_sources().get(country, []))
        out = [s for sid in sorted(ids) if sid in cfgs and (s := count_snapshot(root, sid, cfgs[sid]))]
        if self.used_legal:
            out.append(legal_snapshot())
        return out

    def town_m_at(self, m: float) -> float | None:
        if not self.town_m:
            return None
        return self.town_m[min(int(m // TOWN_SAMPLE_M), len(self.town_m) - 1)]

    def bands_for(self, country: str | None) -> tuple[dict[str, dict] | None, str | None]:
        """The calibrated bands for a country, else France's (D109): (bands, the country they come from)."""
        if country in self.bands:
            return self.bands[country], country
        if FALLBACK_COUNTRY in self.bands:
            return self.bands[FALLBACK_COUNTRY], FALLBACK_COUNTRY
        return None, None

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


LEGAL_PATH = TRAFFIC_DIR / "legal-speeds.yaml"


def load_legal(path: Path = LEGAL_PATH) -> dict[str, dict[str, int]]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["countries"]


def band_sources(path: Path = TRAFFIC_DIR / "volume-bands.yaml") -> dict[str, list[str]]:
    """country -> the count sources its calibrated volumes come from."""
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {cc: list(v.get("sources", [])) for cc, v in (raw.get("countries") or {}).items()}


def count_snapshot(root: Path, sid: str, cfg: dict) -> SourceSnapshot | None:
    """One count source as the bundle records it, or None when its file isn't on disk."""
    path = raw_dir(root, sid) / cfg["file"]
    if not path.exists():
        return None
    return SourceSnapshot(
        id=f"traffic-counts:{sid}",
        title=f"{cfg['title']} ({cfg['publisher']})",
        url=cfg.get("page"),
        retrieved_at=datetime.fromtimestamp(path.stat().st_mtime, UTC),
        file=path.relative_to(root).as_posix(),
        sha256=file_digest(path),
        bytes=path.stat().st_size,
        licence=Licence(id=cfg.get("licence_id", "unknown"), name=cfg["licence"], url=cfg.get("page")),
        attribution=cfg.get("attribution") or f"{cfg['publisher']} ({cfg['licence']})",
    )


def legal_snapshot(path: Path = LEGAL_PATH) -> SourceSnapshot:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return SourceSnapshot(
        id="legal-speed-limits",
        title="Default speed limits by country and type of road (OpenStreetMap wiki)",
        url=raw.get("source"),
        retrieved_at=datetime.fromisoformat(str(raw.get("retrieved", "2026-11-03"))).replace(tzinfo=UTC),
        file="engine/profiles/traffic/legal-speeds.yaml (in the repository)",
        sha256=file_digest(path),
        bytes=path.stat().st_size,
        licence=Licence(id="CC-BY-SA-2.0", name="Creative Commons Attribution-ShareAlike 2.0"),
        attribution="Default speed limits: OpenStreetMap wiki contributors (CC BY-SA 2.0)",
    )


def build(
    root: Path,
    path: RoutePath,
    matches: list[LineMatch],
    osm: OsmData,
    towns: list[tuple[float, float]] = (),
    log=print,
) -> TrafficContext:
    """`towns`: (lon, lat) of the cities and towns in the corridor."""
    ms = np.arange(0.0, path.length + SAMPLE_M, SAMPLE_M)
    pts = np.array([path.locate(float(min(m, path.length))) for m in ms])
    countries = CountryLookup(geofabrik_index(root)).lookup(pts[:, 0], pts[:, 1])
    tms = np.arange(0.0, path.length + TOWN_SAMPLE_M, TOWN_SAMPLE_M)
    tpts = [path.locate(float(min(m, path.length))) for m in tms]
    ctx = TrafficContext(
        countries=countries,
        bands=load_bands(),
        legal=load_legal(),
        town_m=[float(d) for d in town_distances(tpts, list(towns))],
    )

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
    # A count point, or every point along a counted section: the count stands for all of it.
    probes = [(c, p) for c in counts for p in (c.along or ((c.lon, c.lat),))]
    lon, lat = np.array([p[0] for _, p in probes]), np.array([p[1] for _, p in probes])
    near = index.within(lon, lat, COUNT_REACH_M)
    kept = [(c, p) for (c, p), ok in zip(probes, near, strict=True) if ok]
    if not kept:
        return ctx
    # Every pass of the route along the counted road (D110): an out-and-back rides it twice.
    passes = index.passes(np.array([p[0] for _, p in kept]), np.array([p[1] for _, p in kept]), COUNT_REACH_M)
    found: dict[str, list[tuple[float, Measured]]] = {}
    measured_of: dict[int, Measured] = {}
    for (c, _), pr in ((k, pr) for k, ps in zip(kept, passes, strict=True) for pr in ps):
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
            one = measured_of.setdefault(id(c), Measured(c.aadt, c.year, c.source))
            found.setdefault(c.ref, []).append((pr.m, one))
    for ref, items in found.items():
        items.sort(key=lambda t: t[0])
        ctx.anchors[ref] = ([m for m, _ in items], [x for _, x in items])
    counted = {id(x) for v in found.values() for _, x in v}
    log(f"traffic counts on this route's roads: {len(counted):,} counts on {len(found):,} roads")
    return ctx
