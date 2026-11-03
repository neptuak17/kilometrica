"""Read what the audit needs from the corridor OSM extract (pyosmium; osmium-tool for pre-filtering)."""

import subprocess
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import osmium

WAY_TAG_KEYS = {
    "highway",
    "surface",
    "smoothness",
    "tracktype",
    "bicycle",
    "motor_vehicle",
    "motorcar",
    "access",
    "vehicle",
    "maxspeed",
    "lanes",
    "oneway",
    "segregated",
    "lit",
    "width",
    "bridge",
    "tunnel",
    "name",
    "ref",
    "route",
    "foot",
    "service",
    "junction",
    "sac_scale",
    "mtb:scale",
    "incline",
    "cyclestreet",
    "bicycle_road",
    "shoulder",
    "shoulder:width",
    "ramp:bicycle",
}
"""Way tags kept for classification. Any key starting with `cycleway` is kept as well."""


@dataclass
class RouteRelation:
    id: int
    network: str | None
    ref: str | None
    name: str | None
    ways: list[int] = field(default_factory=list)
    children: list[int] = field(default_factory=list)


@dataclass
class OsmData:
    way_tags: dict[int, dict[str, str]]
    way_networks: dict[int, set[tuple[str, str]]]
    """way id -> {(network, ref)} of every bicycle route relation (incl. parents) the way belongs to."""
    ferries: list[dict]
    """route=ferry ways: {id, name, coords:[(lon,lat)...]}"""
    stations: list[dict]
    """rail stations and halts: {id, name, lon, lat}"""
    barriers: list[dict] = field(default_factory=list)
    """barrier nodes on matched ways: {id, barrier, lon, lat, tags} (ECS continuity, D106)"""
    rest_areas: list[dict] = field(default_factory=list)
    """complete rest areas (table, benches and shelter): {id, lon, lat} (ECS services, D106)"""
    charging: list[dict] = field(default_factory=list)
    """e-bike charging stations: {id, lon, lat} (ECS services, D106)"""


def _keep_tags(tags) -> dict[str, str]:
    return {t.k: t.v for t in tags if t.k in WAY_TAG_KEYS or t.k.startswith("cycleway")}


def read_ways_and_routes(
    pbf: Path, way_ids: set[int], way_nodes: set[int] | None = None
) -> tuple[dict[int, dict[str, str]], dict[int, RouteRelation]]:
    """`way_nodes`, if given, collects the node ids of the matched ways."""
    tags: dict[int, dict[str, str]] = {}
    routes: dict[int, RouteRelation] = {}
    for obj in osmium.FileProcessor(str(pbf), osmium.osm.WAY | osmium.osm.RELATION):
        if obj.is_way():
            if obj.id in way_ids:
                tags[obj.id] = _keep_tags(obj.tags)
                if way_nodes is not None:
                    way_nodes.update(n.ref for n in obj.nodes)
        elif obj.tags.get("route") in ("bicycle", "mtb") or obj.tags.get("type") == "superroute":
            if obj.tags.get("route", "bicycle") == "mtb":
                continue
            rel = RouteRelation(obj.id, obj.tags.get("network"), obj.tags.get("ref"), obj.tags.get("name"))
            for m in obj.members:
                if m.type == "w":
                    rel.ways.append(m.ref)
                elif m.type == "r":
                    rel.children.append(m.ref)
            routes[obj.id] = rel
    return tags, routes


def way_networks(routes: dict[int, RouteRelation]) -> dict[int, set[tuple[str, str]]]:
    """Propagate each relation's (network, ref) down to the ways of it and all its member relations."""
    out: dict[int, set[tuple[str, str]]] = defaultdict(set)
    for rel in routes.values():
        label = (rel.network or "", rel.ref or rel.name or "")
        seen: set[int] = set()
        stack = [rel.id]
        while stack:
            rid = stack.pop()
            if rid in seen or rid not in routes:
                continue
            seen.add(rid)
            child = routes[rid]
            for w in child.ways:
                out[w].add(label)
            stack.extend(child.children)
    return out


