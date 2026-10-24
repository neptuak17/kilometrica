"""The facts a route's description is written from (D89), kept in the manifest's summary so the route picker needs no
Dream file. Dream writes the words; this only gathers and picks: the countries in order, climbing, the landscapes,
the best months, the surfaces, and a few sights spread along the route."""

import re
from collections import Counter, defaultdict

from dpg_audit.models import (
    DailySection,
    DevelopmentLevel,
    DreamFile,
    DreamSection,
    Highlight,
    HighlightsFile,
    OverviewCountry,
    OverviewSight,
    RouteOverview,
    StatusShare,
)

STRONG = 0.5
"""A landscape counts where its Dream score is at least this (11.4's "strong here")."""
LANDSCAPES = ("coast", "water", "wine")
UNESCO_MAX = 4
PASSES_MAX = 3
SAME_PLACE_M = 20_000.0
"""Two sights this close are one place on the route (the Sagrada Família and Casa Milà)."""
TOP_RANK = 0.8
KINDS_MIN = 5
KINDS_MAX = 2
VAGUE_KINDS = {"attraction", "peak", "pass", "beach", "viewpoint", "gallery"}
"""Kinds too vague or too common to say "along the way"; passes are named on their own."""
_KM_NAME = re.compile(r"^km\s*\d", re.IGNORECASE)


def _name(n: str | None) -> str | None:
    """A town's name, or nothing for a placeholder like "km 960"."""
    return n.strip() if n and n.strip() and not _KM_NAME.match(n.strip()) else None


def _climb(s: DreamSection) -> tuple[float, float] | None:
    """Climbing as the route runs and the length it was measured on, or None where the terrain is unknown."""
    up = s.ascent_fwd_m if s.ascent_fwd_m is not None else s.ascent_known_fwd_m
    known = s.length_m - s.climb_unknown_m
    return None if up is None or known <= 0 else (up, known)


def _per_km(secs: list[DreamSection]) -> tuple[float | None, float | None]:
    parts = [c for c in map(_climb, secs) if c is not None]
    if not parts:
        return None, None
    up, known = sum(c[0] for c in parts), sum(c[1] for c in parts)
    return round(up), round(up / (known / 1000), 1)


def _best_time(secs: list[DreamSection]) -> list[float | None]:
    out: list[float | None] = []
    for m in range(12):
        known = [(s.best_time[m], s.length_m) for s in secs if len(s.best_time) == 12 and s.best_time[m] is not None]
        weight = sum(w for _, w in known)
        out.append(round(sum(v * w for v, w in known) / weight, 1) if weight else None)  # type: ignore[operator]
    return out


def _articles(h: Highlight) -> int:
    return len(h.articles)


def _spread(found: list[Highlight], length_m: float, most: int) -> list[Highlight]:
    """One per stretch of the route first (the best known in each), then the best known left, never two at one place."""
    chosen: list[Highlight] = []

    def free(h: Highlight) -> bool:
        return all(abs(h.at_m - c.at_m) >= SAME_PLACE_M for c in chosen)

    ranked = sorted(found, key=lambda h: (-_articles(h), h.at_m))
    for q in range(most):
        lo, hi = length_m * q / most, length_m * (q + 1) / most
        best = next((h for h in ranked if lo <= h.at_m < hi and free(h)), None)
        if best:
            chosen.append(best)
    for h in ranked:
        if len(chosen) >= most:
            break
        if h not in chosen and free(h):
            chosen.append(h)
    return sorted(chosen, key=lambda h: h.at_m)


def _sight(h: Highlight, name: str) -> OverviewSight:
    return OverviewSight(name=name, kind=h.kind, wikidata=h.wikidata, at_m=round(h.at_m, 1))


def build_overview(
    daily: list[DailySection],
    dream: DreamFile,
    highlights: HighlightsFile | None,
    status: list[StatusShare],
) -> RouteOverview:
    secs = sorted(dream.sections, key=lambda s: s.from_m)
    days = sorted(daily, key=lambda d: d.from_m)
    length = sum(s.length_m for s in secs)

    by_country: dict[str, list[DreamSection]] = defaultdict(list)
    for s in secs:
        by_country[s.country or "?"].append(s)
    countries = []
    for cc, own in by_country.items():
        if cc == "?":
            continue
        countries.append(
            OverviewCountry(
                cc=cc,
                length_m=round(sum(s.length_m for s in own), 1),
                climb_per_km=_per_km(own)[1],
                best_time=_best_time(own),
            )
        )

    def strong_m(k: str) -> float:
        return round(sum(s.length_m for s in secs if (t := s.themes.get(k)) and (t.score or 0) >= STRONG), 1)

    strong = {k: strong_m(k) for k in LANDSCAPES}
    strong["protected"] = round(sum(s.protected_share * s.length_m for s in secs), 1)

    surfaces: Counter[str] = Counter()
    for s in secs:
        for k, v in s.surfaces.items():
            surfaces[k] += v * s.length_m

    found = highlights.highlights if highlights else []
    world = [h for h in found if h.unesco and h.articles.get("en")]
    unesco = [_sight(h, h.articles["en"]) for h in _spread(world, length, UNESCO_MAX)]
    known_passes = sorted((h for h in found if h.kind == "pass" and h.articles), key=lambda h: (-_articles(h), h.at_m))
    passes: list[Highlight] = []
    for h in known_passes:
        if len(passes) < PASSES_MAX and all(abs(h.at_m - p.at_m) >= SAME_PLACE_M for p in passes):
            passes.append(h)
    kinds = Counter(h.kind for h in found if h.rank >= TOP_RANK and h.kind not in VAGUE_KINDS)

    rated = [x for x in status if x.development != DevelopmentLevel.NOT_RATED]
    climb, per_km = _per_km(secs)
    return RouteOverview(
        start=_name(days[0].start_name) if days else None,
        end=_name(days[-1].end_name) if days else None,
        length_m=round(length, 1),
        countries=countries,
        climb_m=climb,
        climb_per_km=per_km,
        strong_m=strong,
        unesco=unesco,
        unesco_count=len({h.wikidata or h.id for h in found if h.unesco}),
        passes=[_sight(h, h.articles.get("en") or h.name) for h in sorted(passes, key=lambda h: h.at_m)],
        sight_kinds=[k for k, n in kinds.most_common(KINDS_MAX) if n >= KINDS_MIN],
        surfaces_m={k: round(v, 1) for k, v in surfaces.most_common()},
        best_time=_best_time(secs),
        undeveloped_m=round(sum(x.length_m for x in rated if x.development == DevelopmentLevel.UNDEVELOPED_UNKNOWN), 1)
        if rated
        else None,
        remote_m=round(sum(s.remote_share * s.length_m for s in secs), 1),
        longest_remote_m=round(max((s.longest_remote_m for s in secs), default=0.0), 1),
        busy_m=round(sum(s.busy_share * s.length_m for s in secs), 1),
        ferries=sum(1 for b in dream.breaks if b.type == "ferry"),
    )
