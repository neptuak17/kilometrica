"""Turn matched pieces plus OSM tags into merged layer events on the route's measure axis."""

from collections import Counter
from dataclasses import dataclass, field

from dpg_audit.layers import classify
from dpg_audit.lrs import RoutePath
from dpg_audit.match.matcher import LineMatch
from dpg_audit.models import Event
from dpg_audit.osmdata import OsmData
from dpg_audit.traffic.counts import osm_refs

MATCHED_LAYERS = (
    "infrastructure",
    "traffic_stress",
    "surface",
    "cycle_network",
    "ecs_traffic",
    "ecs_surface",
    "ecs_continuity",
)
_CONF_RANK = {"low": 0, "medium": 1, "high": 2}
_STRUCTURE = {
    "bridge": {"yes", "viaduct", "boardwalk", "aqueduct", "cantilever", "movable", "suspension"},
    "tunnel": {"yes", "building_passage", "culvert", "avalanche_protector"},
}


@dataclass
class _Run:
    from_m: float
    to_m: float
    value: str
    confidence: str
    ways: Counter = field(default_factory=Counter)
    approx_m: float = 0.0
    detail: dict = field(default_factory=dict)
    key: tuple = ()
    """What else must match for the next piece to join this run: how the ECS traffic volume is known (D110)."""
    speeds: set = field(default_factory=set)
    """Where the speed limits in the run come from (tagged, legal, default)."""


def speed_basis(source: str) -> str:
    """Where a speed limit comes from, in one word: tagged in OSM, the country's legal limit, or our default."""
    if source.startswith("legal"):
        return "legal"
    if "default" in source:
        return "default"
    return "tagged" if source == "tagged" else source


@dataclass
class MatchedLayers:
    events: list[Event]
    structures: list[tuple[float, float]]
    """Bridges and tunnels as (from_m, to_m): the DEM is not trusted there."""
    unmatched_m: float
    approx_m: float


def build_matched_layers(
    path: RoutePath, matches: list[LineMatch], osm: OsmData, ev_number: int | None, traffic=None
) -> MatchedLayers:
    """`traffic`: a traffic.route.TrafficContext (countries, counts on the route, bands, legal speeds; D108)."""
    runs: dict[str, list[_Run]] = {layer: [] for layer in MATCHED_LAYERS}
    structures: list[tuple[float, float]] = []
    unmatched = approx = 0.0

    def push(layer: str, m0: float, m1: float, value: str, conf: str, way: int | None, is_approx: bool, detail):
        seq = runs[layer]
        last = seq[-1] if seq else None
        key = (detail.get("volume_basis"), detail.get("volume_ref")) if "volume_basis" in detail else ()
        if last and last.value == value and last.key == key and abs(last.to_m - m0) < 1e-6:
            last.to_m = m1
            last.confidence = min(last.confidence, conf, key=_CONF_RANK.__getitem__)
        else:
            last = _Run(m0, m1, value, conf, key=key)
            seq.append(last)
        if way is not None:
            last.ways[way] += m1 - m0
        if is_approx:
            last.approx_m += m1 - m0
        if detail.get("speed_source"):
            last.speeds.add(speed_basis(str(detail["speed_source"])))

    for part, match in zip(path.parts, matches, strict=True):
        for piece in match.pieces:
            m0, m1 = part.from_m + piece.from_m, part.from_m + piece.to_m
            if m1 - m0 <= 0:
                continue
            if piece.edge is None:
                unmatched += m1 - m0
                for layer in MATCHED_LAYERS:
                    push(layer, m0, m1, "unmatched", "high", None, False, {})
                continue
            way = piece.edge.get("way_id")
            tags = osm.way_tags.get(way, {})
            if piece.approx:
                approx += m1 - m0
            legal = bands = measured = town_m = origin = None
            if traffic is not None:
                mid = (m0 + m1) / 2
                country = traffic.country_at(mid)
                legal = traffic.legal.get(country)
                bands, origin = traffic.bands_for(country)
                town_m = traffic.town_m_at(mid)
                refs = osm_refs(tags.get("ref"))
                measured = traffic.measured(refs, mid) if refs else None
            lts, lts_conf, lts_detail = classify.traffic_stress(tags, piece.edge, legal)
            ecs_t = classify.ecs_traffic(tags, piece.edge, legal, bands, measured, town_m, origin)
            if traffic is not None:
                traffic.note_use(ecs_t[2])  # which counts and tables the route's figures rest on, for its credits
            values = {
                "traffic_stress": (lts, lts_conf, {}),
                "infrastructure": classify.infrastructure(tags, piece.edge, lts, ecs_t[0]),
                "surface": classify.surface(tags, piece.edge),
                "cycle_network": classify.cycle_network(osm.way_networks.get(way, set()), ev_number),
                "ecs_traffic": ecs_t,
                "ecs_surface": classify.ecs_surface(tags, piece.edge),
                "ecs_continuity": classify.ecs_continuity(tags, piece.edge),
            }
            for layer, (value, conf, detail) in values.items():
                if piece.approx:
                    conf = "low"
                push(layer, m0, m1, value, conf, way, piece.approx, detail if layer == "ecs_traffic" else {})
            if (
                tags.get("bridge") in _STRUCTURE["bridge"]
                or tags.get("tunnel") in _STRUCTURE["tunnel"]
                or (piece.edge.get("bridge") or piece.edge.get("tunnel"))
            ):
                if structures and abs(structures[-1][1] - m0) < 1e-6:
                    structures[-1] = (structures[-1][0], m1)
                else:
                    structures.append((m0, m1))

    events: list[Event] = []
    for layer, seq in runs.items():
        for r in seq:
            detail = {}
            if r.ways:
                top = [w for w, _ in r.ways.most_common(5)]
                detail["ways"] = top
                names = []
                for w in top:
                    tags = osm.way_tags.get(w, {})
                    label = tags.get("ref") or tags.get("name")
                    if label and label not in names:
                        names.append(label)
                if names:
                    detail["names"] = names[:3]
            if r.approx_m:
                detail["approx_share"] = round(r.approx_m / (r.to_m - r.from_m), 2)
            if r.key:
                # How the volume is known (D110): measured (by which count and year), calibrated (on which
                # country's counts) or estimated from the road's class; and where the speed limits come from.
                detail["volume"] = r.key[0]
                if r.key[1]:
                    detail["volume_ref"] = r.key[1]
            if r.speeds:
                detail["speed"] = sorted(r.speeds)
            events.append(
                Event(
                    layer=layer,
                    from_m=round(r.from_m, 1),
                    to_m=round(r.to_m, 1),
                    value=r.value,
                    confidence=r.confidence,
                    detail=detail,
                )
            )
    return MatchedLayers(events=events, structures=structures, unmatched_m=unmatched, approx_m=approx)
