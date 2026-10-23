import numpy as np
import pytest

from dpg_audit.layers import elevation as el
from dpg_audit.lrs import MeasuredLine, RoutePath


def straight_path(km: float = 10.0) -> RoutePath:
    # due east along 45°N; 1° of longitude there is ~78.8 km
    return RoutePath([MeasuredLine([5.0, 5.0 + km / 78.85], [45.0, 45.0])])


def ramp_sampler(lon, lat):
    """Flat for 2 km, then 5% for 2 km (+100 m), then flat."""
    m = (np.asarray(lon) - 5.0) * 78_850
    return np.clip((m - 2000) * 0.05, 0, 100) + 200


def test_extrema_ignore_small_wiggles():
    ele = np.array([0, 2, 1, 3, 20, 18, 40, 10, 12, 0], dtype=float)
    assert el._extrema(ele, 5.0) == [0, 6, 9]


def test_ascent_descent_on_ramp():
    profs = el.profiles(straight_path(), ramp_sampler, [])
    up, down = el.ascent_descent(profs, 0, 10_000)
    assert up == pytest.approx(100, abs=3)
    assert down == pytest.approx(0, abs=3)


def hill_sampler(lon, lat):
    """The ramp, plus a 150 m hill between 6 and 8 km: what a straight line drawn over a ridge would sample."""
    m = (np.asarray(lon) - 5.0) * 78_850
    return ramp_sampler(lon, lat) + np.clip(150 - np.abs(m - 7000) * 0.15, 0, None)


def test_ascent_leaves_out_unknown_terrain_but_keeps_the_net_change():
    profs = el.profiles(straight_path(), hill_sampler, [])
    assert el.ascent_descent(profs, 0, 10_000)[0] == pytest.approx(250, abs=10)  # ramp + the (smoothed) ridge
    up, down = el.ascent_descent(profs, 0, 10_000, exclude=[(5800.0, 8200.0)])  # the ridge is under a placeholder
    assert up == pytest.approx(100, abs=3) and down == pytest.approx(0, abs=3)
    # a placeholder in the middle of the ramp: the real road still has to make the 50 m under it
    ramp = el.profiles(straight_path(), ramp_sampler, [])
    assert el.ascent_descent(ramp, 0, 10_000, exclude=[(2500.0, 3500.0)])[0] == pytest.approx(100, abs=3)


def test_unknown_terrain_only_in_sections_mostly_placeholder():
    sections = [(0.0, 10_000.0), (10_000.0, 20_000.0)]
    placeholders = [(1_000.0, 3_000.0), (12_000.0, 16_000.0), (19_500.0, 21_000.0)]
    # 20% of the first section: approximate, kept. 55% of the second: unknown, clipped to the section.
    assert el.unknown_terrain(sections, placeholders) == [(12_000.0, 16_000.0), (19_500.0, 20_000.0)]
    assert el.overlap([(12_000.0, 16_000.0)], 0.0, 14_000.0) == 2_000.0


def test_gradient_events_and_classes():
    profs = el.profiles(straight_path(), ramp_sampler, [])
    events = el.gradient_events(profs)
    assert {e.value for e in events} == {"flat", "moderate"}
    moderate = [e for e in events if e.value == "moderate"]
    assert sum(e.to_m - e.from_m for e in moderate) == pytest.approx(2000, abs=250)
    assert moderate[0].detail["max_grade"] == pytest.approx(5.0, abs=0.6)


def test_climb_detected_with_fiets():
    profs = el.profiles(straight_path(), ramp_sampler, [])
    climbs = el.climbs(profs)
    assert len(climbs) == 1
    c = climbs[0]
    assert c.direction == "forward"
    assert c.gain_m == pytest.approx(100, abs=3)
    assert c.avg_grade == pytest.approx(5.0, abs=0.6)
    assert c.fiets == pytest.approx(el.fiets(c.gain_m, c.length_m, c.top_m), abs=0.01)


def rail_grade(km_at, gullies=(12.5, 20.0, 27.5), depth=20.0):
    """A railway grade: 2% for 30 km from km 5 (+600 m), across gullies the terrain model sees 20 m deep."""

    def sampler(lon, lat):
        m = km_at((np.asarray(lon) - 5.0) * 78.85) * 1000
        dips = sum(np.clip(depth - np.abs(m - g * 1000) * depth / 150, 0, None) for g in gullies)
        return 100 + np.clip(m - 5000, 0, 30_000) * 0.02 - dips

    return sampler


def test_climb_runs_through_small_dips_on_a_gentle_grade():
    profs = el.profiles(straight_path(40), rail_grade(lambda km: km), [])
    [c] = el.climbs(profs)
    assert c.direction == "forward"
    assert c.gain_m == pytest.approx(600, abs=10)
    assert c.from_m == pytest.approx(5000, abs=300) and c.to_m == pytest.approx(35_000, abs=300)
    assert c.avg_grade == pytest.approx(2.0, abs=0.1)
    # ridden the other way, the same grade is one climb in reverse
    [r] = el.climbs(el.profiles(straight_path(40), rail_grade(lambda km: 40 - km), []))
    assert r.direction == "reverse" and r.gain_m == pytest.approx(600, abs=10)


