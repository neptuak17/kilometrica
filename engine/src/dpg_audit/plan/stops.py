"""Candidate overnight stops (11.6): the places to stay that count, grouped by the town they belong to.

Only places that count (D17: within 5 km or 30 minutes of the route) are used. A bed belongs to the nearest named town
or village within TOWN_REACH_M of it. Beds near no town are grouped along the route, a new group starting when the
next bed is more than KM_GROUP_M further on. A stop sits at the median access point of its beds.

Nothing here depends on the rider, and no place is named (only towns), so the file can be free (D45). The planner
filters stops by how the rider sleeps and by the month.
"""

from bisect import bisect_left, bisect_right
from collections import Counter
from functools import cache
from statistics import median

import numpy as np
from scipy.spatial import cKDTree

from dpg_audit.dream.themes import Settlement
from dpg_audit.lrs.index import LAEA_SLACK, to_laea
from dpg_audit.lrs.path import RoutePath
from dpg_audit.models import Place, Stop, StopBeds, StopsFile
from dpg_audit.services.coverage import Coverage

TOWN_REACH_M = {"city": 10_000.0, "town": 5_000.0, "village": 3_000.0}
"""A bed belongs to the nearest place within its size's reach: a city spreads further than its centre point (D70)."""
NEAR_M = 10_000.0
"""A stop with no town is "near X" for a named place this close; else so many km from the nearest named stop."""
KM_GROUP_M = 2_000.0
SERVICE_REACH_M = 2_500.0
"""Other services count towards a stop when their access point lies this close to the stop along the route."""
STATION_REACH_M = 5_000.0
STOP_SERVICES = ("food", "water", "atm", "pharmacy", "bike_shop", "toilets")


def _town_of(beds: list[Place], towns: list[Settlement]) -> list[int | None]:
    if not towns or not beds:
        return [None] * len(beds)
    tx, ty = to_laea([t.lon for t in towns], [t.lat for t in towns])
    tree = cKDTree(np.stack([tx, ty], 1))
    bx, by = to_laea([b.lon for b in beds], [b.lat for b in beds])
    k = min(8, len(towns))
    dist, idx = tree.query(np.stack([bx, by], 1), k=k, distance_upper_bound=max(TOWN_REACH_M.values()) * LAEA_SLACK)
    dist, idx = dist.reshape(len(beds), k), idx.reshape(len(beds), k)
    out: list[int | None] = []
    for ds, ix in zip(dist, idx, strict=True):
        # The nearest place whose size reaches this far.
        hit = next(
            (int(i) for d, i in zip(ds, ix, strict=True)
             if np.isfinite(d) and d <= TOWN_REACH_M.get(towns[int(i)].kind, TOWN_REACH_M["village"]) * LAEA_SLACK),
            None,
        )  # fmt: skip
        out.append(hit)
    return out


def _near_label(stop: Stop, towns: list[Settlement], tree: cKDTree | None, named: list[Stop]) -> str | None:
    """How to name a stop that belongs to no town (D70): near a named place within NEAR_M, else so many km from the
    nearest named stop along the route ("12 km from Tulameen"), which reads right in either direction."""
    if tree is not None:
        x, y = to_laea([stop.lon], [stop.lat])
        d, i = tree.query([float(x[0]), float(y[0])], k=1, distance_upper_bound=NEAR_M * LAEA_SLACK)
        if np.isfinite(d):
            return f"near {towns[int(i)].name}"
    if named:
        other = min(named, key=lambda s: abs(s.at_m - stop.at_m))
        return f"{round(abs(other.at_m - stop.at_m) / 1000)} km from {other.name}"
    return None


def _groups(beds: list[Place], towns: list[Settlement]) -> list[tuple[Settlement | None, list[Place]]]:
    by_town: dict[int, list[Place]] = {}
    loose: list[Place] = []
    for bed, t in zip(beds, _town_of(beds, towns), strict=True):
        if t is None:
            loose.append(bed)
        else:
            by_town.setdefault(t, []).append(bed)
    out: list[tuple[Settlement | None, list[Place]]] = [(towns[t], group) for t, group in by_town.items()]
    loose.sort(key=lambda p: p.access_at_m)
    current: list[Place] = []
    for bed in loose:
        if current and bed.access_at_m - current[-1].access_at_m > KM_GROUP_M:
            out.append((None, current))
            current = []
        current.append(bed)
    if current:
        out.append((None, current))
    return out


