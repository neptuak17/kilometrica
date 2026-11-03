import pytest
from test_rules import day, ev
from test_services import place

from dpg_audit.layers import classify
from dpg_audit.models import Component, ComponentKind, GapType, SectionScores, Signage
from dpg_audit.rules import ecs
from dpg_audit.rules.profile import load_rules
from dpg_audit.services.coverage import Coverage
from dpg_audit.services.profile import load_services

# --- the ECS layers ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tags", "edge", "value"),
    [
        ({"highway": "cycleway"}, {}, "traffic_free"),
        ({"highway": "track", "motor_vehicle": "no"}, {}, "traffic_free"),
        ({"highway": "residential", "maxspeed": "30"}, {}, "very_low"),
        ({"highway": "tertiary"}, {}, "low"),  # 501-2,000 a day at 70 km/h
        ({"highway": "secondary"}, {}, "high"),  # 2,001-4,000 at 90 km/h
        ({"highway": "secondary", "maxspeed": "50"}, {}, "moderate"),
        ({"highway": "primary"}, {}, "very_high"),  # 4,001-10,000 at 90 km/h
        ({"highway": "primary"}, {"density": 10}, "high"),  # urban default 50 km/h
        ({"highway": "secondary", "maxspeed": "70", "cycleway:right": "lane"}, {}, "moderate"),  # width unknown
        ({"highway": "secondary", "maxspeed": "70", "cycleway:right": "lane", "cycleway:right:width": "2"}, {}, "low"),
        ({"highway": "residential", "lanes": "4", "maxspeed": "50"}, {}, "very_high"),
        ({"route": "ferry"}, {}, "na"),
    ],
)
def test_ecs_traffic_categories(tags, edge, value):
    assert classify.ecs_traffic(tags, edge)[0] == value


@pytest.mark.parametrize(
    ("tags", "value"),
    [
        ({"highway": "cycleway", "surface": "asphalt"}, "well"),
        ({"highway": "cycleway", "surface": "asphalt", "smoothness": "bad"}, "moderate"),
        ({"highway": "track", "surface": "gravel", "tracktype": "grade2"}, "moderate"),
        ({"highway": "track", "surface": "gravel"}, "unknown"),
        ({"highway": "residential", "surface": "cobblestone"}, "bad"),
        ({"highway": "residential", "surface": "sett"}, "moderate"),
        ({"highway": "path", "surface": "paved"}, "moderate_plus"),
        ({"highway": "residential"}, "unknown"),  # untagged roads are unknown (D106, question 144)
        ({"highway": "track", "smoothness": "impassable"}, "not_rideable"),
    ],
)
def test_ecs_surface_classes(tags, value):
    assert classify.ecs_surface(tags, {})[0] == value


@pytest.mark.parametrize(
    ("tags", "value"),
    [
        ({"highway": "steps"}, "steps"),
        ({"highway": "steps", "ramp:bicycle": "yes"}, "steps_ramp"),
        ({"highway": "footway", "bicycle": "dismount"}, "dismount"),
        ({"highway": "footway", "bicycle": "no"}, "closed"),
        ({"highway": "service", "access": "private"}, "closed"),
        ({"highway": "service", "access": "private", "bicycle": "yes"}, "open"),
        ({"highway": "motorway"}, "closed"),
        ({"highway": "cycleway"}, "open"),
    ],
)
def test_ecs_continuity(tags, value):
    assert classify.ecs_continuity(tags, {})[0] == value


@pytest.mark.parametrize(
    ("barrier", "tags", "effect"),
    [
        ("bollard", {}, None),
        ("stile", {}, "dismount"),
        ("kissing_gate", {}, "dismount"),
        ("cycle_barrier", {}, "narrow"),
        ("cycle_barrier", {"maxwidth:physical": "1.5"}, None),
        ("gate", {"access": "no"}, "blocks"),
        ("gate", {"access": "no", "bicycle": "yes"}, None),
        ("fence", {}, "blocks"),
        ("lift_gate", {"width": "1.0"}, "narrow"),
    ],
)
def test_barrier_effects(barrier, tags, effect):
    assert ecs.barrier_effect(barrier, tags) == effect


# --- the rules ----------------------------------------------------------------------------------------------------


def stats(number, a, b, up=100.0, down=100.0, unknown=0.0):
    return SectionScores(
        number=number,
        from_m=a,
        to_m=b,
        ascent_m=up,
        descent_m=down,
        climb_unknown_m=unknown,
        max_grade_500m=2.0,
        shares={},
    )


def layers(length, **values):
    """One value per layer over the whole length, e.g. ecs_traffic='low'."""
    return [ev(layer, 0, length, v) for layer, v in values.items()]


GOOD = {"ecs_traffic": "traffic_free", "ecs_surface": "well", "ecs_continuity": "open", "gradient": "flat"}
EVERYTHING = [
    place("accommodation", 1000, kind="hotel"),
    place("food", 1000, kind="restaurant"),
    place("bike_shop", 1000),
    place("toilets", 1000),
    place("water", 1000),
    place("station", 1000, bikes="yes"),
]


