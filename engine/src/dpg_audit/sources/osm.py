"""OpenStreetMap data: pick Geofabrik country extracts that a corridor touches, download them, and cut the corridor.

Heavy lifting is done by `osmium-tool` (apt package `osmium-tool`), which is far faster than Python for this.
"""

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import httpx
from shapely import MultiPolygon
from shapely.geometry import shape

from dpg_audit.models import Licence, SourceSnapshot
from dpg_audit.sources.download import download, fetch_text, file_digest

GEOFABRIK_INDEX = "https://download.geofabrik.de/index-v1.json"
SOURCE_ID = "osm-geofabrik"
ODBL = Licence(id="ODbL-1.0", name="Open Database License 1.0", url="https://opendatacommons.org/licenses/odbl/1-0/")
ATTRIBUTION = "© OpenStreetMap contributors (data via Geofabrik, extract of {date})"


def osm_dir(data_dir: Path) -> Path:
    return data_dir / "raw" / "osm" / "geofabrik"


def geofabrik_index(data_dir: Path, refresh: bool = False) -> dict:
    path = osm_dir(data_dir) / "index-v1.json"
    if refresh or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fetch_text(GEOFABRIK_INDEX), encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


def country_extracts(index: dict, area: MultiPolygon) -> list[dict]:
    """Country extracts (children of a continent that carry an ISO country code) intersecting `area`.

    Composite regions such as `alps` or `dach` have no ISO code and would duplicate their countries, so they are
    skipped. Pass a narrow area around the route itself, not the whole corridor, to avoid picking up countries that
    are merely across the water (e.g. Morocco from Tarifa).
    """
    features = index["features"]
    top_level = {f["properties"]["id"] for f in features if not f["properties"].get("parent")}
    hits = []
    for f in features:
        props = f["properties"]
        is_country = props.get("parent") in top_level and props.get("iso3166-1:alpha2")
        has_data = f.get("geometry") and "pbf" in props.get("urls", {})
        if is_country and has_data and shape(f["geometry"]).intersects(area):
            hits.append(props)
    return sorted(hits, key=lambda p: p["id"])


OPEN_BORDERS = {
    "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU", "LV",
    "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "MC", "SM", "VA", "AD",
}  # fmt: skip
"""Countries whose land borders with each other are open to ride across (the Schengen area, and the microstates
inside it); the planner keeps the same list for its border checks."""

ENTERED_M = 1_000.0
"""A route enters a country when at least this much of it lies inside that country alone."""


def _iso(props: dict) -> str | None:
    iso = props.get("iso3166-1:alpha2")
    return iso[0] if isinstance(iso, list) else iso


def route_extracts(index: dict, lines: list, near: MultiPolygon, step_m: float = 500.0) -> list[dict]:
    """The smallest Geofabrik regions a route needs (D67).

    The countries near the route (`country_extracts`) are kept when the route enters them, or when their border with
    one it enters is open (Schengen): services across the Rhine from Switzerland count, but a route along the
    Canadian side of the US border needs no US data. Within each country kept, its smallest regions (provinces,
    states, Regierungsbezirke) that come near the route are taken; a country with none is taken whole."""
    import numpy as np
    import shapely

    features = [f for f in index["features"] if f.get("geometry")]
    countries = country_extracts(index, near)
    geometry = {f["properties"]["id"]: f["geometry"] for f in features}
    shapes = {c["id"]: shape(geometry[c["id"]]) for c in countries}
    lon = np.concatenate([ln.resample(step_m).lon for ln in lines])
    lat = np.concatenate([ln.resample(step_m).lat for ln in lines])
    points = shapely.points(lon, lat)
    # Extracts overlap at borders by a margin, so a point counts for the country whose outline it is deepest inside:
    # Neum's coast is Bosnian though inside Croatia's margin, the Canadian side of the 49th parallel is Canadian.
    ids = list(shapes)
    depth = np.full((len(ids), len(points)), -1.0)
    for k, cid in enumerate(ids):
        inside = shapely.contains(shapes[cid], points)
        depth[k, inside] = shapely.distance(shapes[cid].boundary, points[inside])
    owner = np.where(depth.max(axis=0) >= 0, depth.argmax(axis=0), -1)
    entered = {cid for k, cid in enumerate(ids) if (owner == k).sum() * step_m >= ENTERED_M}
    open_entered = any(_iso(c) in OPEN_BORDERS for c in countries if c["id"] in entered)
    kept = [c for c in countries if c["id"] in entered or (open_entered and _iso(c) in OPEN_BORDERS)]

    children: dict[str, list[dict]] = {}
    for f in features:
        parent = f["properties"].get("parent")
        if parent:
            children.setdefault(parent, []).append(f)

    def leaves(region_id: str) -> list[dict]:
        out = []
        for f in children.get(region_id, []):
            props = f["properties"]
            if not shape(f["geometry"]).intersects(near):
                continue
            below = leaves(props["id"])
            if below:
                out.extend(below)
            elif "pbf" in props.get("urls", {}):
                out.append(props)
        return out

    picked: list[dict] = []
    for c in kept:
        picked.extend(leaves(c["id"]) or [c])
    return sorted({p["id"]: p for p in picked}.values(), key=lambda p: p["id"])


