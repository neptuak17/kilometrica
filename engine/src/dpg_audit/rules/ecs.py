"""The ECS rules (D106): each criterion's results along the route, the tiers they add up to, and their shares.

A criterion judged along the route (`basis: route`) gives runs from the layers, the places or the barriers; one
judged per daily section gives one result that applies to the whole section. Every track covers the route from 0
to its length with pass, fail, unknown or not_checked. Tiers are cumulative, as in ECS: a stretch meets
"important" only where it also meets "essential".
"""

from bisect import bisect_left, bisect_right
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np

from dpg_audit.lrs import RoutePath
from dpg_audit.lrs.index import RouteIndex
from dpg_audit.models import (
    Component,
    ComponentKind,
    CriterionRun,
    CriterionShare,
    DailySection,
    EcsPoint,
    Event,
    GapType,
    Highlight,
    MinorFile,
    SectionScores,
    Signage,
    StretchStats,
    TierSegment,
)
from dpg_audit.rules.evaluate import LayerIndex
from dpg_audit.rules.profile import RulesProfile
from dpg_audit.services.coverage import TOILET_FOOD_KINDS, Coverage
from dpg_audit.services.policy import CARRIED

Run = tuple[float, float, str]
TIERS = ("essential", "important", "additional")
NOT_KNOWN = {"unknown", "unmatched"}
_RANK = {"not_checked": 0, "pass": 1, "unknown": 2, "fail": 3}
_LABEL = {"very_high": "very high", "high": "high", "moderate": "moderate", "low": "low"}
MEALS = {"restaurant", "cafe", "fast_food", "bar"}
POINT_REACH_M = 500.0
"""Rest areas and charging stations count within this straight-line distance of the route."""
BARRIER_REACH_M = 50.0
"""Barrier nodes on a matched way count where they lie this close to the route."""


# --- runs -----------------------------------------------------------------------------------------------------


def merge(runs: Iterable[Run]) -> list[Run]:
    out: list[Run] = []
    for a, b, r in runs:
        if b - a <= 1e-6:
            continue
        if out and out[-1][2] == r and abs(out[-1][1] - a) < 1e-6:
            out[-1] = (out[-1][0], b, r)
        else:
            out.append((a, b, r))
    return out


def fill(runs: Iterable[Run], m0: float, m1: float, default: str = "unknown") -> list[Run]:
    """Sorted, non-overlapping runs extended to cover [m0, m1], gaps taking `default`."""
    out: list[Run] = []
    pos = m0
    for a, b, r in sorted(runs):
        a, b = max(a, pos), min(b, m1)
        if b <= a:
            continue
        if a > pos:
            out.append((pos, a, default))
        out.append((a, b, r))
        pos = b
    if pos < m1:
        out.append((pos, m1, default))
    return merge(out)


def overlay(tracks: Sequence[list[Run]]) -> list[tuple[float, float, tuple[str, ...]]]:
    """Cut full-length tracks at every boundary of any of them: (from, to, (result of each track))."""
    points = sorted({p for t in tracks for a, b, _ in t for p in (a, b)})
    idx = [0] * len(tracks)
    out = []
    for a, b in zip(points, points[1:], strict=False):
        if b - a <= 1e-6:
            continue
        mid = (a + b) / 2
        results = []
        for k, t in enumerate(tracks):
            i = idx[k]
            while i < len(t) - 1 and t[i][1] <= mid:
                i += 1
            idx[k] = i
            results.append(t[i][2])
        out.append((a, b, tuple(results)))
    return out


def worst(tracks: Sequence[list[Run]]) -> list[Run]:
    if len(tracks) == 1:
        return tracks[0]
    return merge((a, b, max(rs, key=_RANK.__getitem__)) for a, b, rs in overlay(tracks))


def intervals(points: Iterable[float], pad_m: float, length: float) -> list[tuple[float, float]]:
    """Points as intervals at least `pad_m` long (ECS's shortest segment), merged where they touch."""
    out: list[tuple[float, float]] = []
    for m in sorted(points):
        a, b = max(0.0, m - pad_m / 2), min(length, m + pad_m / 2)
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def padded(runs: list[Run], value: str, pad_m: float, length: float) -> list[tuple[float, float]]:
    """The runs equal to `value`, each at least `pad_m` long."""
    spans = []
    for a, b, r in runs:
        if r != value:
            continue
        if b - a < pad_m:
            mid = (a + b) / 2
            a, b = max(0.0, mid - pad_m / 2), min(length, mid + pad_m / 2)
        spans.append((a, b))
    merged: list[tuple[float, float]] = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def spans_track(spans: list[tuple[float, float]], result: str, length: float) -> list[Run]:
    return fill([(a, b, result) for a, b in spans], 0.0, length, default="pass")