def judge(events, daily, *, places=EVERYTHING, sections=None, profile="ecs-2026", **extra):
    length = daily[-1].to_m
    cov = Coverage(places, load_services(), length)
    inputs = ecs.EcsInputs(
        events=events,
        daily=daily,
        components=extra.pop("components", []),
        length_m=length,
        sections=sections or [stats(d.number, d.from_m, d.to_m) for d in daily],
        coverage=cov,
        themes=extra.pop("themes", {d.number: {"coast": 1.0} for d in daily}),
        **extra,
    )
    result = ecs.evaluate(load_rules(profile), inputs)
    route = stats(0, 0, length)
    per = inputs.sections
    ecs.apply_shares(result, route, per)
    return result, route, per


def results(result, cid):
    return [(r.from_m, r.to_m, r.result) for r in result.minor.tracks[cid]]


def test_everything_good_meets_every_tier_on_what_is_checked():
    daily = [day(1, 0, 5000)]
    result, route, (sec,) = judge(layers(5000, **GOOD), daily, rest_areas=[2000], charging=[2000])
    assert route.essential_pass == route.important_pass == route.additional_pass == 1.0
    assert results(result, "crossings") == [(0, 5000, "not_checked")]
    assert route.criteria["crossings"].not_checked == 1.0
    assert sec.stars == 3


def test_high_traffic_over_half_a_section_fails_all_of_it():
    events = [ev("ecs_traffic", 0, 3000, "high"), ev("ecs_traffic", 3000, 5000, "low")]
    events += [e for e in layers(5000, **GOOD) if e.layer != "ecs_traffic"]
    result, route, _ = judge(events, [day(1, 0, 5000)])
    assert results(result, "traffic") == [(0, 5000, "fail")]
    # The important tier forbids high traffic outright, so it fails only where the traffic is high.
    assert results(result, "traffic_important") == [(0, 3000, "fail"), (3000, 5000, "pass")]


def test_very_high_traffic_fails_only_where_it_is():
    events = [ev("ecs_traffic", 0, 1000, "very_high"), ev("ecs_traffic", 1000, 5000, "low")]
    events += [e for e in layers(5000, **GOOD) if e.layer != "ecs_traffic"]
    result, _, _ = judge(events, [day(1, 0, 5000)])
    assert results(result, "traffic") == [(0, 1000, "fail"), (1000, 5000, "pass")]


def test_2021_tolerates_one_percent_one_category_too_high():
    events = [ev("ecs_traffic", 0, 50, "very_high"), ev("ecs_traffic", 50, 10_000, "low")]
    events += [e for e in layers(10_000, **GOOD) if e.layer != "ecs_traffic"]
    result, _, _ = judge(events, [day(1, 0, 10_000)], profile="ecs-2021")
    assert results(result, "traffic") == [(0, 10_000, "pass")]


def test_climbing_per_daily_section_either_way():
    daily = [day(1, 0, 5000), day(2, 5000, 10_000), day(3, 10_000, 15_000)]
    sections = [stats(1, 0, 5000, 400, 1200), stats(2, 5000, 10_000, 700, 300), stats(3, 10_000, 15_000, 900, 0, 50)]
    result, _, per = judge(layers(15_000, **GOOD), daily, sections=sections)
    # Section 3's terrain is partly unknown: 900 m is a minimum, so it may still pass 1,000 m but already fails 500 m.
    assert results(result, "climbing") == [(0, 5000, "fail"), (5000, 10_000, "pass"), (10_000, 15_000, "unknown")]
    assert results(result, "climbing_important") == [(0, 15_000, "fail")]
    assert per[0].notes["climbing"] == "400 m up, 1,200 m down"


def test_signing_is_an_essential_condition_of_the_section():
    # Per-section criteria don't lower the shares, as in ECF's figures; they are the section's conditions (D107).
    daily = [day(1, 0, 5000), day(2, 5000, 10_000, Signage.NOT_SIGNED)]
    _, route, per = judge(layers(10_000, **GOOD), daily)
    assert per[0].essential_pass == per[1].essential_pass == 1.0
    assert per[0].conditions["essential"].passed == 1.0 and per[1].conditions["essential"].failed == 1.0
    assert per[0].stars >= 1 and per[1].stars == 0
    assert route.conditions["essential"].failed == 0.5


def test_untagged_surface_is_unknown_not_a_pass():
    events = [ev("ecs_surface", 0, 5000, "unknown")] + [e for e in layers(5000, **GOOD) if e.layer != "ecs_surface"]
    _, route, _ = judge(events, [day(1, 0, 5000)])
    assert route.criteria["surface"].unknown == 1.0
    assert route.tiers["essential"].unknown == 1.0 and route.essential_pass == 0.0


