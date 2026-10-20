"""Which map extracts a route needs (D67), and the projection its distances are measured in (D68)."""

import numpy as np
import pytest
from shapely.geometry import box, mapping

from dpg_audit.corridor import corridor
from dpg_audit.lrs import MeasuredLine
from dpg_audit.lrs.geodesy import distance
from dpg_audit.lrs.index import EUROPE, to_laea, use_projection_for
from dpg_audit.sources import osm


def region(rid, geom, parent=None, iso=None, pbf=True):
    urls = {"pbf": f"https://x.invalid/{rid}.osm.pbf"} if pbf else {}
    props = {"id": rid, "name": rid, "parent": parent, "urls": urls}
    if iso:
        props["iso3166-1:alpha2"] = [iso]
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def index():
    # Two countries side by side along lon 1.0, their outlines overlapping by 0.02° as Geofabrik's do. "aa" has two
    # provinces; "bb" has none.
    return {
        "features": [
            region("continent", box(-1, -1, 3, 2), pbf=False),
            region("aa", box(0, 0, 1.02, 1), "continent", "AA"),
            region("aa-west", box(0, 0, 0.51, 1), "aa"),
            region("aa-east", box(0.49, 0, 1.02, 1), "aa"),
            region("bb", box(0.98, 0, 2, 1), "continent", "BB"),
        ]
    }


def line(lon0, lon1, lat=0.5):
    lon = np.linspace(lon0, lon1, 200)
    return MeasuredLine(lon, np.full_like(lon, lat))


def test_a_closed_border_brings_no_neighbour(monkeypatch):
    # The route runs right up to the border (lon 0.995, inside both outlines) but never into "bb".
    monkeypatch.setattr(osm, "OPEN_BORDERS", set())
    lines = [line(0.6, 0.995)]
    picked = osm.route_extracts(index(), lines, corridor(lines, 3000))
    assert [p["id"] for p in picked] == ["aa-east"]


def test_an_open_border_brings_the_neighbour_and_entering_brings_it_too(monkeypatch):
    monkeypatch.setattr(osm, "OPEN_BORDERS", {"AA", "BB"})
    lines = [line(0.6, 0.995)]
    assert [p["id"] for p in osm.route_extracts(index(), lines, corridor(lines, 3000))] == ["aa-east", "bb"]
    monkeypatch.setattr(osm, "OPEN_BORDERS", set())
    lines = [line(0.3, 1.5)]
    assert [p["id"] for p in osm.route_extracts(index(), lines, corridor(lines, 3000))] == ["aa-east", "aa-west", "bb"]


def test_distances_stay_true_far_from_europe():
    # 10 km east-west near Hope, British Columbia.
    lon = np.array([-121.50, -121.50 + 10_000 / (111_320 * np.cos(np.radians(49.38)))])
    lat = np.array([49.38, 49.38])
    true = distance(lon[0], lat[0], lon[1], lat[1])
    try:
        assert use_projection_for(lon, lat) != EUROPE
        x, y = to_laea(lon, lat)
        assert float(np.hypot(x[1] - x[0], y[1] - y[0])) == pytest.approx(true, rel=0.005)
    finally:
        assert use_projection_for([0.0, 1.0], [45.0, 46.0]) == EUROPE