def read_transport(pbf: Path, work: Path) -> tuple[list[dict], list[dict]]:
    """Ferry routes and rail stations, via a small pre-filtered file read with node locations."""
    small = work / "transport.osm.pbf"
    subprocess.run(
        [
            "osmium",
            "tags-filter",
            "--overwrite",
            str(pbf),
            "w/route=ferry",
            "n/railway=station,halt",
            "n/public_transport=station",
            "-o",
            str(small),
        ],
        check=True,
        capture_output=True,
    )
    ferries, stations = [], []
    for obj in osmium.FileProcessor(str(small)).with_locations():
        if obj.is_way() and obj.tags.get("route") == "ferry":
            coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if len(coords) >= 2:
                ferries.append({"id": obj.id, "name": obj.tags.get("name"), "coords": coords})
        elif obj.is_node() and (obj.tags.get("railway") in ("station", "halt") or obj.tags.get("train") == "yes"):
            stations.append({"id": obj.id, "name": obj.tags.get("name"), "lon": obj.lon, "lat": obj.lat})
    return ferries, stations


BARRIER_TAG_KEYS = ("barrier", "access", "bicycle", "foot", "maxwidth", "maxwidth:physical", "width", "opening")


def _is_rest_area(tags) -> bool:
    """A complete ECS rest area: table, benches and shelter (2026 manual 2.4.2)."""
    amenity, leisure = tags.get("amenity"), tags.get("leisure")
    if amenity == "shelter":
        kind = tags.get("shelter_type")
        return kind == "picnic_shelter" or (tags.get("bench") == "yes" and tags.get("table") == "yes")
    if leisure == "picnic_site":
        return tags.get("shelter") == "yes" or tags.get("covered") == "yes"
    return False


def read_ecs_points(pbf: Path, work: Path, way_nodes: set[int]) -> tuple[list[dict], list[dict], list[dict]]:
    """Barrier nodes on the matched ways, complete rest areas and e-bike charging, via a small pre-filtered file."""
    small = work / "ecs.osm.pbf"
    subprocess.run(
        [
            "osmium",
            "tags-filter",
            "--overwrite",
            str(pbf),
            "n/barrier",
            "nwr/amenity=shelter,charging_station",
            "nwr/leisure=picnic_site",
            "-o",
            str(small),
        ],
        check=True,
        capture_output=True,
    )
    barriers, rest, charging = [], [], []
    for obj in osmium.FileProcessor(str(small)).with_locations():
        tags = obj.tags
        if obj.is_node():
            lon, lat = (obj.lon, obj.lat) if obj.location.valid() else (None, None)
        elif obj.is_way():
            pts = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            lon, lat = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else (None, None)
        else:
            continue
        if lon is None:
            continue
        if obj.is_node() and "barrier" in tags and obj.id in way_nodes:
            kept = {k: tags.get(k) for k in BARRIER_TAG_KEYS if tags.get(k)}
            barriers.append({"id": obj.id, "barrier": tags.get("barrier"), "lon": lon, "lat": lat, "tags": kept})
        if _is_rest_area(tags):
            rest.append({"id": f"{'n' if obj.is_node() else 'w'}{obj.id}", "lon": lon, "lat": lat})
        if tags.get("amenity") == "charging_station" and tags.get("bicycle") in ("yes", "designated"):
            charging.append({"id": f"{'n' if obj.is_node() else 'w'}{obj.id}", "lon": lon, "lat": lat})
    return barriers, rest, charging


def load(pbf: Path, way_ids: set[int], work: Path) -> OsmData:
    nodes: set[int] = set()
    tags, routes = read_ways_and_routes(pbf, way_ids, nodes)
    ferries, stations = read_transport(pbf, work)
    barriers, rest, charging = read_ecs_points(pbf, work, nodes)
    return OsmData(
        way_tags=tags,
        way_networks=way_networks(routes),
        ferries=ferries,
        stations=stations,
        barriers=barriers,
        rest_areas=rest,
        charging=charging,
    )
