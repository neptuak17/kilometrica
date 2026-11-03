"""Classify one matched way (OSM tags + Valhalla edge attributes) into the audit's layer values.

These rules are version 0 heuristics, deliberately simple and readable so they can be tuned against field checks.
Every function returns (value, confidence, detail).
"""

import re
from typing import Any

from dpg_audit.models import LayerInfo, LayerValue

Result = tuple[str, str, dict[str, Any]]

CAR_FREE = {"cycleway", "path", "footway", "pedestrian", "bridleway", "steps", "corridor"}
NO_MOTOR = {"no", "private", "agricultural", "forestry", "destination;agricultural", "permit", "delivery"}
ROAD_CLASSES = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "track",
    "road",
}

# Default speed (km/h) when maxspeed is missing, by highway class. Rural values on purpose: most of EV8 is rural,
# and assuming the faster limit errs towards flagging traffic stress rather than hiding it.
DEFAULT_SPEED = {
    "motorway": 120,
    "trunk": 100,
    "primary": 90,
    "secondary": 90,
    "tertiary": 70,
    "unclassified": 60,
    "residential": 50,
    "living_street": 20,
    "service": 30,
    "track": 30,
    "road": 50,
}
URBAN_DENSITY = 8
"""Valhalla edge density (0-15) from which an untagged road is treated as urban."""
URBAN_SPEED = 50
URBAN_DEFAULT_CLASSES = {"primary", "secondary", "tertiary", "unclassified", "residential", "road"}
_ZONE_SPEED = {
    "urban": 50,
    "rural": 90,
    "zone30": 30,
    "zone:30": 30,
    "living_street": 20,
    "walk": 10,
    "trunk": 100,
    "motorway": 120,
}


def _highway(tags: dict[str, str]) -> str:
    return tags.get("highway", "")


def _base_class(hw: str) -> str:
    return hw.removesuffix("_link")


def parse_maxspeed(value: str | None) -> int | None:
    """'50' -> 50, '30 mph' -> 48, 'FR:urban' -> 50, 'none'/'signals' -> None."""
    if not value:
        return None
    v = value.strip().lower()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(mph)?", v)
    if m:
        speed = float(m.group(1))
        return round(speed * 1.609) if m.group(2) else round(speed)
    if ":" in v:
        return _ZONE_SPEED.get(v.split(":", 1)[1])
    return None


def _cycleway_values(tags: dict[str, str]) -> set[str]:
    return {v for k, v in tags.items() if k in ("cycleway", "cycleway:both", "cycleway:right", "cycleway:left")}


def _motor_allowed(tags: dict[str, str]) -> bool:
    return all(tags.get(key) not in NO_MOTOR for key in ("motor_vehicle", "motorcar", "vehicle", "access"))


def speed_limit(tags: dict[str, str], edge: dict[str, Any], legal: dict[str, int] | None = None):
    """(km/h, source): the tagged limit, else the country's legal limit for the type of road (D108), else the
    earlier estimates. Untagged roads in built-up areas (Valhalla road density) take the urban limit."""
    tagged = parse_maxspeed(tags.get("maxspeed"))
    if tagged:
        return tagged, "tagged"
    cls = _base_class(_highway(tags))
    urban = (edge.get("density") or 0) >= URBAN_DENSITY
    if legal:
        kind = None
        if cls == "living_street":
            kind = "living_street"
        elif cls == "motorway":
            kind = "motorway"
        elif cls == "trunk" and tags.get("oneway") in ("yes", "-1"):
            kind = "dual"
        elif cls == "residential" or (urban and cls in URBAN_DEFAULT_CLASSES):
            kind = "urban"
        elif cls in ("trunk", "primary", "secondary", "tertiary", "unclassified", "road"):
            kind = "rural"
        if kind == "dual" and "dual" not in legal:
            kind = "rural"
        if kind and legal.get(kind) is not None:
            return legal[kind], f"legal {kind}"
    default = URBAN_SPEED if urban and cls in URBAN_DEFAULT_CLASSES else DEFAULT_SPEED.get(cls)
    return default, ("urban default" if urban and default == URBAN_SPEED else "default")


