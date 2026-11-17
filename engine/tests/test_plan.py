"""Plan data (M4, DESIGN.md 11.6): stops, effort, highlights, holiday dates and day-by-day opening."""

import json
from datetime import date

import numpy as np
import pytest
from test_services import place

from dpg_audit.build import TrackInput, assemble
from dpg_audit.dream.crowding import CrowdingSource
from dpg_audit.dream.themes import Settlement
from dpg_audit.layers import elevation
from dpg_audit.lrs import MeasuredLine, RoutePath
from dpg_audit.models import Route
from dpg_audit.networks.user import NOT_RATED
from dpg_audit.plan.effort import build_effort, surface_letter
from dpg_audit.plan.highlights import kind_of, rank, select
from dpg_audit.plan.stops import build_stops
from dpg_audit.services.coverage import Coverage
from dpg_audit.services.profile import load_services
from dpg_audit.services.seasons import day_codes

# --- day-by-day opening ----------------------------------------------------------------------------------------


def _day(codes: str, d: date) -> str:
    return codes[(d - date(d.year, 1, 1)).days]


def test_day_codes_follow_the_week():
    codes = day_codes("Mo-Fr 08:00-19:00; Sa 08:00-12:00; Su off", 2027)
    assert codes is not None and len(codes) == 365
    assert _day(codes, date(2027, 10, 15)) == "o"  # a Friday
    assert _day(codes, date(2027, 10, 16)) == "o"  # Saturday morning
    assert _day(codes, date(2027, 10, 17)) == "c"  # Sunday


def test_day_codes_judge_the_daytime_and_unknowns():
    assert set(day_codes("Mo-Su 21:00-23:30", 2027) or "") == {"c"}  # evenings only: closed in the daytime
    assert day_codes("not opening hours at all", 2027) is None
    seasonal = day_codes("Apr-Oct: 09:00-18:00", 2027)
    assert seasonal is not None and _day(seasonal, date(2027, 5, 3)) == "o" and _day(seasonal, date(2027, 1, 4)) == "c"


# --- stops -----------------------------------------------------------------------------------------------------

LAT = 43.0


@pytest.fixture
def path() -> RoutePath:
    lon = np.linspace(0.0, 2.5, 251)  # ~203 km due east
    return RoutePath([MeasuredLine(lon, np.full(lon.size, LAT))])


def at(path: RoutePath, lon: float, service: str, **kw):
    p = place(service, round(path.project(lon, LAT).m, 1), **kw)
    return p.model_copy(update={"lon": lon, "lat": LAT + 0.005, "id": f"{service}-{lon}-{kw.get('kind', 'k')}"})


def test_beds_group_by_town_else_along_the_route(path):
    town = Settlement(lon=0.5, lat=LAT + 0.01, name="Ville", kind="town", name_en="Town")
    places = [
        at(path, 0.49, "accommodation", kind="hotel", months="?" * 12),
        at(path, 0.51, "accommodation", kind="hotel", months="?" * 12),
        at(path, 0.50, "accommodation", kind="campsite", months="cccoooooooocc"[:12]),
        at(path, 0.50, "food"),
        at(path, 0.52, "food"),
        at(path, 0.505, "station", kind="rail", bikes="yes"),
        # Far from any town: two beds 1 km apart make one stop, a third 25 km on makes another.
        at(path, 1.50, "accommodation", kind="guest_house"),
        at(path, 1.512, "accommodation", kind="guest_house"),
        at(path, 1.80, "accommodation", kind="hostel"),
        at(path, 2.00, "accommodation", kind="hotel", counts=False),  # outside the counting limits: no stop
    ]
    coverage = Coverage(places, load_services("services-v0"), path.length)
    stops = build_stops(path, places, [town], coverage, 2027).stops
    assert [s.name for s in stops] == ["Ville", None, None]
    ville = stops[0]
    assert ville.name_en == "Town"  # for finding it by its English name (D104)
    assert {b.kind: b.count for b in ville.beds} == {"campsite": 1, "hotel": 2}
    camp = next(b for b in ville.beds if b.kind == "campsite")
    assert camp.seasons == [("cccoooooooocc"[:12], 1)]
    assert ville.services["food"] == 2 and ville.station is not None
    assert (ville.lon, ville.lat) == (0.5, LAT + 0.01)  # the town's own position
    assert {b.kind: b.count for b in stops[1].beds} == {"guest_house": 2}
    assert stops[2].station is None
    assert len({s.id for s in stops}) == 3
    # Each place to stay knows its own town, for map searches; beds near no town have none.
    assert {p.detail.get("town") for p in places if p.service == "accommodation" and p.lon < 1} == {"Ville"}
    assert all("town" not in p.detail for p in places if p.service == "accommodation" and p.lon > 1)