def test_a_real_descent_still_ends_a_climb():
    def pass_and_dip(dip):
        def sampler(lon, lat):
            m = (np.asarray(lon) - 5.0) * 78_850
            up = np.clip(m - 2000, 0, 10_000) * 0.06  # +600 m at 6%
            down = np.clip(m - 12_000, 0, 2000) * dip / 2000
            again = np.clip(m - 14_000, 0, 5000) * 0.06  # +300 m more
            return 100 + up - down + again

        cs = el.climbs(el.profiles(straight_path(25), sampler, []))
        return [round(c.gain_m, -1) for c in cs if c.direction == "forward"]

    # 90 m is under a fifth of the 600 m gained: one climb. 110 m is more than the 100 m any dip may lose: two.
    assert pass_and_dip(90) == [810]
    assert pass_and_dip(110) == [600, 300]


def test_climb_runs_across_stage_ends_but_not_gaps():
    def grade(lon, lat):
        m = (np.asarray(lon) - 5.0) * 78_850
        return 100 + np.clip(m - 2000, 0, 16_000) * 0.02  # 2% for 16 km (+320 m), across the stage end at 10 km

    a, b = 5.0 + 10 / 78.85, 5.0 + 20 / 78.85
    path = RoutePath([MeasuredLine([5.0, a], [45.0, 45.0]), MeasuredLine([a, b], [45.0, 45.0])])
    profs = el.profiles(path, grade, [])
    [c] = el.climbs(profs)
    assert c.gain_m == pytest.approx(320, abs=10)
    # where the track stops and restarts, each side is a 160 m climb at 2%: too gentle for one that small
    assert el.climbs(profs, breaks=[path.parts[1].from_m]) == []


def test_flat_approach_is_not_part_of_the_climb():
    def valley_then_pass(lon, lat):
        m = (np.asarray(lon) - 5.0) * 78_850
        return 100 + np.clip(m, 0, 10_000) * 0.01 + np.clip(m - 10_000, 0, 5000) * 0.06  # 1% for 10 km, then 6%

    [c] = el.climbs(el.profiles(straight_path(20), valley_then_pass, []))
    assert c.from_m == pytest.approx(10_000, abs=300)
    assert c.gain_m == pytest.approx(300, abs=10)
    assert c.avg_grade == pytest.approx(6.0, abs=0.3)


def test_building_spikes_are_removed():
    def with_buildings(lon, lat):
        m = (np.asarray(lon) - 5.0) * 78_850
        spikes = ((m % 400) < 50) * 25.0  # a 25 m building every 400 m, 50 m wide
        return 100.0 + spikes

    profs = el.profiles(straight_path(), with_buildings, [])
    up, _ = el.ascent_descent(profs, 0, 10_000)
    assert up < 10  # flat road: the roofs are not climbing


def test_implausible_grades_are_unknown():
    def cliff(lon, lat):
        m = (np.asarray(lon) - 5.0) * 78_850
        return np.where(m < 5000, 0.0, 200.0)  # 200 m step: no road does that

    events = el.gradient_events(el.profiles(straight_path(), cliff, []))
    assert any(e.value == "unknown" for e in events)
    assert not el.climbs(el.profiles(straight_path(), cliff, []))


def test_max_grade_ignores_untrusted_and_implausible():
    profs = el.profiles(straight_path(), ramp_sampler, [])
    assert el.max_grade_window(profs, 0, 10_000) == pytest.approx(5.0, abs=0.6)
    el.mark_untrusted(profs, [(1500.0, 4500.0)])  # the whole ramp sits on placeholder geometry
    assert (el.max_grade_window(profs, 0, 10_000) or 0) < 1.0


def test_structures_are_interpolated_not_sampled():
    def bridge_dip(lon, lat):
        m = (np.asarray(lon) - 5.0) * 78_850
        return np.where((m > 4000) & (m < 4400), 100.0, 150.0)  # DEM sees the river 50 m below the bridge

    plain = el.profiles(straight_path(), bridge_dip, [])
    bridged = el.profiles(straight_path(), bridge_dip, [(4000.0, 4400.0)])
    assert el.at(plain, np.array([4200.0]))[0] < 120
    assert el.at(bridged, np.array([4200.0]))[0] == pytest.approx(150, abs=1)


@pytest.mark.parametrize(
    ("g", "cls"), [(0.5, "flat"), (-3, "gentle"), (5, "moderate"), (7.9, "steep"), (9, "very_steep"), (-12, "extreme")]
)
def test_grade_class(g, cls):
    assert el.grade_class(g) == cls