def traffic_stress(tags: dict[str, str], edge: dict[str, Any], legal: dict[str, int] | None = None) -> Result:
    """Level of Traffic Stress, 1 (anyone) .. 4 (strong and fearless only); 'na' for ferries; 'unknown'.
    Kept for the audit viewer; riders' "busy" follows the ECS categories (D108)."""
    hw = _highway(tags)
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "na", "high", {"reason": "ferry"}
    if not hw:
        return "unknown", "low", {}
    cls = _base_class(hw)
    if hw in CAR_FREE:
        return "1", "high", {"reason": "car-free path"}
    if cls == "track" and not _motor_allowed(tags):
        return "1", "high", {"reason": "track closed to motor traffic"}
    cyc = _cycleway_values(tags)
    if cyc & {"track", "separate"} or edge.get("cycle_lane") == "separated":
        return "1", "medium", {"reason": "separated cycle track"}
    if cls == "living_street" or tags.get("bicycle_road") == "yes" or tags.get("cyclestreet") == "yes":
        return "1", "high", {"reason": "living street / cycle street"}
    speed, source = speed_limit(tags, edge, legal)
    if speed is None:
        return "unknown", "low", {}
    try:
        lanes = int(tags.get("lanes", "0").split(";")[0]) or None
    except ValueError:
        lanes = None
    painted = bool(cyc & {"lane", "opposite_lane"}) or edge.get("cycle_lane") == "dedicated"
    # A paved shoulder gives riders space on fast rural roads (Valhalla flag, or the OSM shoulder tag).
    shoulder = bool(edge.get("shoulder")) or tags.get("shoulder") in ("yes", "both", "left", "right")
    detail = {"speed": speed, "speed_source": source, "lanes": lanes, "lane": painted, "shoulder": shoulder}
    conf = "medium" if source == "tagged" else "low"

    if cls in ("motorway", "trunk") or ((lanes or 0) >= 4 and speed >= 50):
        lts = 4
    elif cls in ("residential", "service", "unclassified", "track", "road"):
        if speed <= 30:
            lts = 1
        elif speed <= 50:
            lts = 2
        elif cls in ("unclassified", "track"):
            lts = 2 if speed <= 60 else 3  # minor rural roads: usually light traffic, but fast
        else:
            lts = 3
    elif cls == "tertiary":
        if speed <= 30:
            lts = 2
        elif speed <= 50:
            lts = 2 if painted else 3
        else:
            lts = 3
    elif cls == "secondary":
        lts = 3 if speed <= 50 or ((painted or shoulder) and speed <= 90) else 4
    elif cls == "primary":
        # Main roads through towns at 50 km/h or less are LTS 3 in mixed traffic (2 with a cycle lane); out of
        # town they are LTS 4 unless a shoulder or lane gives space at moderate speed.
        if speed <= 50:
            lts = 2 if painted and speed <= 30 else 3
        else:
            lts = 3 if (shoulder and speed <= 70) or (painted and speed <= 60) else 4
    else:
        return "unknown", "low", detail
    return str(lts), conf, detail


QUIET, BUSY = {"traffic_free", "very_low", "low"}, {"high", "very_high"}
"""ECS traffic categories that make a road quiet, or busy, for riders and ECF alike (D108)."""


