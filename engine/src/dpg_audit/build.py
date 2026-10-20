"""Assemble an ordered list of section tracks into one measured route path, with data-quality findings.

Network-agnostic: network adapters (e.g. networks/eurovelo.py) turn their source files into `TrackInput`s.
"""

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from dpg_audit.lrs import MeasuredLine, RoutePath
from dpg_audit.lrs.geodesy import distance
from dpg_audit.lrs.index import use_projection_for
from dpg_audit.lrs.sections import runs
from dpg_audit.models import (
    Component,
    ComponentKind,
    DailySection,
    DevelopmentLevel,
    EuroVeloStatus,
    Finding,
    LonLat,
    Route,
    RouteSummary,
    Severity,
    StatusSection,
    StatusShare,
)


@dataclass
class TrackInput:
    number: int
    title: str
    start_name: str | None
    end_name: str | None
    status: EuroVeloStatus
    line: MeasuredLine
    source_index: int


@dataclass(frozen=True)
class BuildParams:
    join_tolerance_m: float = 50.0
    """Section ends closer than this are treated as continuous."""
    gap_warning_m: float = 1000.0
    reverse_penalty_m: float = 200.0
    """A track is only flipped if that shortens the joins by more than this."""
    straight_caution_m: float = 2000.0
    straight_warning_m: float = 5000.0
    sparse_median_spacing_m: float = 120.0
    main_join_m: float = 5000.0
    """A section continues the main line if one of its ends is this close to the main line's end (D65)."""
    variant_near_m: float = 3000.0
    """A section that doesn't continue the main line but comes this close to the route already placed is another way
    along a stretch already covered, e.g. the other bank (D65); farther away, it is the main line after a gap."""


@dataclass
class RouteBuild:
    route: Route
    components: list[Component]
    daily: list[DailySection]
    status_sections: list[StatusSection]
    findings: list[Finding]
    path: RoutePath
    lines: list[MeasuredLine]
    """Oriented ride lines, one per daily section, in path order."""
    params: BuildParams = field(default_factory=BuildParams)

    def summary(self) -> RouteSummary:
        total = self.path.length
        by_status: Counter[tuple[DevelopmentLevel, object]] = Counter()
        for d, part in zip(self.daily, self.path.parts, strict=True):
            by_status[(d.status.development, d.status.signage)] += part.line.length
        gaps = [c for c in self.components if c.kind == ComponentKind.GAP]
        return RouteSummary(
            ride_length_m=round(total, 1),
            daily_section_count=len(self.daily),
            gap_count=len(gaps),
            gap_straight_distance_m=round(sum(c.straight_distance_m or 0.0 for c in gaps), 1),
            status_breakdown=[
                StatusShare(development=dev, signage=sig, length_m=round(length, 1), share=length / total)
                for (dev, sig), length in sorted(by_status.items(), key=lambda kv: -kv[1])
            ],
        )


def _ends(line: MeasuredLine) -> tuple[LonLat, LonLat]:
    return (float(line.lon[0]), float(line.lat[0])), (float(line.lon[-1]), float(line.lat[-1]))


def _dist(a: LonLat, b: LonLat) -> float:
    return distance(a[0], a[1], b[0], b[1])


def choose_orientations(ends: list[tuple[LonLat, LonLat]], reverse_penalty_m: float) -> list[bool]:
    """For each track, whether to reverse it so the chain of joins is shortest (Viterbi over 2 states)."""
    n = len(ends)
    if n == 0:
        return []
    # state 0 = as stored (enter at start, exit at end), state 1 = reversed
    cost = np.zeros((n, 2))
    back = np.zeros((n, 2), dtype=int)
    cost[0] = [0.0, reverse_penalty_m]
    for i in range(1, n):
        for b in (0, 1):
            entry = ends[i][b]
            options = [cost[i - 1][a] + _dist(ends[i - 1][1 - a], entry) for a in (0, 1)]
            a = int(np.argmin(options))
            back[i][b] = a
            cost[i][b] = options[a] + (reverse_penalty_m if b else 0.0)
    states = [int(np.argmin(cost[-1]))]
    for i in range(n - 1, 0, -1):
        states.append(int(back[i][states[-1]]))
    return [bool(s) for s in reversed(states)]