def test_missing_link_fails_continuity_but_a_join_between_ways_does_not():
    def gap(m):
        return Component(
            id=f"g{m}",
            seq=1,
            kind=ComponentKind.GAP,
            from_m=m,
            to_m=m,
            length_m=0,
            start=(0, 0),
            end=(1, 0),
            gap_type=GapType.MISSING,
        )

    daily = [day(1, 0, 5000), day(2, 5000, 10_000), day(9, 10_000, 15_000)]
    result, _, per = judge(layers(15_000, **GOOD), daily, components=[gap(5000), gap(10_000)])
    assert results(result, "continuity") == [(0, 5000, "fail"), (5000, 15_000, "pass")]
    assert per[0].notes["continuity"] == "missing link at km 5.0"


def test_dismounts_and_steps():
    events = [
        ev("ecs_continuity", 0, 1000, "open"),
        ev("ecs_continuity", 1000, 1030, "steps"),
        ev("ecs_continuity", 1030, 3000, "open"),
        ev("ecs_continuity", 3000, 3600, "dismount"),
        ev("ecs_continuity", 3600, 5000, "open"),
    ]
    events += [e for e in layers(5000, **GOOD) if e.layer != "ecs_continuity"]
    result, _, per = judge(events, [day(1, 0, 5000)])
    assert results(result, "continuity") == [(0, 5000, "fail")]  # 630 m of pushing is over 500 m
    assert per[0].notes["continuity"] == "2 dismounts, 630 m pushing"
    # Steps without a ramp fail the important tier over at least 200 m (ECS's shortest segment).
    assert results(result, "stairs") == [(0, 915, "pass"), (915, 1115, "fail"), (1115, 5000, "pass")]


def test_services_on_a_section_and_every_15_km():
    daily = [day(1, 0, 20_000), day(2, 20_000, 40_000)]
    places = [
        place("accommodation", 1000, kind="campsite"),
        place("food", 1000, kind="supermarket"),
        place("food", 30_000, kind="restaurant"),
        place("station", 1000, bikes="yes"),
    ]
    result, _, per = judge(layers(40_000, **GOOD), daily, places=places, rest_areas=[25_000])
    assert results(result, "accommodation") == [(0, 20_000, "pass"), (20_000, 40_000, "fail")]
    assert results(result, "accommodation_choice") == [(0, 40_000, "fail")]  # camping only
    assert results(result, "rest_area") == [(0, 20_000, "unknown"), (20_000, 40_000, "pass")]
    assert results(result, "warm_meal") == [(0, 20_000, "fail"), (20_000, 40_000, "pass")]
    assert results(result, "toilets") == [(0, 30_000, "fail"), (30_000, 40_000, "pass")]
    assert per[0].notes["accommodation"] == "1 found"


def test_unknown_bike_policy_makes_public_transport_unknown_not_fail():
    places = [
        place("station", 0, bikes="yes"),
        place("station", 120_000, bikes="unknown"),
        place("station", 250_000, bikes="yes"),
    ]
    result, _, _ = judge(layers(250_000, **GOOD), [day(1, 0, 250_000)], places=places)
    assert results(result, "public_transport") == [(0, 250_000, "unknown")]


def test_attractions_pass_on_evidence_and_are_never_failed():
    daily = [day(1, 0, 5000), day(2, 5000, 10_000)]
    result, _, per = judge(layers(10_000, **GOOD), daily, themes={1: {"coast": 0.9}, 2: {"coast": 0.2}})
    assert results(result, "attractions") == [(0, 5000, "pass"), (5000, 10_000, "unknown")]
    assert per[0].notes["attractions"] == "strong theme: coast"


def test_tiers_are_cumulative():
    # Important passes nowhere the essential tier fails.
    events = [ev("ecs_traffic", 0, 5000, "very_high")] + [e for e in layers(5000, **GOOD) if e.layer != "ecs_traffic"]
    _, route, _ = judge(events, [day(1, 0, 5000)])
    assert route.tiers["essential"].failed == 1.0 and route.tiers["important"].failed == 1.0
    # And the conditions add up the same way.
    _, route, _ = judge(layers(5000, **GOOD), [day(1, 0, 5000, Signage.NOT_SIGNED)])
    assert route.conditions["essential"].failed == 1.0 and route.conditions["important"].failed == 1.0


def test_other_ways_line_counts_no_missing_links():
    gap = Component(
        id="g",
        seq=1,
        kind=ComponentKind.GAP,
        from_m=5000,
        to_m=5000,
        length_m=0,
        start=(0, 0),
        end=(1, 0),
        gap_type=GapType.MISSING,
    )
    daily = [day(18, 0, 5000), day(19, 5000, 10_000)]
    result, _, _ = judge(layers(10_000, **GOOD), daily, components=[gap], missing_links=False)
    assert results(result, "continuity") == [(0, 10_000, "pass")]