def infrastructure(tags: dict[str, str], edge: dict[str, Any], lts: str, ecs: str | None = None) -> Result:
    """What the rider rides on. A road is quiet, a road with traffic, or busy by its ECS traffic category (D108),
    by traffic stress where that is unknown."""
    hw = _highway(tags)
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "ferry", "high", {}
    if hw == "steps":
        return "steps", "high", {}
    if hw == "cycleway" or (hw == "path" and tags.get("bicycle") == "designated"):
        return "cycleway", "high", {}
    if hw in CAR_FREE or (_base_class(hw) == "track" and not _motor_allowed(tags)):
        return "shared_path", "high", {"highway": hw}
    if _cycleway_values(tags) & {"track", "separate"} or edge.get("cycle_lane") == "separated":
        return "separated_track", "medium", {"highway": hw}
    if _cycleway_values(tags) & {"lane", "opposite_lane"} or edge.get("cycle_lane") == "dedicated":
        return "cycle_lane", "medium", {"highway": hw}
    if hw in ROAD_CLASSES:
        if ecs in ECS_TRAFFIC:
            value = "quiet_road" if ecs in QUIET else "busy_road" if ecs in BUSY else "road"
        else:
            value = {"1": "quiet_road", "2": "quiet_road", "3": "road", "4": "busy_road"}.get(lts, "road")
        return value, "medium", {"highway": hw}
    return "unknown", "low", {"highway": hw}


_SURFACE = {
    "paved_smooth": {"asphalt", "concrete", "concrete:lanes", "chipseal", "paved", "metal", "tartan"},
    "paved_rough": {
        "paving_stones",
        "sett",
        "cobblestone",
        "unhewn_cobblestone",
        "concrete:plates",
        "bricks",
        "grass_paver",
        "paving_stones:30",
    },
    "compacted": {"compacted", "fine_gravel"},
    "gravel": {"gravel", "pebblestone", "rock", "unpaved", "shells"},
    "dirt": {"dirt", "earth", "ground", "mud", "sand", "grass", "woodchips", "soil"},
}
_SURFACE_OF = {tag: cls for cls, tags in _SURFACE.items() for tag in tags}
_ROUGH_SMOOTHNESS = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
_TRACKTYPE = {"grade1": "paved_smooth", "grade2": "compacted", "grade3": "gravel", "grade4": "dirt", "grade5": "dirt"}
_LIKELY_PAVED = {
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "cycleway",
}


def surface(tags: dict[str, str], edge: dict[str, Any]) -> Result:
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "na", "high", {}
    raw = tags.get("surface", "").split(";")[0].strip()
    smooth = tags.get("smoothness")
    if raw in _SURFACE_OF:
        value = _SURFACE_OF[raw]
        if value == "paved_smooth" and smooth in _ROUGH_SMOOTHNESS:
            value = "paved_rough"
        return value, "high", {"surface": raw, "smoothness": smooth}
    if tags.get("tracktype") in _TRACKTYPE:
        return _TRACKTYPE[tags["tracktype"]], "medium", {"tracktype": tags["tracktype"]}
    if _base_class(_highway(tags)) in _LIKELY_PAVED:
        return "paved_assumed", "low", {"highway": _highway(tags)}
    return "unknown", "low", {"highway": _highway(tags), "surface": raw or None}


# --- ECS layers (D106): the 2026 European Certification Standard's own classes, for the ECS rules only ---------

ECS_TRAFFIC = ("traffic_free", "very_low", "low", "moderate", "high", "very_high")
VOLUME_BANDS = ("1-500", "501-2,000", "2,001-4,000", "4,001-10,000", ">10,000")
# Vehicles a day by road class, as a band of the ECS tables. An estimate (D106, question 143): open traffic counts
# cover only some main roads, so the class stands in for the count until measured counts are added.
VOLUME_BAND_OF_CLASS = {
    "motorway": 4,
    "trunk": 4,
    "primary": 3,
    "secondary": 2,
    "tertiary": 1,
    "road": 1,
    "unclassified": 0,
    "residential": 0,
    "living_street": 0,
    "service": 0,
    "track": 0,
}
# ECS 2026 tables 1 and 2: traffic category by volume band (rows) and speed column (<=30, 31-50, 51-79, >=80 km/h).
_MIXED = (
    ("very_low", "very_low", "very_low", "low"),
    ("very_low", "low", "low", "moderate"),
    ("low", "moderate", "moderate", "high"),
    ("moderate", "high", "high", "very_high"),
    ("moderate", "very_high", "very_high", "very_high"),
)
_LANES = (
    ("very_low", "very_low", "very_low", "low"),
    ("very_low", "very_low", "low", "low"),
    ("very_low", "very_low", "low", "moderate"),
    ("very_low", "low", "moderate", "high"),
    ("low", "moderate", "high", "very_high"),
)
_LANE_MIN_WIDTH = (1.5, 1.5, 2.0, 2.0)