def gap_track(positions: Sequence[float], max_gap_m: float, length: float) -> list[Run]:
    """Pass where the stretch between consecutive places is at most `max_gap_m`, fail elsewhere."""
    edges = [0.0, *sorted(p for p in positions if 0.0 <= p <= length), length]
    return merge((a, b, "pass" if b - a <= max_gap_m else "fail") for a, b in zip(edges, edges[1:], strict=False))


# --- inputs ---------------------------------------------------------------------------------------------------


class Layer:
    def __init__(self, events: list[Event]):
        self.events = sorted(events, key=lambda e: e.from_m)
        self.starts = [e.from_m for e in self.events]
        self.index = LayerIndex(self.events)

    def lengths(self, m0: float, m1: float) -> dict[str, float]:
        return self.index.lengths(m0, m1)

    def runs(self, m0: float, m1: float, fn: Callable[[str], str]) -> list[Run]:
        out: list[Run] = []
        i = max(bisect_right(self.starts, m0) - 1, 0)
        while i < len(self.events) and self.events[i].from_m < m1:
            e = self.events[i]
            a, b = max(e.from_m, m0), min(e.to_m, m1)
            if b > a:
                out.append((a, b, fn(e.value)))
            i += 1
        return fill(out, m0, m1)


@dataclass
class EcsInputs:
    events: list[Event]
    daily: list[DailySection]
    components: list[Component]
    length_m: float
    sections: list[SectionScores]
    """Climbing per daily section (ascent, descent, unknown terrain)."""
    coverage: Coverage
    barriers: list[tuple[float, str]] = field(default_factory=list)
    """(measure, effect): 'blocks', 'dismount' or 'narrow'."""
    rest_areas: list[float] = field(default_factory=list)
    charging: list[float] = field(default_factory=list)
    highlights: list[Highlight] = field(default_factory=list)
    themes: dict[int, dict[str, float | None]] = field(default_factory=dict)
    missing_links: bool = True
    """False for the other ways audited as one line (D106): every break in it is a join of ours."""


def barrier_effect(barrier: str, tags: dict[str, str], min_clearance_m: float = 1.3) -> str | None:
    """What a barrier node means for a cyclist: it stops a bike, forces a dismount, or is narrow (ECS additional)."""
    if tags.get("bicycle") in ("yes", "designated", "permissive"):
        return None
    if tags.get("bicycle") in ("no", "dismount") or tags.get("access") in ("no", "private"):
        return "blocks" if tags.get("bicycle") != "dismount" else "dismount"
    if barrier in ("fence", "wall", "hedge", "ditch", "debris", "jersey_barrier", "block"):
        return "blocks"
    if barrier in ("stile", "turnstile", "full-height_turnstile", "kissing_gate", "horse_stile", "motorcycle_barrier"):
        return "dismount"
    widths = [w for k in ("maxwidth:physical", "maxwidth", "width", "opening") if (w := _metres(tags.get(k)))]
    if barrier == "cycle_barrier":
        return "narrow" if not widths or min(widths) < min_clearance_m else None
    if widths and min(widths) < min_clearance_m:
        return "narrow"
    return None


def _metres(value: str | None) -> float | None:
    try:
        return float(value.replace(",", ".").removesuffix("m").strip()) if value else None
    except ValueError:
        return None


def locate_points(path: RoutePath, points: list[dict], reach_m: float) -> list[tuple[float, dict]]:
    """(measure, point) for points within `reach_m` of the route."""
    if not points:
        return []
    index = RouteIndex(path)
    lon = np.array([p["lon"] for p in points])
    lat = np.array([p["lat"] for p in points])
    near = index.within(lon, lat, reach_m)
    kept = [p for p, ok in zip(points, near, strict=True) if ok]
    if not kept:
        return []
    projs = index.project(np.array([p["lon"] for p in kept]), np.array([p["lat"] for p in kept]))
    return sorted(((pr.m, p) for pr, p in zip(projs, kept, strict=True) if pr.offset_m <= reach_m), key=lambda t: t[0])


# --- the rules ------------------------------------------------------------------------------------------------


