"""Conflate places from several sources into one record each (D16, DESIGN.md 11.2).

Two records are the same place when they have the same service type and either lie within `near_m` (150 m for
accommodation) with similar names, or within `blind_m` when either has no name. Duplicates inside one source
(e.g. a station mapped both as a node and as an area) are merged the same way.

Overture's positions can be hundreds of metres to a couple of kilometres off, so the same place to stay often turns
up twice further apart than that. Such records are also merged when their names are the same after normalising
(not merely similar, so "Athena Beach Hotel" never swallows "Athena Royal Beach Hotel"), they lie within
`SAME_NAME_M`, and at least one of them comes from Overture.
"""

import re
import unicodedata
from dataclasses import dataclass, field

import numpy as np
from rapidfuzz import fuzz
from scipy.spatial import cKDTree

from dpg_audit.lrs.index import to_laea
from dpg_audit.services.osm_places import RawPlace

NEAR_M = 75.0
NEAR_LARGE_M = 150.0
BLIND_M = 25.0
NAME_SIMILARITY = 70
LARGE = {"accommodation", "station", "hospital"}
SAME_NAME_M = 1500.0
SAME_NAME_SERVICES = {"accommodation"}
SAME_NAME_MIN_CHARS = 8
"""Names this short ("Hotel", "Camping") are too generic to merge on alone."""
OFFICIAL_M = 1500.0
OFFICIAL_SIMILARITY = 85
"""An official record (D71) is the same place as another source's within OFFICIAL_M when their names share their
words ("Thalia Lake" and "Thalia Lake Recreation Site"): official positions are often an area's centre."""
SOURCE_ORDER = {"osm": 0, "official": 1, "overture": 2}
"""Which record leads a merged place: OSM, then the official one, then Overture."""
CAMP_WORDS = re.compile(
    r"\b(campgrounds?|campsites?|camping|camp|rv park|recreation (site|area)|rec site"
    r"|provincial park|national park|park|site)\b"
)
"""Words that say a campground is one without saying which (D72): "Otter Lake Campground" is "Otter Lake Provincial
Park". Set aside only when both records are campsites, so "Camping Les Pins" never becomes "Hotel Les Pins"."""


@dataclass
class Merged:
    primary: RawPlace
    """The record that supplies position, name and tags (OSM when present)."""
    members: list[RawPlace] = field(default_factory=list)

    @property
    def sources(self) -> list[str]:
        return [f"{r.source}:{r.id}" for r in self.members]

    def has(self, source: str) -> bool:
        return any(r.source == source for r in self.members)


def norm_name(name: str | None) -> str:
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def camp_name(name: str) -> str:
    """A normalised campsite name without its generic words, or the name itself when nothing else is left."""
    core = " ".join(CAMP_WORDS.sub(" ", name).split())
    return core or name


def similar(a: RawPlace, b: RawPlace, na: str, nb: str) -> float:
    if a.kind == "campsite" and b.kind == "campsite":
        na, nb = camp_name(na), camp_name(nb)
    return fuzz.token_set_ratio(na, nb)


def same_place(a: RawPlace, b: RawPlace, dist_m: float, na: str | None = None, nb: str | None = None) -> bool:
    if a.service != b.service:
        return False
    na = norm_name(a.name) if na is None else na
    nb = norm_name(b.name) if nb is None else nb
    if not na or not nb:
        return dist_m <= BLIND_M
    limit = NEAR_LARGE_M if a.service in LARGE else NEAR_M
    return dist_m <= limit and similar(a, b, na, nb) >= NAME_SIMILARITY


def _same_name_pairs(ordered: list[RawPlace], names: list[str], x: np.ndarray, y: np.ndarray) -> list[tuple[int, int]]:
    """Records with the same normalised name within SAME_NAME_M, at least one from Overture."""
    groups: dict[str, list[int]] = {}
    for i, n in enumerate(names):
        if len(n.replace(" ", "")) >= SAME_NAME_MIN_CHARS:
            groups.setdefault(n, []).append(i)
    out = []
    for idx in groups.values():
        for a, i in enumerate(idx):
            for j in idx[a + 1 :]:
                if "overture" not in (ordered[i].source, ordered[j].source):
                    continue
                if float(np.hypot(x[i] - x[j], y[i] - y[j])) <= SAME_NAME_M:
                    out.append((i, j))
    return out


def _conflate_service(ordered: list[RawPlace], radius: float) -> list[Merged]:
    x, y = to_laea([p.lon for p in ordered], [p.lat for p in ordered])
    names = [norm_name(p.name) for p in ordered]
    tree = cKDTree(np.stack([x, y], 1))
    owner = list(range(len(ordered)))  # index of the primary each record was merged into

    def root(i: int) -> int:
        while owner[i] != i:
            i = owner[i]
        return i

    def join(i: int, j: int) -> None:
        ri, rj = root(i), root(j)
        if ri != rj:
            # The earlier record (OSM before Overture) stays the primary.
            owner[max(ri, rj)] = min(ri, rj)

    pairs = tree.query_pairs(radius, output_type="ndarray")
    if len(pairs):
        pairs = pairs[np.lexsort((pairs[:, 1], pairs[:, 0]))]
    for i, j in pairs:
        dist = float(np.hypot(x[i] - x[j], y[i] - y[j]))
        if same_place(ordered[i], ordered[j], dist, names[i], names[j]):
            join(int(i), int(j))
    if ordered and ordered[0].service in SAME_NAME_SERVICES:
        for i, j in _same_name_pairs(ordered, names, x, y):
            join(i, j)
    for i, p in enumerate(ordered):
        if p.source != "official" or not names[i]:
            continue
        for j in tree.query_ball_point([x[i], y[i]], OFFICIAL_M):
            if ordered[j].source == "official" or not names[j]:
                continue
            if similar(p, ordered[j], names[i], names[j]) >= OFFICIAL_SIMILARITY:
                join(i, int(j))

    groups: dict[int, Merged] = {}
    for i, rec in enumerate(ordered):
        r = root(i)
        groups.setdefault(r, Merged(primary=ordered[r])).members.append(rec)
    return list(groups.values())


def conflate(places: list[RawPlace]) -> list[Merged]:
    """Per service type: OSM records first, so they become the primaries; Overture records join them or stand
    alone."""
    by_service: dict[str, list[RawPlace]] = {}
    for p in places:
        by_service.setdefault(p.service, []).append(p)
    out: list[Merged] = []
    for service, group in sorted(by_service.items()):
        ordered = sorted(group, key=lambda p: (SOURCE_ORDER.get(p.source, 3), p.id))
        out.extend(_conflate_service(ordered, NEAR_LARGE_M if service in LARGE else NEAR_M))
    return out


def confidence(m: Merged) -> str:
    if m.has("official") or (m.has("osm") and m.has("overture")):
        return "high"
    if m.has("osm"):
        return "medium"
    best = max((r.confidence or 0.0) for r in m.members)
    return "medium" if best >= 0.9 else "low"
