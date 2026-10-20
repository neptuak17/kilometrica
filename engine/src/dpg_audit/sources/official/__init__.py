"""Official place data from public bodies (D71): one pattern for every region.

Each source is an adapter with the same shape: where it applies (`area`), its licence and attribution, and a `fetch`
that downloads the whole area once, keeps it by area under raw/official/<id>/ (D25) so every route through the same
region reuses it, and returns `OfficialRecord`s. Adding a region means writing one adapter and listing it in
`SOURCES`; the services step merges whatever the sources near a route return with OSM and Overture.

A record either has a position (a recreation site, a national-park campground: a place of its own, merged with the
same place from OSM or Overture or added where they lack it) or only an `anchor` to look near (a provincial-park
campground published by name, without coordinates): then it only enriches a campsite already found there under a
matching name, typically with its season.
"""

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

from dpg_audit.models import Licence, SourceSnapshot
from dpg_audit.sources.download import file_digest

MAX_AGE_DAYS = 30
"""A source's area is fetched again after this long."""

NO_SEASON = "a" * 12
"""Month codes for an unmanaged site: no season at all, so none is ever mentioned (D71)."""


@dataclass
class OfficialRecord:
    source: str
    """The adapter's id, e.g. "bc-recsites"."""
    id: str
    name: str | None
    service: str = "accommodation"
    kind: str = "campsite"
    lon: float | None = None
    lat: float | None = None
    anchor: tuple[float, float, float] | None = None
    """For a record without a position: (lon, lat, radius in metres) to look for it by name."""
    months: str | None = None
    """12 month codes (o, p, c, ?, a) from the source's own dates; None when it publishes none."""
    label: str | None = None
    """What the rider sees beside the kind, e.g. "BC Recreation Site"."""
    operator: str | None = None
    sites: int | None = None
    detail: dict = field(default_factory=dict)


class OfficialSource(Protocol):
    id: str
    title: str
    url: str
    licence: Licence
    attribution: str
    area: tuple[float, float, float, float]
    """Where it applies: (west, south, east, north) in degrees."""

    def download(self, season_year: int, log: Callable[[str], None]) -> list[OfficialRecord]: ...


def months_from_ranges(ranges: list[tuple[date, date]], year: int) -> str:
    """Month codes from dated open periods in `year`: o for a month open throughout, p for part of it, c otherwise."""
    out = []
    for m in range(1, 13):
        first = date(year, m, 1).toordinal()
        after = (date(year + 1, 1, 1) if m == 12 else date(year, m + 1, 1)).toordinal()
        # End dates are inclusive.
        covered = sum(max(0, min(b.toordinal() + 1, after) - max(a.toordinal(), first)) for a, b in ranges)
        out.append("o" if covered >= after - first else "p" if covered > 0 else "c")
    return "".join(out)


def _cache_path(root: Path, source: OfficialSource) -> Path:
    return root / "raw" / "official" / source.id / "records.json"


def fetch(
    root: Path, source: OfficialSource, season_year: int, log: Callable[[str], None]
) -> tuple[list[OfficialRecord], SourceSnapshot]:
    """A source's records for its whole area, from the cache when it is recent enough."""
    path = _cache_path(root, source)
    age = (datetime.now(UTC) - datetime.fromtimestamp(path.stat().st_mtime, UTC)).days if path.exists() else None
    if age is not None and age < MAX_AGE_DAYS:
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = [OfficialRecord(**{**r, "anchor": tuple(r["anchor"]) if r.get("anchor") else None}) for r in raw]
    else:
        log(f"{source.title}: downloading …")
        records = source.download(season_year, log)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([asdict(r) for r in records]), encoding="utf-8")
    snap = SourceSnapshot(
        id=f"official:{source.id}",
        title=f"{source.title} ({len(records):,} records)",
        url=source.url,
        retrieved_at=datetime.fromtimestamp(path.stat().st_mtime, UTC),
        file=path.relative_to(root).as_posix(),
        sha256=file_digest(path),
        bytes=path.stat().st_size,
        licence=source.licence,
        attribution=source.attribution,
    )
    return records, snap


def near_route(
    root: Path, west: float, south: float, east: float, north: float, season_year: int, log: Callable[[str], None]
) -> tuple[list[OfficialRecord], list[SourceSnapshot]]:
    """The official records inside a route's bounding box, from every source whose area it touches."""
    from dpg_audit.sources.official.registry import SOURCES

    records: list[OfficialRecord] = []
    snaps: list[SourceSnapshot] = []
    for source in SOURCES:
        w, s, e, n = source.area
        if east < w or west > e or north < s or south > n:
            continue
        found, snap = fetch(root, source, season_year, log)
        inside = []
        for r in found:
            lon, lat = (r.lon, r.lat) if r.lon is not None else (r.anchor[0], r.anchor[1]) if r.anchor else (None, None)
            if lon is not None and west <= lon <= east and south <= lat <= north:
                inside.append(r)
        records += inside
        snaps.append(snap)
        log(f"{source.title}: {len(inside):,} near the route")
    return records, snaps
