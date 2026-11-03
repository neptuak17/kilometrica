"""Calibrate traffic volume by road class from open counts (D108, question 153).

Each count is matched to the nearest OSM road carrying the same reference (within 150 m), which gives its road class.
Per country and class, the counts' median volume sets the ECS volume band used where a road has no count of its own.
The table is written to engine/profiles/traffic/volume-bands.yaml, with how many counts stand behind each band.
"""

import hashlib
import statistics
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import osmium
import shapely
import yaml

from dpg_audit.layers.classify import ROAD_CLASSES, VOLUME_BANDS, band_of
from dpg_audit.lrs.index import to_laea
from dpg_audit.sources.osm import osm_dir
from dpg_audit.traffic.counts import TRAFFIC_DIR, Count, latest_per_station, load_sources, osm_refs, read

MATCH_M = 150.0
MIN_COUNTS = 10
"""A class needs this many counts in a country before its band replaces the estimate."""


@dataclass
class RefWay:
    id: int
    cls: str
    refs: list[str]
    maxspeed: str | None
    geom: shapely.LineString
    """In the LAEA projection (metres)."""


def _extract(country_pbf: Path, bbox: tuple[float, float, float, float], work: Path) -> Path:
    """The country extract cut to the counts' box, keeping roads with a reference."""
    key = hashlib.sha256(f"{country_pbf.name}{bbox}".encode()).hexdigest()[:10]
    out = work / f"ref-roads-{key}.osm.pbf"
    if out.exists() and out.stat().st_mtime >= country_pbf.stat().st_mtime:
        return out
    work.mkdir(parents=True, exist_ok=True)
    cut = work / f"cut-{key}.osm.pbf"
    b = ",".join(f"{v:.4f}" for v in bbox)
    subprocess.run(["osmium", "extract", "--overwrite", "-b", b, str(country_pbf), "-o", str(cut)], check=True)
    subprocess.run(["osmium", "tags-filter", "--overwrite", str(cut), "w/ref", "-o", str(out)], check=True)
    cut.unlink()
    return out


def read_ref_ways(pbf: Path) -> list[RefWay]:
    ways = []
    for obj in osmium.FileProcessor(str(pbf)).with_locations():
        if not obj.is_way():
            continue
        hw = obj.tags.get("highway", "")
        if hw not in ROAD_CLASSES:
            continue
        refs = osm_refs(obj.tags.get("ref"))
        coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
        if not refs or len(coords) < 2:
            continue
        x, y = to_laea(np.array([c[0] for c in coords]), np.array([c[1] for c in coords]))
        ways.append(RefWay(obj.id, hw.removesuffix("_link"), refs, obj.tags.get("maxspeed"), shapely.linestrings(x, y)))
    return ways


def match(counts: list[Count], ways: list[RefWay]) -> list[tuple[Count, RefWay]]:
    """Each count with the nearest road of the same reference within MATCH_M, if any."""
    if not ways or not counts:
        return []
    tree = shapely.STRtree([w.geom for w in ways])
    x, y = to_laea(np.array([c.lon for c in counts]), np.array([c.lat for c in counts]))
    pts = shapely.points(x, y)
    ci_idx, wi_idx = tree.query(pts, predicate="dwithin", distance=MATCH_M)
    best: dict[int, tuple[float, int]] = {}
    for ci, wi in zip(ci_idx, wi_idx, strict=True):
        if counts[ci].ref not in ways[wi].refs:
            continue
        d = float(shapely.distance(pts[ci], ways[wi].geom))
        if ci not in best or d < best[ci][0]:
            best[ci] = (d, int(wi))
    return [(counts[ci], ways[wi]) for ci, (_, wi) in sorted(best.items())]


def country_extract(data_dir: Path, country: str) -> Path:
    files = {"FR": "france-latest.osm.pbf", "SI": "slovenia-latest.osm.pbf", "IT": "italy-latest.osm.pbf"}
    path = osm_dir(data_dir) / files.get(country, "")
    if country not in files or not path.exists():
        raise FileNotFoundError(f"no OSM extract on disk for {country}")
    return path


def calibrate(data_dir: Path, log=print) -> dict:
    """Read every source, match its counts to OSM roads, and summarise volume by country and class."""
    by_country: dict[str, list[Count]] = {}
    sources = load_sources()
    for sid, cfg in sources.items():
        counts = latest_per_station(read(data_dir, sid, cfg))
        log(f"{sid}: {len(counts):,} counting places with a road reference")
        by_country.setdefault(cfg["country"], []).extend(counts)
    table: dict = {}
    for country, counts in sorted(by_country.items()):
        lons, lats = [c.lon for c in counts], [c.lat for c in counts]
        bbox = (min(lons) - 0.02, min(lats) - 0.02, max(lons) + 0.02, max(lats) + 0.02)
        pbf = _extract(country_extract(data_dir, country), bbox, data_dir / "work" / "traffic")
        ways = read_ref_ways(pbf)
        matched = match(counts, ways)
        log(f"{country}: {len(matched):,} of {len(counts):,} counts matched to an OSM road of the same reference")
        classes: dict[str, list[float]] = {}
        for c, w in matched:
            classes.setdefault(w.cls, []).append(c.aadt)
        rows = {}
        for cls, vols in sorted(classes.items(), key=lambda kv: -len(kv[1])):
            q = statistics.quantiles(vols, n=4) if len(vols) >= 4 else [min(vols), statistics.median(vols), max(vols)]
            med = statistics.median(vols)
            rows[cls] = {
                "counts": len(vols),
                "p25": round(q[0]),
                "median": round(med),
                "p75": round(q[2]),
                "band": band_of(med),
                "band_label": VOLUME_BANDS[band_of(med)],
                "used": len(vols) >= MIN_COUNTS,
            }
        table[country] = {
            "sources": sorted({c.source for c in counts}),
            "years": [min(c.year or 0 for c in counts), max(c.year or 0 for c in counts)],
            "classes": rows,
        }
    return table


def write(table: dict, path: Path = TRAFFIC_DIR / "volume-bands.yaml") -> Path:
    header = (
        "# Traffic volume by road class, calibrated on open counts (D108, question 153). Generated by\n"
        "# `dpg traffic-calibrate`; do not edit by hand. Per country and OSM road class: how many counts, their\n"
        "# quartiles (vehicles a day) and the ECS volume band of the median, used where a road has no count of its\n"
        f"# own when `used` (at least {MIN_COUNTS} counts). Sources and licences: sources.yaml.\n"
    )
    doc = {"generated": date.today().isoformat(), "countries": table}
    body = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)
    path.write_text(header + body, encoding="utf-8")
    return path


def load_bands(path: Path = TRAFFIC_DIR / "volume-bands.yaml") -> dict[str, dict[str, dict]]:
    """country -> class -> {band, counts, ...} for the classes with enough counts."""
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {
        cc: {cls: row for cls, row in v.get("classes", {}).items() if row.get("used")}
        for cc, v in (raw.get("countries") or {}).items()
    }