def _speed_column(speed: int) -> int:
    return 0 if speed <= 30 else 1 if speed <= 50 else 2 if speed < 80 else 3


def _width(value: str | None) -> float | None:
    if not value:
        return None
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(m)?\s*$", value)
    return float(m.group(1).replace(",", ".")) if m else None


def _lane_width(tags: dict[str, str]) -> float | None:
    keys = ("cycleway:width", "cycleway:right:width", "cycleway:both:width", "cycleway:left:width", "shoulder:width")
    widths = [w for k in keys if (w := _width(tags.get(k))) is not None]
    return max(widths) if widths else None


BAND_EDGES = (500, 2000, 4000, 10000)
"""Upper edges of the ECS volume bands (vehicles a day)."""


def band_of(aadt: float) -> int:
    return sum(aadt > edge for edge in BAND_EDGES)


TOWN_DISTANCE = ((2000.0, "0-2 km"), (5000.0, "2-5 km"), (10000.0, "5-10 km"), (float("inf"), "over 10 km"))
"""Distance from the nearest city or town, in the bands the volume is calibrated on (D109)."""


def town_band(metres: float) -> str:
    return next(label for edge, label in TOWN_DISTANCE if metres < edge)


def ecs_traffic(
    tags: dict[str, str],
    edge: dict[str, Any],
    legal: dict[str, int] | None = None,
    bands: dict[str, dict] | None = None,
    measured: Any = None,
    town_m: float | None = None,
    origin: str | None = None,
) -> Result:
    """The ECS traffic category: traffic-free, or very low .. very high from the speed limit and the volume band.
    The volume is measured where a count lies on the road (`measured`: aadt, year, source), else the band of the
    road's class and distance from the nearest town (`town_m`), calibrated on counts (`bands`, from `origin`, the
    country the counts come from), else the earlier estimate (D108, D109)."""
    hw = _highway(tags)
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "na", "high", {"reason": "ferry"}
    if not hw:
        return "unknown", "low", {}
    cls = _base_class(hw)
    if hw in CAR_FREE or (cls == "track" and not _motor_allowed(tags)):
        return "traffic_free", "high", {"reason": "car-free"}
    cyc = _cycleway_values(tags)
    if cyc & {"track", "separate"} or edge.get("cycle_lane") == "separated":
        return "traffic_free", "medium", {"reason": "separated cycle track"}
    band = VOLUME_BAND_OF_CLASS.get(cls)
    if band is None:
        return "unknown", "low", {"highway": hw}
    speed, speed_source = speed_limit(tags, edge, legal)
    if (tags.get("bicycle_road") == "yes" or tags.get("cyclestreet") == "yes") and speed_source != "tagged":
        speed, speed_source = 30, "cycle street"
    if speed is None:
        return "unknown", "low", {"highway": hw}
    try:
        lanes = int(tags.get("lanes", "0").split(";")[0]) or None
    except ValueError:
        lanes = None
    conf, volume_source = "low", "estimated from road class"
    if measured is not None:
        band, conf = band_of(measured.aadt), "high"
        volume_source = f"measured, {measured.aadt:,.0f} a day ({measured.source}, {measured.year or 'year unknown'})"
    else:
        row = (bands or {}).get(cls)
        if row:
            near = row.get("by_town_distance", {}).get(town_band(town_m)) if town_m is not None else None
            use = near if near and near.get("used") else row
            band, conf = int(use["band"]), "medium"
            what = "road class and distance from a town" if use is near else "road class"
            where = f" in {origin}" if origin else ""
            volume_source = f"estimated from {what}, calibrated on {use['counts']} counts{where}"
        if (lanes or 0) >= 4:
            band = 4
    col = _speed_column(speed)
    painted = bool(cyc & {"lane", "opposite_lane"}) or edge.get("cycle_lane") == "dedicated"
    shoulder = bool(edge.get("shoulder")) or tags.get("shoulder") in ("yes", "both", "left", "right")
    width = _lane_width(tags) if painted or shoulder else None
    # Table 2 needs the lane's width; a lane or shoulder of unknown width is judged as mixed traffic (table 1).
    in_lane = width is not None and width >= _LANE_MIN_WIDTH[col]
    value = (_LANES if in_lane else _MIXED)[band][col]
    detail = {
        "speed": speed,
        "speed_source": speed_source,
        "volume": VOLUME_BANDS[band],
        "volume_source": volume_source,
        "table": "cycle lane" if in_lane else "mixed traffic",
    }
    return value, conf, detail


