from dpg_audit.dream.overview import build_overview
from dpg_audit.models import (
    DailySection,
    DevelopmentLevel,
    DreamFile,
    DreamSection,
    Highlight,
    HighlightsFile,
    RouteBreak,
    Signage,
    StatusShare,
    ThemeScore,
)


def section(n, cc, *, up=500.0, coast=0.0, best=60.0, gravel=0.0, protected=0.0, remote=0.0):
    return DreamSection.model_construct(
        number=n,
        from_m=(n - 1) * 50_000.0,
        to_m=n * 50_000.0,
        length_m=50_000.0,
        country=cc,
        ascent_fwd_m=up,
        ascent_known_fwd_m=up,
        climb_unknown_m=0.0,
        surfaces={"road": 1.0 - gravel, "gravel": gravel},
        busy_share=0.1,
        themes={"coast": ThemeScore(score=coast, note=""), "water": ThemeScore(score=None, note="")},
        remote_share=remote,
        longest_remote_m=remote * 50_000.0,
        protected_share=protected,
        best_time=[best] * 12,
    )


def day(n, start, end):
    return DailySection.model_construct(number=n, from_m=(n - 1) * 50_000.0, start_name=start, end_name=end)


def sight(at_km, articles, *, unesco=True, kind="heritage", name="x"):
    return Highlight.model_construct(
        id=f"osm:n{at_km}",
        kind=kind,
        name=name,
        at_m=at_km * 1000.0,
        wikidata=f"Q{at_km}",
        articles=articles,
        unesco=unesco,
        rank=1.0,
    )


def test_overview_gathers_the_facts_in_route_order():
    secs = [
        section(1, "ES", coast=0.8, gravel=0.5),
        section(2, "ES", coast=0.8),
        section(3, "FR", up=1500.0, protected=1.0),
    ]
    dream = DreamFile.model_construct(
        sections=list(reversed(secs)),
        breaks=[RouteBreak(after_section=1, type="ferry", straight_distance_m=5000.0, hard=False)],
    )
    status = [
        StatusShare(development=DevelopmentLevel.DEVELOPED, signage=Signage.SIGNED, length_m=100_000.0, share=2 / 3),
        StatusShare(
            development=DevelopmentLevel.UNDEVELOPED_UNKNOWN, signage=Signage.UNKNOWN, length_m=50_000.0, share=1 / 3
        ),
    ]
    o = build_overview([day(1, "Cádiz", "A"), day(3, "B", "km 140")], dream, None, status)
    assert (o.start, o.end) == ("Cádiz", None)
    assert [(c.cc, c.length_m) for c in o.countries] == [("ES", 100_000.0), ("FR", 50_000.0)]
    assert o.countries[1].climb_per_km == 30.0
    assert (o.climb_m, o.climb_per_km) == (2500, 16.7)
    assert o.strong_m["coast"] == 100_000.0
    assert o.strong_m["protected"] == 50_000.0
    assert o.surfaces_m["gravel"] == 25_000.0
    assert o.undeveloped_m == 50_000.0
    assert o.ferries == 1
    assert o.busy_m == 15_000.0


def test_a_route_without_a_rating_has_no_undeveloped_length():
    dream = DreamFile.model_construct(sections=[section(1, "CA")], breaks=[])
    status = [StatusShare(development=DevelopmentLevel.NOT_RATED, signage=Signage.UNKNOWN, length_m=1.0, share=1.0)]
    assert build_overview([day(1, "Vancouver", "Hope")], dream, None, status).undeveloped_m is None


def test_world_heritage_sites_are_spread_along_the_route_and_never_two_at_one_place():
    secs = [section(n, "ES") for n in range(1, 9)]  # 400 km: quarters of 100 km
    found = [
        sight(60, {"en": "Arc de Berà"}),
        sight(15, {"en": "Sagrada Família", "fr": "a", "de": "b"}),  # best known in the first quarter
        sight(18, {"en": "Casa Milà", "fr": "a"}),  # 3 km from the Sagrada Família
        sight(150, {"fr": "Nice"}),  # no English name
        sight(390, {"en": "Ephesus", "de": "c"}),
        sight(200, {"en": "Pass", "de": "d"}, unesco=False, kind="pass", name="Col"),
        sight(250, {}, unesco=False, kind="castle"),
    ]
    o = build_overview([], DreamFile.model_construct(sections=secs, breaks=[]), HighlightsFile(highlights=found), [])
    assert [s.name for s in o.unesco] == ["Sagrada Família", "Arc de Berà", "Ephesus"]
    assert o.unesco_count == 5
    assert [p.name for p in o.passes] == ["Pass"]
    assert o.sight_kinds == ["heritage"]  # five heritage sites stand out; one castle doesn't
