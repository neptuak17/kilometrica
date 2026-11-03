"""Open traffic counts (D108): the source registry, downloads, and one shape for every count."""

import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

import duckdb
import yaml

from dpg_audit.rules.profile import PROFILES_DIR
from dpg_audit.sources.download import download, fetch_text

TRAFFIC_DIR = PROFILES_DIR / "traffic"


@dataclass(frozen=True)
class Count:
    source: str
    country: str
    ref: str
    """Normalised road reference, e.g. 'D10', 'N20', 'A9'."""
    aadt: float
    """Annual average daily traffic, all vehicles, both directions."""
    year: int | None
    lon: float
    lat: float
    """The count point, or the middle of a counted section."""


def load_sources(path: Path = TRAFFIC_DIR / "sources.yaml") -> dict[str, dict]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["sources"]


_REF = re.compile(r"^(?:\d{1,3}\s+)?([A-Z]{1,3})\s*-?\s*0*(\d+)\s*([A-Z]?)$")


def normalise_ref(ref: str | None) -> str | None:
    """'D 10', 'D0010', '11 D0010' (Aude's département prefix), 'N0020' -> 'D10', 'D10', 'D10', 'N20'."""
    if not ref:
        return None
    m = _REF.match(ref.strip().upper())
    return f"{m.group(1)}{int(m.group(2))}{m.group(3)}" if m else None


def osm_refs(value: str | None) -> list[str]:
    """An OSM ref tag can hold several references ('D 6113;E 80')."""
    return [r for part in (value or "").split(";") if (r := normalise_ref(part))]


def raw_dir(data_dir: Path, source_id: str) -> Path:
    return data_dir / "raw" / "traffic" / source_id


def fetch(data_dir: Path, source_id: str, cfg: dict) -> Path:
    """Download a source's file (unzipping archives); returns the file to read."""
    folder = raw_dir(data_dir, source_id)
    folder.mkdir(parents=True, exist_ok=True)
    url = cfg.get("download")
    if "datagouv" in cfg:
        meta = json.loads(fetch_text(f"https://www.data.gouv.fr/api/1/datasets/{cfg['datagouv']['dataset']}/"))
        url = next(r["url"] for r in meta["resources"] if r.get("format") == cfg["datagouv"]["format"])
    if not url:
        raise ValueError(f"{source_id}: no download")
    if url.split("?")[0].endswith(".zip"):
        archive = download(url, folder / Path(url.split("?")[0]).name, quiet=True)
        with zipfile.ZipFile(archive) as z:
            z.extractall(folder / Path(cfg["file"]).parent)
    else:
        download(url, folder / cfg["file"], quiet=True)
    return folder / cfg["file"]


def read(data_dir: Path, source_id: str, cfg: dict) -> list[Count]:
    """Every count of a source with a usable road reference and volume, in WGS84."""
    path = raw_dir(data_dir, source_id) / cfg["file"]
    f = cfg["fields"]
    con = duckdb.connect()
    con.sql("INSTALL spatial; LOAD spatial;")
    crs = cfg.get("crs", "EPSG:4326")
    point = "ST_PointOnSurface(geom)"
    if crs != "EPSG:4326":
        point = f"ST_Transform({point}, '{crs}', 'EPSG:4326', always_xy := true)"
    rows = con.sql(
        f'SELECT "{f["ref"]}", "{f["aadt"]}", "{f["year"]}", ST_X({point}), ST_Y({point}) FROM ST_Read(?)',
        params=[str(path)],
    ).fetchall()
    out = []
    for ref, aadt, year, lon, lat in rows:
        norm = normalise_ref(str(ref) if ref is not None else None)
        try:
            volume = float(aadt)
        except (TypeError, ValueError):
            continue
        if norm and volume > 0 and lon is not None:
            yr = int(float(year)) if year not in (None, "") else None
            out.append(Count(source_id, cfg["country"], norm, volume, yr, float(lon), float(lat)))
    return out


def latest_per_station(counts: list[Count]) -> list[Count]:
    """One count per place and road: the most recent (stations counted in several years appear once)."""
    best: dict[tuple, Count] = {}
    for c in counts:
        key = (c.source, c.ref, round(c.lon, 3), round(c.lat, 3))
        if key not in best or (c.year or 0) > (best[key].year or 0):
            best[key] = c
    return list(best.values())