ECS_SURFACE = ("well", "moderate_plus", "moderate", "bad", "not_rideable")
_SMOOTHNESS_CLASS = {
    "excellent": "well",
    "good": "well",
    "intermediate": "well",
    "bad": "moderate",
    "very_bad": "bad",
    "horrible": "bad",
    "very_horrible": "not_rideable",
    "impassable": "not_rideable",
}
_SURFACE_CLASS = {
    **dict.fromkeys(("asphalt", "concrete", "concrete:lanes", "chipseal", "metal", "tartan"), "well"),
    **dict.fromkeys(("paving_stones", "paving_stones:30", "concrete:plates", "bricks"), "well"),
    **dict.fromkeys(("compacted", "fine_gravel"), "well"),
    "paved": "moderate_plus",
    "sett": "moderate",
    **dict.fromkeys(("cobblestone", "unhewn_cobblestone", "grass_paver"), "bad"),
    **dict.fromkeys(("grass", "sand", "mud", "woodchips", "rock"), "bad"),
}
_LOOSE = {"gravel", "pebblestone", "unpaved", "shells", "dirt", "earth", "ground", "soil"}
_TRACKTYPE_CLASS = {"grade1": "well", "grade2": "moderate", "grade3": "moderate", "grade4": "bad", "grade5": "bad"}


def ecs_surface(tags: dict[str, str], edge: dict[str, Any]) -> Result:
    """The ECS rideability class. OSM smoothness says it directly; otherwise the surface, then the track grade.
    'moderate_plus' is paved of unknown kind: at least moderately rideable. Untagged roads are unknown (D106)."""
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "na", "high", {}
    smooth = tags.get("smoothness")
    raw = tags.get("surface", "").split(";")[0].strip()
    if smooth in _SMOOTHNESS_CLASS:
        return _SMOOTHNESS_CLASS[smooth], "high", {"smoothness": smooth, "surface": raw or None}
    if raw in _SURFACE_CLASS:
        return _SURFACE_CLASS[raw], "medium", {"surface": raw}
    grade = _TRACKTYPE_CLASS.get(tags.get("tracktype", ""))
    if grade and (raw in _LOOSE or not raw):
        return grade, "medium", {"surface": raw or None, "tracktype": tags["tracktype"]}
    return "unknown", "low", {"surface": raw or None, "highway": _highway(tags)}


_BIKE_ALLOWED = {"yes", "designated", "permissive", "destination", "official"}