def test_a_town_passed_twice_is_a_stop_on_each_pass(path):
    # A loop starts and ends in Ville: its beds come on both passes, 190 km apart along the route (D110).
    town = Settlement(lon=0.5, lat=LAT + 0.01, name="Ville", kind="town", name_en=None)
    beds = [place("accommodation", m, kind="hotel") for m in (10_000.0, 11_000.0, 200_000.0, 201_000.0)]
    beds = [b.model_copy(update={"lon": 0.5, "lat": LAT, "id": f"bed-{i}"}) for i, b in enumerate(beds)]
    coverage = Coverage(beds, load_services("services-v0"), path.length)
    stops = build_stops(path, beds, [town], coverage, 2027).stops
    assert [(s.name, round(s.at_m / 1000)) for s in stops] == [("Ville", 10), ("Ville", 200)]


# --- effort across a gap ---------------------------------------------------------------------------------------


def test_a_sections_last_height_is_its_own_across_a_gap():
    # Two sections 20 km apart, the first at 10 m, the next at 1,000 m: EV8's Menton – Ventimiglia before Limone.
    # The first section's profile ends at 10 m, not at the next one's start (D110).
    a = MeasuredLine(np.linspace(0.0, 0.1, 50), np.full(50, LAT))
    b = MeasuredLine(np.linspace(0.35, 0.45, 50), np.full(50, LAT))
    tracks = [TrackInput(1, "A", None, None, NOT_RATED, a, 0), TrackInput(2, "B", None, None, NOT_RATED, b, 1)]
    build = assemble(Route(id="user:x", network="user", ref="x", name="x", official_url=None), tracks)
    profs = elevation.profiles(build.path, lambda lon, lat: np.where(lon < 0.2, 10.0, 1000.0), [])
    first, second = build_effort(build, profs, [], []).parts
    assert first.ele[-1] == 10 and set(first.ele) == {10}
    assert second.ele[0] == 1000
    assert sum(first.up) == 0 and sum(first.down) == 0


def test_steps_add_up_to_the_sections_climbing():
    # A hilly section with small wiggles: its steps' climbing adds up to the audit's own figure, both ways (D110).
    lon = np.linspace(0.0, 0.5, 400)  # ~40 km
    line = MeasuredLine(lon, np.full(lon.size, LAT))
    build = assemble(
        Route(id="user:x", network="user", ref="x", name="x", official_url=None),
        [TrackInput(1, "A", None, None, NOT_RATED, line, 0)],
    )
    hills = lambda lon, lat: 200 + 150 * np.sin(lon * 40) + 2 * np.sin(lon * 3000)  # noqa: E731
    profs = elevation.profiles(build.path, hills, [])
    (part,) = build_effort(build, profs, [], []).parts
    # Over the profile's own extent: resampled, its last sample can sit a few cm past the measured end.
    up, down = elevation.ascent_descent(profs, 0.0, float(profs[0].m[-1]))
    assert len(part.up) == len(part.surface)
    assert sum(part.up) == pytest.approx(up, abs=0.1) and sum(part.down) == pytest.approx(down, abs=0.1)


# --- effort ----------------------------------------------------------------------------------------------------


