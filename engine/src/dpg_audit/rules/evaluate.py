"""Summarise layers and climbing per stretch: the whole route, or one daily section. The ECS criteria are judged in
rules/ecs.py (D106)."""

from bisect import bisect_right
from collections import defaultdict

from dpg_audit.layers import elevation
from dpg_audit.models import Event, SectionScores, StretchStats


class LayerIndex:
    """Fast 'how much of each value lies between m0 and m1' queries over non-overlapping events of one layer."""

    def __init__(self, events: list[Event]):
        self.events = sorted(events, key=lambda e: e.from_m)
        self.starts = [e.from_m for e in self.events]

    def lengths(self, m0: float, m1: float) -> dict[str, float]:
        out: dict[str, float] = defaultdict(float)
        i = max(bisect_right(self.starts, m0) - 1, 0)
        while i < len(self.events) and self.events[i].from_m < m1:
            e = self.events[i]
            overlap = min(e.to_m, m1) - max(e.from_m, m0)
            if overlap > 0:
                out[e.value] += overlap
            i += 1
        return out


def stretch_stats(
    m0: float,
    m1: float,
    events: list[Event],
    profs: list[elevation.PartProfile] | None,
    unknown: list[tuple[float, float]] | None = None,
) -> StretchStats:
    """Layer shares and climbing over a stretch; the ECS shares are added later (rules/ecs.py).
    `unknown`: path ranges whose terrain is unknown (long placeholders, see elevation.unknown_terrain)."""
    total = max(m1 - m0, 1e-9)
    shares: dict[str, dict[str, float]] = {}
    for layer in sorted({e.layer for e in events}):
        lens = LayerIndex([e for e in events if e.layer == layer]).lengths(m0, m1)
        shares[layer] = {k: round(v / total, 4) for k, v in sorted(lens.items(), key=lambda kv: -kv[1])}
    ascent = descent = max_grade = None
    unknown_m = elevation.overlap(unknown or [], m0, m1)
    if profs:
        if (m1 - m0) - unknown_m >= elevation.KNOWN_CLIMB_MIN_M:
            up, down = elevation.ascent_descent(profs, m0, m1, exclude=unknown)
            ascent, descent = round(up), round(down)
        else:
            unknown_m = m1 - m0  # too little real terrain to measure: unknown, not 0 (D37)
        max_grade = elevation.max_grade_window(profs, m0, m1)
    else:
        unknown_m = m1 - m0
    return StretchStats(
        from_m=round(m0, 1),
        to_m=round(m1, 1),
        ascent_m=ascent,
        descent_m=descent,
        climb_unknown_m=round(unknown_m, 1),
        max_grade_500m=max_grade,
        shares=shares,
    )


def section_scores(daily, events, profs, unknown=None) -> list[SectionScores]:
    return [
        SectionScores(number=d.number, **stretch_stats(d.from_m, d.to_m, events, profs, unknown).model_dump())
        for d in daily
    ]