def ecs_continuity(tags: dict[str, str], edge: dict[str, Any]) -> Result:
    """Whether the way can be ridden: open, closed to bikes, a legal dismount, or steps (with a ramp or not)."""
    if edge.get("use") == "ferry" or tags.get("route") == "ferry":
        return "na", "high", {}
    hw = _highway(tags)
    bike = tags.get("bicycle")
    if hw == "steps":
        ramp = tags.get("ramp:bicycle") in ("yes", "both", "left", "right")
        return ("steps_ramp" if ramp else "steps"), "high", {}
    if bike == "dismount":
        return "dismount", "high", {}
    if bike == "no" or _base_class(hw) == "motorway":
        return "closed", "medium", {"bicycle": bike, "highway": hw}
    if tags.get("access") in ("no", "private") and bike not in _BIKE_ALLOWED:
        return "closed", "medium", {"access": tags.get("access")}
    return "open", "medium", {}


_EV_RE = re.compile(r"^(?:ev|eurovelo)\s*0*(\d+)$", re.I)


def eurovelo_number(ref: str) -> int | None:
    """'EV8', 'EV 8', 'EuroVelo 8' -> 8."""
    m = _EV_RE.match(ref.strip())
    return int(m.group(1)) if m else None


def cycle_network(networks: set[tuple[str, str]], ev_number: int | None) -> Result:
    """Which waymarked cycle network (per OSM route relations) the way belongs to; the highest level wins."""
    if ev_number is not None and any(eurovelo_number(ref) == ev_number for _, ref in networks):
        return "eurovelo_route", "medium", {}
    levels = {net for net, _ in networks}
    for net, value in (("icn", "international"), ("ncn", "national"), ("rcn", "regional"), ("lcn", "local")):
        if net in levels:
            return value, "medium", {"refs": sorted(ref for n, ref in networks if n == net)[:3]}
    return "none", "medium", {}