class _Context:
    def __init__(self, inputs: EcsInputs, profile: RulesProfile):
        self.inp = inputs
        self.length = inputs.length_m
        self.daily = inputs.daily
        self.pad = profile.pad_point_m
        by_layer: dict[str, list[Event]] = {}
        for e in inputs.events:
            by_layer.setdefault(e.layer, []).append(e)
        self.layers = {k: Layer(v) for k, v in by_layer.items()}
        self.starts = [d.from_m for d in self.daily]
        self.stats = {s.number: s for s in inputs.sections}

    def layer(self, name: str) -> Layer:
        return self.layers.get(name) or Layer([])

    def section_of(self, m: float) -> DailySection:
        return self.daily[max(bisect_right(self.starts, m) - 1, 0)]

    def per_section(self, results: dict[int, str]) -> list[Run]:
        return fill(((d.from_m, d.to_m, results.get(d.number, "unknown")) for d in self.daily), 0.0, self.length)

    def places(self, name: str) -> list[float]:
        cov = self.inp.coverage

        def pos(places) -> list[float]:
            return sorted(p.access_at_m for p in places)

        food = cov.own("food")
        if name == "accommodation":
            return pos(cov.own("accommodation"))
        if name == "rooms":
            return pos(p for p in cov.own("accommodation") if p.kind != "campsite")
        if name == "food":
            return pos(food)
        if name == "warm_meal":
            return pos(p for p in food if p.kind in ("restaurant", "bar"))
        if name == "repair":
            return pos(cov.own("bike_shop") + cov.own("repair_station"))
        if name == "bike_shop":
            return pos(cov.own("bike_shop"))
        if name == "toilets":
            return pos(cov.own("toilets") + [p for p in food if p.kind in TOILET_FOOD_KINDS])
        if name == "water":
            return pos(cov.own("water") + food)
        if name == "food_or_rest":
            return sorted(pos(p for p in food if p.kind in MEALS) + self.inp.rest_areas)
        if name == "rest_area":
            return sorted(self.inp.rest_areas)
        if name == "charging":
            return sorted(self.inp.charging)
        raise ValueError(f"unknown place group {name!r}")


Rule = Callable[[dict, _Context], tuple[list[Run], dict[int, str]]]


def _km(m: float) -> str:
    return f"{m / 1000:.1f} km"


