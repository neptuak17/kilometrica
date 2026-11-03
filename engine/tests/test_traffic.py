import numpy as np
import pytest
import shapely

from dpg_audit.layers import classify
from dpg_audit.lrs.index import to_laea
from dpg_audit.traffic.calibrate import RefWay, match
from dpg_audit.traffic.counts import Count, latest_per_station, normalise_ref, osm_refs
from dpg_audit.traffic.route import Measured, TrafficContext, load_legal

FR = load_legal()["FR"]
ES = load_legal()["ES"]


@pytest.mark.parametrize(
    ("raw", "norm"),
    [("D 10", "D10"), ("D0010", "D10"), ("11 D0010", "D10"), ("N0020", "N20"), ("A0009", "A9"), ("D 910A", "D910A")],
)
def test_road_references_normalise(raw, norm):
    assert normalise_ref(raw) == norm


def test_osm_ref_tags_can_hold_several_roads():
    assert osm_refs("D 6113;E 80") == ["D6113", "E80"]


@pytest.mark.parametrize(
    ("tags", "edge", "legal", "speed"),
    [
        ({"highway": "secondary"}, {}, FR, (80, "legal rural")),
        ({"highway": "secondary", "maxspeed": "90"}, {}, FR, (90, "tagged")),
        ({"highway": "primary"}, {"density": 10}, ES, (30, "legal urban")),
        ({"highway": "residential"}, {}, FR, (50, "legal urban")),
        ({"highway": "trunk", "oneway": "yes"}, {}, FR, (110, "legal dual")),
        ({"highway": "motorway"}, {}, FR, (130, "legal motorway")),
        ({"highway": "secondary"}, {}, None, (90, "default")),  # a country missing from the table
        ({"highway": "track"}, {}, FR, (30, "default")),  # no legal type for tracks
    ],
)
def test_speed_limits_come_from_the_country_table(tags, edge, legal, speed):
    assert classify.speed_limit(tags, edge, legal) == speed


def test_measured_volume_wins_over_the_class_estimate():
    tags = {"highway": "secondary", "ref": "D 10"}
    bands = {"secondary": {"band": 2, "counts": 452}}
    assert classify.ecs_traffic(tags, {}, FR, bands)[:2] == ("high", "medium")  # 2,001-4,000 at 80 km/h
    quiet = Measured(aadt=420.0, year=2023, source="fr-aude")
    value, conf, detail = classify.ecs_traffic(tags, {}, FR, bands, quiet)
    assert (value, conf) == ("low", "high")  # 1-500 a day at 80 km/h
    assert detail["volume_source"] == "measured, 420 a day (fr-aude, 2023)"


def test_tertiary_at_the_legal_80_is_moderate_in_france():
    assert classify.ecs_traffic({"highway": "tertiary"}, {}, FR, {"tertiary": {"band": 1, "counts": 496}})[0] == (
        "moderate"
    )


@pytest.mark.parametrize(("ecs", "value"), [("low", "quiet_road"), ("moderate", "road"), ("high", "busy_road")])
def test_busy_follows_the_ecs_category(ecs, value):
    assert classify.infrastructure({"highway": "secondary"}, {}, "4", ecs)[0] == value


def test_a_count_stands_for_its_road_five_km_either_side():
    ctx = TrafficContext(anchors={"D10": ([10_000.0, 30_000.0], [Measured(800, 2022, "a"), Measured(5000, 2023, "b")])})
    assert ctx.measured(["D10"], 14_000).aadt == 800
    assert ctx.measured(["D10"], 26_000).aadt == 5000
    assert ctx.measured(["D10"], 20_000) is None  # more than 5 km from either
    assert ctx.measured(["D11"], 10_000) is None


def test_only_the_latest_count_per_station_is_kept():
    a = Count("fr-aude", "FR", "D10", 500, 2015, 2.0, 43.0)
    b = Count("fr-aude", "FR", "D10", 700, 2021, 2.0, 43.0)
    assert latest_per_station([a, b]) == [b]


def test_counts_match_the_nearest_road_of_the_same_reference():
    def way(i, ref, lat):
        x, y = to_laea(np.array([2.0, 2.01]), np.array([lat, lat]))
        return RefWay(i, "secondary", [ref], None, shapely.linestrings(x, y))

    ways = [way(1, "D11", 43.0001), way(2, "D10", 43.0005)]  # D11 is nearer, but the count is on D10
    count = Count("fr-aude", "FR", "D10", 900, 2020, 2.005, 43.0)
    assert [(c.ref, w.id) for c, w in match([count], ways)] == [("D10", 2)]
    far = Count("fr-aude", "FR", "D10", 900, 2020, 2.005, 43.01)  # about 1 km away
    assert match([far], ways) == []


def test_far_from_towns_a_secondary_road_takes_its_quieter_band():
    bands = {
        "secondary": {
            "band": 2,
            "counts": 452,
            "by_town_distance": {
                "over 10 km": {"band": 1, "counts": 244, "used": True},
                "0-2 km": {"band": 3, "counts": 21, "used": True},
                "2-5 km": {"band": 4, "counts": 3, "used": False},
            },
        }
    }
    tags = {"highway": "secondary"}
    far = classify.ecs_traffic(tags, {}, FR, bands, None, 15_000, "FR")
    assert far[0] == "moderate"  # 501-2,000 at 80 km/h
    source = "estimated from road class and distance from a town, calibrated on 244 counts in FR"
    assert far[2]["volume_source"] == source
    assert classify.ecs_traffic(tags, {}, FR, bands, None, 1_000, "FR")[0] == "very_high"
    assert classify.ecs_traffic(tags, {}, FR, bands, None, 3_000, "FR")[0] == "high"  # too few: the class's band


def test_countries_without_counts_use_france():
    ctx = TrafficContext(bands={"FR": {"secondary": {"band": 2}}})
    assert ctx.bands_for("GR") == ({"secondary": {"band": 2}}, "FR")
    assert ctx.bands_for("FR")[1] == "FR"
    assert TrafficContext().bands_for("GR") == (None, None)


def test_a_counted_section_anchors_along_its_length():
    from dpg_audit.traffic.counts import _along

    line = shapely.LineString([(2.0, 43.0), (2.0, 43.014)])  # about 1.55 km north
    pts = _along(shapely.to_wkb(line))
    assert len(pts) == 5  # every 500 m and the end
    assert pts[0] == pytest.approx((2.0, 43.0)) and pts[-1] == pytest.approx((2.0, 43.014))
    assert _along(shapely.to_wkb(shapely.Point(2.0, 43.0))) == ()