LAYERS = [
    LayerInfo(
        id="infrastructure",
        title="Infrastructure",
        description="What you ride on: car-free paths, cycle facilities, or roads shared with traffic.",
        source="OpenStreetMap via Valhalla map matching",
        values=[
            LayerValue(id="cycleway", label="Cycle path"),
            LayerValue(id="shared_path", label="Car-free path (shared)"),
            LayerValue(id="separated_track", label="Separated cycle track"),
            LayerValue(id="cycle_lane", label="Painted cycle lane"),
            LayerValue(id="quiet_road", label="Quiet road"),
            LayerValue(id="road", label="Road with traffic"),
            LayerValue(id="busy_road", label="Busy road"),
            LayerValue(id="steps", label="Steps"),
            LayerValue(id="ferry", label="Ferry"),
            LayerValue(id="unmatched", label="Not matched to the map"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="traffic_stress",
        title="Traffic stress",
        description="Level of Traffic Stress (LTS) estimated from road class, speed limit, lanes and cycle "
        "facilities. 1 = comfortable for anyone, 4 = only for confident riders. Speeds are often defaults.",
        source="OpenStreetMap tags (heuristic v0)",
        values=[
            LayerValue(id="1", label="LTS 1 – car-free or very calm"),
            LayerValue(id="2", label="LTS 2 – calm"),
            LayerValue(id="3", label="LTS 3 – moderate traffic"),
            LayerValue(id="4", label="LTS 4 – heavy or fast traffic"),
            LayerValue(id="na", label="Not applicable (ferry)"),
            LayerValue(id="unmatched", label="Not matched to the map"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="surface",
        title="Surface",
        description="Riding surface from OSM surface/smoothness/tracktype tags. 'Paved (assumed)' means the "
        "road is untagged but of a class that is almost always paved.",
        source="OpenStreetMap tags",
        values=[
            LayerValue(id="paved_smooth", label="Paved, smooth"),
            LayerValue(id="paved_assumed", label="Paved (assumed)"),
            LayerValue(id="paved_rough", label="Paved, rough (cobbles, setts)"),
            LayerValue(id="compacted", label="Compacted gravel"),
            LayerValue(id="gravel", label="Loose gravel / unpaved"),
            LayerValue(id="dirt", label="Dirt, sand or grass"),
            LayerValue(id="na", label="Not applicable (ferry)"),
            LayerValue(id="unmatched", label="Not matched to the map"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="cycle_network",
        title="Waymarked network (OSM)",
        description="Whether the track runs on a waymarked cycle route mapped in OSM: a proxy for signage on the "
        "ground. 'EuroVelo route' means a relation for this EuroVelo route itself.",
        source="OpenStreetMap route relations",
        values=[
            LayerValue(id="eurovelo_route", label="On this EuroVelo route (OSM)"),
            LayerValue(id="international", label="Other international route"),
            LayerValue(id="national", label="National route"),
            LayerValue(id="regional", label="Regional route"),
            LayerValue(id="local", label="Local route"),
            LayerValue(id="none", label="Not on a mapped cycle route"),
            LayerValue(id="unmatched", label="Not matched to the map"),
        ],
    ),
    LayerInfo(
        id="gradient",
        title="Gradient",
        description="Average gradient over 100 m in the direction of travel, from the smoothed terrain model.",
        source="Copernicus DEM GLO-30",
        values=[
            LayerValue(id="flat", label="Flat (< 2%)"),
            LayerValue(id="gentle", label="Gentle (2–4%)"),
            LayerValue(id="moderate", label="Moderate (4–6%)"),
            LayerValue(id="steep", label="Steep (6–8%)"),
            LayerValue(id="very_steep", label="Very steep (8–10%)"),
            LayerValue(id="extreme", label="Extreme (≥ 10%)"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="ecs_traffic",
        title="ECS traffic category",
        description="The European Certification Standard's traffic categories (2026 tables 1 and 2), from the speed "
        "limit (tagged, else the country's legal limit) and the traffic volume: measured where an open count lies on "
        "the road, else the road class's typical volume calibrated on the country's counts, else estimated (D108).",
        source="OpenStreetMap tags; open traffic counts (engine/profiles/traffic); legal speed limits",
        values=[
            LayerValue(id="traffic_free", label="Traffic-free"),
            LayerValue(id="very_low", label="Very low traffic"),
            LayerValue(id="low", label="Low traffic"),
            LayerValue(id="moderate", label="Moderate traffic"),
            LayerValue(id="high", label="High traffic"),
            LayerValue(id="very_high", label="Very high traffic"),
            LayerValue(id="na", label="Not applicable (ferry)"),
            LayerValue(id="unmatched", label="Not matched to the map"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="ecs_surface",
        title="ECS surface",
        description="The European Certification Standard's rideability classes, from OSM smoothness, surface and "
        "track grade. A road with no surface tag is unknown (D106).",
        source="OpenStreetMap tags",
        values=[
            LayerValue(id="well", label="Perfectly or well rideable"),
            LayerValue(id="moderate_plus", label="Paved, at least moderately rideable"),
            LayerValue(id="moderate", label="Moderately rideable"),
            LayerValue(id="bad", label="Badly rideable"),
            LayerValue(id="not_rideable", label="Not rideable"),
            LayerValue(id="na", label="Not applicable (ferry)"),
            LayerValue(id="unmatched", label="Not matched to the map"),
            LayerValue(id="unknown", label="Unknown"),
        ],
    ),
    LayerInfo(
        id="ecs_continuity",
        title="ECS continuity",
        description="Whether the way can be ridden: open, closed to bikes (or a motorway), a legal obligation to "
        "dismount, or steps with or without a bicycle ramp.",
        source="OpenStreetMap tags",
        values=[
            LayerValue(id="open", label="Open to bikes"),
            LayerValue(id="dismount", label="Dismount"),
            LayerValue(id="steps_ramp", label="Steps with a bicycle ramp"),
            LayerValue(id="steps", label="Steps"),
            LayerValue(id="closed", label="Closed to bikes"),
            LayerValue(id="na", label="Not applicable (ferry)"),
            LayerValue(id="unmatched", label="Not matched to the map"),
        ],
    ),
]