def _osmium(*args: str) -> str:
    if not shutil.which("osmium"):
        raise RuntimeError("osmium-tool is not installed (sudo apt install osmium-tool)")
    return subprocess.run(["osmium", *args], check=True, capture_output=True, text=True).stdout


def replication_timestamp(pbf: Path) -> str | None:
    out = _osmium("fileinfo", "-g", "header.option.osmosis_replication_timestamp", str(pbf)).strip()
    return out or None


def ensure_extract(region: dict, data_dir: Path, max_age_days: int = 30) -> tuple[Path, SourceSnapshot]:
    """Download a Geofabrik extract unless a copy younger than `max_age_days` is already present."""
    url = region["urls"]["pbf"]
    target = osm_dir(data_dir) / f"{region['id']}-latest.osm.pbf"
    meta_path = target.with_suffix(".json")
    if target.exists() and meta_path.exists():
        snap = SourceSnapshot.model_validate_json(meta_path.read_text(encoding="utf-8"))
        if (datetime.now(UTC) - snap.retrieved_at).days < max_age_days:
            return target, snap
    try:
        md5: str | None = fetch_text(url + ".md5").split()[0]
    except httpx.HTTPStatusError as err:
        # Geofabrik doesn't always publish one (Germany's was missing on 2026-10-20): the length is checked instead.
        if err.response.status_code != 404:
            raise
        md5 = None
    print(f"downloading {url}", flush=True)
    download(url, target, expected_md5=md5)
    stamp = replication_timestamp(target) or datetime.now(UTC).isoformat()
    snap = SourceSnapshot(
        id=f"{SOURCE_ID}:{region['id']}",
        title=f"OpenStreetMap extract: {region['name']} (Geofabrik)",
        url=url,
        retrieved_at=datetime.now(UTC),
        file=target.relative_to(data_dir).as_posix(),
        sha256=file_digest(target),
        bytes=target.stat().st_size,
        licence=ODBL,
        attribution=ATTRIBUTION.format(date=stamp[:10]),
    )
    meta_path.write_text(snap.model_dump_json(indent=2), encoding="utf-8")
    return target, snap


def extract_corridor(extracts: list[Path], corridor_geojson: Path, out: Path) -> Path:
    """Cut every extract to the corridor and merge the pieces into one PBF."""
    out.parent.mkdir(parents=True, exist_ok=True)
    pieces = []
    for pbf in extracts:
        piece = out.parent / f"part-{pbf.name}"
        print(f"cutting {pbf.name} to corridor", flush=True)
        _osmium("extract", "--overwrite", "-s", "smart", "-p", str(corridor_geojson), str(pbf), "-o", str(piece))
        pieces.append(piece)
    print("merging corridor pieces", flush=True)
    merged = out.with_name(f"merged-{out.name}")
    _osmium("merge", "--overwrite", *map(str, pieces), "-o", str(merged))
    for piece in pieces:
        piece.unlink()
    # Neighbouring extracts overlap at borders. Downloaded on different days, they can hold two versions of the same
    # object, which later osmium steps refuse ("ID twice in input"): keep only the newest version of each.
    if _osmium("fileinfo", "-e", "-g", "data.multiple_versions", str(merged)).strip() == "yes":
        print("keeping the newest version of objects that differ between extracts", flush=True)
        _osmium("time-filter", "--overwrite", str(merged), "-o", str(out))
        merged.unlink()
    else:
        merged.replace(out)
    return out