def _haversine(lon: float, lat: float, lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    lon1, lat1, lon2, lat2 = np.radians(lon), np.radians(lat), np.radians(lons), np.radians(lats)
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6_371_008.8 * 2 * np.arcsin(np.sqrt(a))


def split_variants(tracks: list[TrackInput], params: BuildParams) -> tuple[list[TrackInput], list[list[TrackInput]]]:
    """The main line and the other ways along it (D65), from sections in published order.

    Some routes publish both banks of a river as their own sections: one bank's run, then the numbering jumps back
    up the river for the other. A section continues the main line when one end is near the main line's end and its
    other end goes somewhere the route hasn't been. One that comes near the route already placed without doing that
    is another way along a covered stretch, set aside; the sections that run on from it belong to it. A section far
    from everything placed is the main line again, after a gap (EV8's ferries)."""
    if not tracks:
        return [], []
    main = [tracks[0]]
    variants: list[list[TrackInput]] = []
    placed: list[TrackInput] = [tracks[0]]
    # Where the main line leaves off: either end of the first section until the second shows its direction.
    exits: list[LonLat] = list(_ends(tracks[0].line))

    def nearest(e: LonLat, among: list[TrackInput]) -> float:
        if not among:
            return float("inf")
        lons = np.concatenate([p.line.lon for p in among])
        lats = np.concatenate([p.line.lat for p in among])
        return float(_haversine(e[0], e[1], lons, lats).min())

    for t in tracks[1:]:
        ends = _ends(t.line)
        last = main[-1]
        to_main = [min(_dist(e, x) for x in exits) for e in ends]
        # Somewhere new: away from the route placed so far, leaving out the section it follows on from.
        before = [p for p in placed if p is not last]
        new = [nearest(e, before) > params.variant_near_m for e in ends]
        joins = [to_main[k] <= params.main_join_m and new[1 - k] for k in (0, 1)]
        far = all(nearest(e, placed) > params.variant_near_m for e in ends)
        if any(joins) or far:
            main.append(t)
            # It leaves by its other end; after a gap, by the end farther from where the main line left off.
            entry = 0 if joins[0] else 1 if joins[1] else int(to_main[1] < to_main[0])
            exits = [ends[1 - entry]]
        elif variants and variants[-1][-1].number == t.number - 1:
            variants[-1].append(t)
        else:
            variants.append([t])
        placed.append(t)
    return main, variants


class _Findings:
    def __init__(self) -> None:
        self.items: list[Finding] = []

    def add(self, **kwargs) -> None:
        kwargs.setdefault("evidence", {})
        for k in ("from_m", "to_m"):
            kwargs[k] = round(kwargs[k], 1)
        self.items.append(Finding(id=f"f{len(self.items) + 1:04d}", **kwargs))


def _km(m: float) -> str:
    return f"{m / 1000:.1f} km"


def assemble(route: Route, tracks: list[TrackInput], params: BuildParams | None = None) -> RouteBuild:
    params = params or BuildParams()
    if not tracks:
        raise ValueError("no tracks to assemble")
    findings = _Findings()

    tracks = sorted(tracks, key=lambda t: t.number)
    numbers = [t.number for t in tracks]
    if len(set(numbers)) != len(numbers) or numbers != list(range(numbers[0], numbers[0] + len(numbers))):
        findings.add(
            rule_id="source.section_numbering",
            category="data_quality",
            severity=Severity.CAUTION,
            from_m=0.0,
            to_m=0.0,
            title="Daily section numbers are not a simple sequence",
            detail="Sections were ordered by their published number; check for missing or duplicate numbers.",
            evidence={"numbers": numbers},
            confidence="high",
        )

    # Other ways along a stretch already covered are set aside: one line is audited and planned (D65).
    tracks, variants = split_variants(tracks, params)
    # Every distance from here on is measured in a projection that suits where the route is (D68).
    use_projection_for(np.concatenate([t.line.lon for t in tracks]), np.concatenate([t.line.lat for t in tracks]))

    flips = choose_orientations([_ends(t.line) for t in tracks], params.reverse_penalty_m)
    lines = [t.line.reversed() if flip else t.line for t, flip in zip(tracks, flips, strict=True)]
    path = RoutePath(lines)

    components: list[Component] = []
    daily: list[DailySection] = []
    for i, (track, line, flip, part) in enumerate(zip(tracks, lines, flips, path.parts, strict=True)):
        start, end = _ends(line)
        if i > 0:
            prev_end = _ends(lines[i - 1])[1]
            join = _dist(prev_end, start)
            if join > params.join_tolerance_m:
                components.append(
                    Component(
                        id=f"c{len(components) + 1:03d}",
                        seq=len(components),
                        kind=ComponentKind.GAP,
                        from_m=round(part.from_m, 1),
                        to_m=round(part.from_m, 1),
                        length_m=0.0,
                        straight_distance_m=round(join, 1),
                        start=prev_end,
                        end=start,
                    )
                )
                big = join >= params.gap_warning_m
                findings.add(
                    rule_id="source.gap_between_sections",
                    category="data_quality",
                    severity=Severity.WARNING if big else Severity.INFO,
                    from_m=part.from_m,
                    to_m=part.from_m,
                    position=prev_end,
                    title=f"No track for {_km(join)} between sections {tracks[i - 1].number} and {track.number}"
                    if big
                    else f"Small break of {join:.0f} m between sections {tracks[i - 1].number} and {track.number}",
                    detail="The published track stops and restarts elsewhere. Likely a ferry, a public-transport "
                    "link or a missing piece of track; it will be classified against ferry and rail data in M1."
                    if big
                    else "The two section ends do not quite meet; usually harmless digitising noise.",
                    evidence={
                        "straight_distance_m": round(join, 1),
                        "from_section": tracks[i - 1].number,
                        "to_section": track.number,
                    },
                    confidence="high",
                )
        components.append(
            Component(
                id=f"c{len(components) + 1:03d}",
                seq=len(components),
                kind=ComponentKind.RIDE,
                from_m=round(part.from_m, 1),
                to_m=round(part.to_m, 1),
                length_m=round(line.length, 1),
                daily_section=track.number,
                start=start,
                end=end,
            )
        )
        daily.append(
            DailySection(
                id=f"d{track.number:03d}",
                number=track.number,
                title=track.title,
                start_name=track.start_name,
                end_name=track.end_name,
                from_m=round(part.from_m, 1),
                to_m=round(part.to_m, 1),
                length_m=round(line.length, 1),
                status=track.status,
                reversed_in_source=flip,
                point_count=len(line),
                start=start,
                end=end,
            )
        )

        if flip:
            stored_start, stored_end = _ends(track.line)
            findings.add(
                rule_id="source.section_reversed",
                category="data_quality",
                severity=Severity.INFO,
                from_m=part.from_m,
                to_m=part.to_m,
                position=start,
                title=f"Section {track.number} is stored end-to-start",
                detail="The track's points run against the direction of the route, so it was flipped to join "
                "its neighbours.",
                evidence={"stored_start": stored_start, "stored_end": stored_end},
                confidence="high",
            )

        if track.status.development == DevelopmentLevel.UNRECOGNISED:
            findings.add(
                rule_id="source.status_unrecognised",
                category="data_quality",
                severity=Severity.WARNING,
                from_m=part.from_m,
                to_m=part.to_m,
                position=start,
                title=f"Unrecognised status label on section {track.number}",
                detail=f"Label '{track.status.label}' does not match any known development level.",
                confidence="high",
            )

        for j in np.nonzero(line.seg_len >= params.straight_caution_m)[0]:
            seg = float(line.seg_len[j])
            mid = line.locate(float(line.cum[j]) + seg / 2)
            findings.add(
                rule_id="source.straight_segment",
                category="data_quality",
                severity=Severity.WARNING if seg >= params.straight_warning_m else Severity.CAUTION,
                from_m=part.from_m + float(line.cum[j]),
                to_m=part.from_m + float(line.cum[j + 1]),
                position=mid,
                title=f"{_km(seg)} straight line in section {track.number}",
                detail="The published track has no points along this stretch, so the real ridden line is unknown. "
                "Distance, climbing and nearby services here are approximate until the line is matched to the map.",
                evidence={"segment_length_m": round(seg, 1)},
                confidence="high",
            )

        if line.seg_len.size and float(np.median(line.seg_len)) > params.sparse_median_spacing_m:
            findings.add(
                rule_id="source.sparse_points",
                category="data_quality",
                severity=Severity.INFO,
                from_m=part.from_m,
                to_m=part.to_m,
                position=start,
                title=f"Section {track.number} geometry is heavily simplified",
                detail=f"Median spacing between points is {float(np.median(line.seg_len)):.0f} m; the line may cut "
                "corners, under-measuring distance and smoothing out climbs.",
                evidence={"median_spacing_m": round(float(np.median(line.seg_len)), 1)},
                confidence="medium",
            )

    status_sections: list[StatusSection] = []
    for group in runs(daily, key=lambda d: (d.status.development, d.status.signage)):
        status_sections.append(
            StatusSection(
                id=f"s{len(status_sections) + 1:02d}",
                from_m=group[0].from_m,
                to_m=group[-1].to_m,
                length_m=round(group[-1].to_m - group[0].from_m, 1),
                status=group[0].status,
                daily_sections=[d.number for d in group],
            )
        )
    for s in status_sections:
        dev = s.status.development
        if dev not in (DevelopmentLevel.PARTIALLY_DEVELOPED, DevelopmentLevel.UNDEVELOPED_UNKNOWN):
            continue
        first, last = s.daily_sections[0], s.daily_sections[-1]
        where = f"section {first}" if first == last else f"sections {first}–{last}"
        partial = dev == DevelopmentLevel.PARTIALLY_DEVELOPED
        findings.add(
            rule_id="eurovelo.partially_developed" if partial else "eurovelo.undeveloped",
            category="route",
            severity=Severity.CAUTION if partial else Severity.WARNING,
            from_m=s.from_m,
            to_m=s.to_m,
            position=path.locate(s.from_m),
            title=f"{_km(s.length_m)} {'partially developed' if partial else 'undeveloped or unknown'} ({where})",
            detail="EuroVelo rates this stretch as partially developed: expect parts with heavier traffic and no "
            "cycling infrastructure, or rough tracks."
            if partial
            else "EuroVelo has no reliable information on this stretch, or it is not developed for cycling. It may "
            "include busy or dangerous roads; EuroVelo advises using public transport to skip such stretches.",
            evidence={"status": s.status.label, "daily_sections": s.daily_sections},
            confidence="medium",
        )

    # Each way set aside is noted where it leaves and rejoins the main line (D65).
    for group in variants:
        ends = [_ends(t.line) for t in group]
        points = [e for pair in ends for e in pair]
        on_main = sorted(path.project(lon, lat).m for lon, lat in points)
        a, b = group[0].number, group[-1].number
        names = [n for n in (group[0].start_name, group[-1].end_name) if n]
        length = sum(t.line.length for t in group)
        findings.add(
            rule_id="source.variant_set_aside",
            category="data_quality",
            severity=Severity.INFO,
            from_m=on_main[0],
            to_m=on_main[-1],
            position=points[0],
            title=f"Another way along here: section{'s' if a != b else ''} {a}{f'–{b}' if a != b else ''}"
            + (f", {' – '.join(names)}" if names else "")
            + f" ({_km(length)}), not audited",
            detail="The route publishes a second way along this stretch, usually the other bank of a river. One line "
            "is audited and planned; this way is set aside for now.",
            evidence={"daily_sections": [t.number for t in group], "length_m": round(length, 1)},
            confidence="high",
        )

    findings.items.sort(key=lambda f: (f.from_m, f.to_m))
    for k, f in enumerate(findings.items):
        f.id = f"f{k + 1:04d}"
    return RouteBuild(
        route=route,
        components=components,
        daily=daily,
        status_sections=status_sections,
        findings=findings.items,
        path=path,
        lines=lines,
        params=params,
    )