@cache
def _zones():
    from timezonefinder import TimezoneFinder  # 30 MB of boundary data, loaded once per run

    return TimezoneFinder()


def time_zone_at(lon: float, lat: float) -> str | None:
    """The IANA time zone at a point (D68), from timezone-boundary-builder's boundaries (ODbL) via timezonefinder.
    A country can span several zones (British Columbia's Kootenays straddle Pacific and Mountain time), so clock
    times such as sunset use the stop's own zone, not its country's."""
    return _zones().timezone_at(lng=lon, lat=lat)


def _near(positions: list[float], m: float, reach: float) -> int:
    return bisect_right(positions, m + reach) - bisect_left(positions, m - reach)


def name_towns(places: list[Place], towns: list[Settlement]) -> None:
    """Each place to stay's own town (`detail.town`), by the same rule as stops: the nearest named town or village
    within TOWN_REACH_M. Plan's map searches use it ("Camping La Corniche, Hendaye"), not the stop's town, which can
    be a neighbour's."""
    beds = [p for p in places if p.service == "accommodation"]
    for p, t in zip(beds, _town_of(beds, towns), strict=True):
        if t is not None and towns[t].name:
            p.detail["town"] = towns[t].name


def build_stops(
    path: RoutePath, places: list[Place], settlements: list[Settlement], coverage: Coverage, season_year: int
) -> StopsFile:
    beds = [p for p in places if p.service == "accommodation" and p.counts]
    towns = [s for s in settlements if s.name]
    name_towns(places, towns)
    services = {s: sorted(p.access_at_m for p in coverage.own(s)) for s in STOP_SERVICES}
    stations = sorted(coverage.bail_out_stations(), key=lambda p: p.access_at_m)
    station_m = [p.access_at_m for p in stations]

    stops: list[Stop] = []
    seen: Counter[str] = Counter()
    for town, group in _groups(beds, towns):
        at_m = round(float(median(p.access_at_m for p in group)), 1)
        if town is not None:
            lon, lat = town.lon, town.lat
        else:
            lon, lat = (float(v) for v in path.locate(at_m))
        kinds: dict[str, list[Place]] = {}
        for p in group:
            kinds.setdefault(p.kind, []).append(p)
        bed_list = [
            StopBeds(kind=k, count=len(ps), seasons=sorted(Counter(p.months for p in ps).items(), key=lambda x: -x[1]))
            for k, ps in sorted(kinds.items())
        ]
        i = bisect_left(station_m, at_m)
        near = [p for p in stations[max(i - 1, 0) : i + 1] if abs(p.access_at_m - at_m) <= STATION_REACH_M]
        station = min(near, key=lambda p: abs(p.access_at_m - at_m), default=None)
        detours = [p.access_m for p in group if p.access_m is not None]
        countries = Counter(p.country for p in group if p.country)
        base = f"stop-{round(at_m / 100)}"
        seen[base] += 1
        stops.append(
            Stop(
                id=base if seen[base] == 1 else f"{base}-{seen[base]}",
                name=town.name if town else None,
                place_kind=town.kind if town else None,
                at_m=at_m,
                lon=round(lon, 6),
                lat=round(lat, 6),
                country=countries.most_common(1)[0][0] if countries else None,
                time_zone=time_zone_at(lon, lat),
                detour_m=round(min(detours)) if detours else None,
                beds=bed_list,
                services={s: _near(pos, at_m, SERVICE_REACH_M) for s, pos in services.items()},
                station=(station.name or "unnamed station") if station else None,
                station_at_m=station.access_at_m if station else None,
            )
        )
    stops.sort(key=lambda s: (s.at_m, s.id))
    named = [s for s in stops if s.name]
    tree = None
    if towns:
        tx, ty = to_laea([t.lon for t in towns], [t.lat for t in towns])
        tree = cKDTree(np.stack([tx, ty], 1))
    for s in stops:
        if not s.name:
            s.near = _near_label(s, towns, tree, named)
    return StopsFile(season_year=season_year, reach_m=SERVICE_REACH_M, stops=stops)