def _traffic(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    forbid, half, tol = set(cfg["forbid"]), cfg["max_half"], float(cfg.get("tolerance", 0.0))
    layer = ctx.layer("ecs_traffic")
    route: list[Run] = []
    sec: dict[int, str] = {}
    notes: dict[int, str] = {}
    for d in ctx.daily:
        length = max(d.to_m - d.from_m, 1e-9)
        lens = layer.lengths(d.from_m, d.to_m)
        bad_m = sum(lens.get(c, 0.0) for c in forbid)
        tolerated = tol > 0 and bad_m <= tol * length

        def fn(v: str, tolerated=tolerated) -> str:
            if v in NOT_KNOWN:
                return "unknown"
            return "fail" if v in forbid and not tolerated else "pass"

        route += layer.runs(d.from_m, d.to_m, fn)
        half_m, unknown_m = lens.get(half, 0.0), sum(lens.get(v, 0.0) for v in NOT_KNOWN)
        sec[d.number] = "fail" if half_m > 0.5 * length else "unknown" if half_m + unknown_m > 0.5 * length else "pass"
        parts = [f"{_LABEL[half]} traffic on {half_m / length:.0%}"]
        if bad_m:
            worse = " or ".join(_LABEL[c] for c in sorted(forbid, key=list(_LABEL).index))
            parts.append(f"{worse} on {_km(bad_m)}" + (" (within the 1% tolerance)" if tolerated else ""))
        if unknown_m:
            parts.append(f"unknown on {_km(unknown_m)}")
        notes[d.number] = "; ".join(parts) + " (volumes estimated from road class)"
    return worst([fill(route, 0.0, ctx.length), ctx.per_section(sec)]), notes


def _surface_everywhere(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    ok, bad = set(cfg["pass"]) | {"na"}, set(cfg["fail"])
    layer = ctx.layer(cfg["layer"])
    track = layer.runs(0.0, ctx.length, lambda v: "pass" if v in ok else "fail" if v in bad else "unknown")
    notes = {}
    for d in ctx.daily:
        lens = layer.lengths(d.from_m, d.to_m)
        failed = sum(lens.get(v, 0.0) for v in bad)
        unknown = sum(v for k, v in lens.items() if k not in ok and k not in bad)
        if failed or unknown:
            notes[d.number] = f"fails on {_km(failed)}, unknown on {_km(unknown)}"
    return track, notes


def _surface_share(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    layer = ctx.layer(cfg["layer"])
    classes, maybe = set(cfg["classes"]), set(cfg.get("maybe", NOT_KNOWN))
    sec, notes = {}, {}
    for d in ctx.daily:
        lens = layer.lengths(d.from_m, d.to_m)
        denom = max(d.to_m - d.from_m - lens.get("na", 0.0), 1e-9)
        hit = sum(lens.get(c, 0.0) for c in classes) / denom
        unsure = sum(lens.get(c, 0.0) for c in maybe) / denom
        if "min_share" in cfg:
            need = float(cfg["min_share"])
            sec[d.number] = "pass" if hit >= need else "fail" if hit + unsure < need else "unknown"
        else:
            cap = float(cfg["max_share"])
            sec[d.number] = "fail" if hit > cap else "pass" if hit + unsure <= cap else "unknown"
        notes[d.number] = f"{', '.join(sorted(classes))}: {hit:.0%}" + (f"; unknown {unsure:.0%}" if unsure else "")
    return ctx.per_section(sec), notes


_PUSH = {"dismount", "steps", "steps_ramp"}


def _continuity(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    layer = ctx.layer("ecs_continuity")
    base = layer.runs(0.0, ctx.length, lambda v: "fail" if v == "closed" else "unknown" if v == "unmatched" else "pass")
    blocks = intervals((m for m, effect in ctx.inp.barriers if effect == "blocks"), ctx.pad, ctx.length)
    route = worst([base, spans_track(blocks, "fail", ctx.length)])
    missing: dict[int, list[float]] = {}
    for c in ctx.inp.components:
        if ctx.inp.missing_links and c.kind == ComponentKind.GAP and c.gap_type == GapType.MISSING:
            before, after = ctx.section_of(max(c.from_m - 1.0, 0.0)), ctx.section_of(c.from_m + 1.0)
            # Between sections that don't follow on (the main line skipping the ways it sets aside, D65, or other
            # ways audited as one line), the break is ours, not a missing link of the route.
            if after.number == before.number + 1 or after is before:
                missing.setdefault(before.number, []).append(c.from_m)
    sec, notes = {}, {}
    for d in ctx.daily:
        length = max(d.to_m - d.from_m, 1e-9)
        pushes = [e for e in layer.events if e.value in _PUSH and e.to_m > d.from_m and e.from_m < d.to_m]
        push_m = sum(min(e.to_m, d.to_m) - max(e.from_m, d.from_m) for e in pushes)
        stops = len(pushes) + sum(1 for m, eff in ctx.inp.barriers if eff == "dismount" and d.from_m <= m < d.to_m)
        if d.number in missing:
            sec[d.number] = "fail"
            notes[d.number] = "missing link at " + ", ".join(f"km {m / 1000:.1f}" for m in missing[d.number])
            continue
        if "max_push_share" in cfg:
            ok = push_m <= float(cfg["max_push_share"]) * length
        else:
            ok = stops <= int(cfg["max_dismounts"]) and push_m <= float(cfg["max_push_m"])
        sec[d.number] = "pass" if ok else "fail"
        notes[d.number] = f"{stops} dismounts, {push_m:.0f} m pushing"
    return worst([route, ctx.per_section(sec)]), notes


def _stairs(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    layer = ctx.layer("ecs_continuity")
    raw = layer.runs(0.0, ctx.length, lambda v: v)
    base = merge((a, b, "unknown" if v in NOT_KNOWN else "pass") for a, b, v in raw)
    steps = padded(raw, "steps", ctx.pad, ctx.length)
    return worst([base, spans_track(steps, "fail", ctx.length)]), {}


def _obstacles(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    raw = ctx.layer("ecs_continuity").runs(0.0, ctx.length, lambda v: v)
    base = merge((a, b, "unknown" if v in NOT_KNOWN else "pass") for a, b, v in raw)
    spans = [s for v in (*_PUSH, "closed") for s in padded(raw, v, ctx.pad, ctx.length)]
    spans += intervals((m for m, _ in ctx.inp.barriers), ctx.pad, ctx.length)
    steep = set(cfg["slope_classes"])
    slopes = ctx.layer("gradient").runs(
        0.0, ctx.length, lambda v: "fail" if v in steep else "unknown" if v in NOT_KNOWN else "pass"
    )
    return worst([base, slopes, spans_track(sorted(spans), "fail", ctx.length)]), {}


def _climbing(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    cap = float(cfg["max_m"])
    sec, notes = {}, {}
    for d in ctx.daily:
        s = ctx.stats.get(d.number)
        if s is None or s.ascent_m is None or s.descent_m is None:
            sec[d.number] = "unknown"
            notes[d.number] = "climbing unknown"
            continue
        most = max(s.ascent_m, s.descent_m)
        if s.climb_unknown_m > 0:
            sec[d.number] = "fail" if most > cap else "unknown"
            notes[d.number] = f"at least {s.ascent_m:,.0f} m up, {s.descent_m:,.0f} m down (terrain unknown on part)"
        else:
            sec[d.number] = "pass" if most <= cap else "fail"
            notes[d.number] = f"{s.ascent_m:,.0f} m up, {s.descent_m:,.0f} m down"
    return ctx.per_section(sec), notes


def _signing(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    result = {Signage.SIGNED: "pass", Signage.NOT_SIGNED: "fail", Signage.UNKNOWN: "unknown"}
    sec = {d.number: result[d.status.signage] for d in ctx.daily}
    return ctx.per_section(sec), {d.number: f"published as {d.status.label!r}" for d in ctx.daily}


def _attraction(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    reach, themes, floor = float(cfg["max_offset_m"]), list(cfg["themes"]), float(cfg["min_theme"])
    sec, notes = {}, {}
    for d in ctx.daily:
        notable = [
            h
            for h in ctx.inp.highlights
            if d.from_m <= h.at_m < d.to_m and h.offset_m <= reach and (h.unesco or h.articles or h.wikipedia)
        ]
        strong = [t for t in themes if (ctx.inp.themes.get(d.number, {}).get(t) or 0.0) >= floor]
        if notable or strong:
            sec[d.number] = "pass"
            unesco = [h.name for h in notable if h.unesco]
            named = unesco or [h.name for h in sorted(notable, key=lambda h: -h.rank)]
            bits = [f"{len(notable)} highlights with a Wikipedia article, e.g. {named[0]}"] if notable else []
            notes[d.number] = "; ".join(bits + ([f"strong theme: {', '.join(strong)}"] if strong else []))
        else:
            sec[d.number] = "unknown"
            notes[d.number] = "no evidence in our data (not a failure)"
    return ctx.per_section(sec), notes


def _pt_every(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    cap = float(cfg["max_gap_m"])
    cov = ctx.inp.coverage
    known = [p.access_at_m for p in cov.own("station")]
    maybe = [
        p.access_at_m
        for p in cov.by_service.get("station", [])
        if p.counts and p.detail.get("bikes") in (*CARRIED, "unknown")
    ]
    pieces = overlay([gap_track(known, cap, ctx.length), gap_track(maybe, cap, ctx.length)])
    track = merge((a, b, "pass" if k == "pass" else "unknown" if m == "pass" else "fail") for a, b, (k, m) in pieces)
    return track, {}


def _every(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    return gap_track(ctx.places(cfg["places"]), float(cfg["max_gap_m"]), ctx.length), {}


def _on_section(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    positions = ctx.places(cfg["places"])
    missing = cfg.get("missing", "fail")
    sec, notes = {}, {}
    for d in ctx.daily:
        n = bisect_right(positions, d.to_m) - bisect_left(positions, d.from_m)
        sec[d.number] = "pass" if n else missing
        notes[d.number] = f"{n} found"
    return ctx.per_section(sec), notes


def _not_checked(cfg: dict, ctx: _Context) -> tuple[list[Run], dict[int, str]]:
    return [(0.0, ctx.length, "not_checked")], {}


RULES: dict[str, Rule] = {
    "traffic": _traffic,
    "surface_everywhere": _surface_everywhere,
    "surface_share": _surface_share,
    "continuity": _continuity,
    "stairs": _stairs,
    "obstacles": _obstacles,
    "climbing": _climbing,
    "signing": _signing,
    "attraction": _attraction,
    "pt_every": _pt_every,
    "every": _every,
    "on_section": _on_section,
    "not_checked": _not_checked,
}


# --- evaluation and shares ------------------------------------------------------------------------------------


@dataclass
class EcsResult:
    minor: MinorFile
    notes: dict[int, dict[str, str]]
    tier_tracks: dict[str, list[Run]]


def evaluate(profile: RulesProfile, inputs: EcsInputs) -> EcsResult:
    ctx = _Context(inputs, profile)
    tracks: dict[str, list[Run]] = {}
    notes: dict[int, dict[str, str]] = {d.number: {} for d in inputs.daily}
    for cid, cfg in profile.criteria.items():
        track, section_notes = RULES[cfg["rule"]](cfg, ctx)
        tracks[cid] = track
        for number, note in section_notes.items():
            notes[number][cid] = note
    criteria = profile.criterion_info()
    tier_tracks: dict[str, list[Run]] = {}
    below: list[Run] | None = None
    for tier in TIERS:
        own = [tracks[c.id] for c in criteria if c.tier == tier and c.checked]
        parts = ([below] if below is not None else []) + own
        below = worst(parts) if parts else [(0.0, inputs.length_m, "pass")]
        tier_tracks[tier] = below
    segments = [
        TierSegment(from_m=round(a, 1), to_m=round(b, 1), essential=e, important=i, additional=x)
        for a, b, (e, i, x) in _merge_tuples(overlay([tier_tracks[t] for t in TIERS]))
    ]
    minor = MinorFile(
        rules_profile=profile.id,
        criteria=criteria,
        tracks={
            cid: [CriterionRun(from_m=round(a, 1), to_m=round(b, 1), result=r) for a, b, r in t]  # type: ignore[arg-type]
            for cid, t in tracks.items()
        },
        segments=segments,
        points=sorted(
            [EcsPoint(at_m=round(m, 1), kind=k) for m, k in inputs.barriers]  # type: ignore[arg-type]
            + [EcsPoint(at_m=round(m, 1), kind="rest_area") for m in inputs.rest_areas]
            + [EcsPoint(at_m=round(m, 1), kind="charging") for m in inputs.charging],
            key=lambda p: p.at_m,
        ),
    )
    return EcsResult(minor=minor, notes=notes, tier_tracks=tier_tracks)


def _merge_tuples(pieces: list[tuple[float, float, tuple[str, ...]]]) -> list[tuple[float, float, tuple[str, ...]]]:
    out: list[tuple[float, float, tuple[str, ...]]] = []
    for a, b, rs in pieces:
        if out and out[-1][2] == rs and abs(out[-1][1] - a) < 1e-6:
            out[-1] = (out[-1][0], b, rs)
        else:
            out.append((a, b, rs))
    return out


class _Shares:
    def __init__(self, track: list[Run]):
        self.track = track
        self.starts = [a for a, _, _ in track]

    def over(self, m0: float, m1: float) -> dict[str, float]:
        out = {"pass": 0.0, "fail": 0.0, "unknown": 0.0, "not_checked": 0.0}
        i = max(bisect_right(self.starts, m0) - 1, 0)
        while i < len(self.track) and self.track[i][0] < m1:
            a, b, r = self.track[i]
            overlap = min(b, m1) - max(a, m0)
            if overlap > 0:
                out[r] += overlap
            i += 1
        return out


def _share(lengths: dict[str, float], total: float) -> CriterionShare:
    return CriterionShare(
        passed=round(lengths["pass"] / total, 4),
        failed=round(lengths["fail"] / total, 4),
        unknown=round(lengths["unknown"] / total, 4),
        not_checked=round(lengths["not_checked"] / total, 4),
    )


def apply_shares(result: EcsResult, route: StretchStats, sections: list[SectionScores]) -> None:
    """Fill the criteria and tier shares, the stars and the notes into the scores, in place."""
    crit = {cid: _Shares([(r.from_m, r.to_m, r.result) for r in runs]) for cid, runs in result.minor.tracks.items()}
    tiers = {t: _Shares(track) for t, track in result.tier_tracks.items()}

    def fill_one(s: StretchStats) -> None:
        total = max(s.to_m - s.from_m, 1e-9)
        s.criteria = {cid: _share(sh.over(s.from_m, s.to_m), total) for cid, sh in crit.items()}
        s.tiers = {t: _share(sh.over(s.from_m, s.to_m), total) for t, sh in tiers.items()}
        s.essential_pass = s.tiers["essential"].passed
        s.important_pass = s.tiers["important"].passed
        s.additional_pass = s.tiers["additional"].passed

    fill_one(route)
    for s in sections:
        fill_one(s)
        s.stars = 0
        for t in TIERS:
            if s.tiers[t].passed < 0.9995:
                break
            s.stars += 1
        s.notes = result.notes.get(s.number, {})