def test_surface_letters_use_dreams_three_classes():
    assert surface_letter("ferry", None) == "f"
    assert surface_letter("quiet_road", "gravel") == "g"
    assert surface_letter("cycleway", "asphalt") == "c"
    assert surface_letter("unmatched", None) == "u"
    assert surface_letter(None, None) == "u"
    assert surface_letter("busy_road", "asphalt") == "r"


# --- highlights ------------------------------------------------------------------------------------------------


def test_highlight_kinds_and_ranks():
    assert kind_of({"tourism": "viewpoint"}) == "viewpoint"
    assert kind_of({"historic": "castle"}) == "castle"
    assert kind_of({"heritage": "1"}) == "heritage"
    assert kind_of({"natural": "peak", "mountain_pass": "yes"}) == "pass"
    assert kind_of({"amenity": "bench"}) is None
    assert rank("castle", unesco=True, linked=False, offset_m=900) == 1.0
    assert rank("castle", unesco=False, linked=True, offset_m=900) > rank("castle", False, False, 900)


def test_highlights_kept_near_the_route_once_each(path):
    raw = [
        {"id": "osm:n1", "kind": "viewpoint", "name": "Belvedere", "lon": 0.3, "lat": LAT + 0.005},
        {"id": "osm:w2", "kind": "viewpoint", "name": "Belvedere", "lon": 0.3005, "lat": LAT + 0.005},  # same one
        {"id": "osm:n3", "kind": "castle", "name": "Far castle", "lon": 0.6, "lat": LAT + 0.05},  # ~5.5 km off
        {"id": "osm:n4", "kind": "peak", "name": "Pic", "lon": 0.9, "lat": LAT + 0.015},  # 1.7 km: peaks reach 2 km
    ]
    for r in raw:
        r.update(ele=None, wikidata=None, wikipedia=None, unesco=False)
    kept = select(path, raw)
    assert [h.name for h in kept] == ["Belvedere", "Pic"]


# --- holiday dates ---------------------------------------------------------------------------------------------


def test_calendar_dates_with_their_year(tmp_path):
    oh = tmp_path / "openholidays"
    oh.mkdir()
    (oh / "countries.json").write_text(json.dumps([{"isoCode": "XX"}]))
    (oh / "publicholidays-XX-2027.json").write_text(
        json.dumps(
            [
                {"startDate": "2027-10-12", "endDate": "2027-10-12", "nationwide": True,
                 "name": [{"language": "EN", "text": "National Day"}]},
                {"startDate": "2027-05-01", "endDate": "2027-05-01", "nationwide": False,
                 "subdivisions": [{"code": "XX-A"}], "name": [{"language": "EN", "text": "Local Day"}]},
            ]
        )
    )
    for y in (2027, 2026, 2025):
        (oh / f"schoolholidays-XX-{y}.json").write_text("[]")
    src = CrowdingSource(tmp_path, 2027)
    cal = src.calendar("XX", src.covered())
    missing = src.calendar("YY", src.covered())
    src.close()
    assert cal.public_year == 2027 and [h.date for h in cal.public] == ["2027-05-01", "2027-10-12"]
    assert cal.public[0].regions == ["XX-A"] and cal.public[1].nationwide
    assert cal.school_year is None and cal.school == []  # nothing published: no data, not "no holidays" (D37)
    assert missing.public_year is None and missing.public == []


def test_wikidata_sitelinks_become_articles_by_language_and_commons():
    from dpg_audit.plan.wiki import languages

    arts, commons = languages(
        {
            "frwiki": {"title": "Château de Bielle"},
            "euwiki": {"title": "Bielleko gaztelua"},
            "zh_yuewiki": {"title": "x"},
            "commonswiki": {"title": "Category:Château de Bielle"},
            "frwikivoyage": {"title": "not an article"},
            "specieswiki": {"title": "not an article"},
        }
    )
    assert arts == {"eu": "Bielleko gaztelua", "fr": "Château de Bielle", "zh-yue": "x"}
    assert commons == "Category:Château de Bielle"
