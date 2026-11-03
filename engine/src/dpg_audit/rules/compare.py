"""Compare the audit's ECS results with ECF's own (D106).

Two checks. The first sets a published certification report's table (transcribed under
engine/profiles/calibration/) beside our shares for the same daily sections. The second sets our essential
infrastructure verdict per daily section beside EuroVelo's published development status. Both re-judge the ECS
criteria from a bundle's own files, so any rules profile can be compared without auditing again.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import yaml

from dpg_audit.models import (
    DailySection,
    DevelopmentLevel,
    DreamFile,
    EventsFile,
    HighlightsFile,
    MinorFile,
    PlacesFile,
    ScoresFile,
    SectionScores,
    SectionsFile,
)
from dpg_audit.rules import ecs
from dpg_audit.rules.profile import PROFILES_DIR, RulesProfile
from dpg_audit.services.coverage import Coverage
from dpg_audit.services.profile import load_services

CALIBRATION_DIR = PROFILES_DIR / "calibration"
TIER_NAMES = {"essential": "E", "important": "I", "additional": "A"}


@dataclass
class Judged:
    """A bundle's daily sections, re-judged under one rules profile."""

    daily: list[DailySection]
    sections: list[SectionScores]
    result: ecs.EcsResult
    profile: RulesProfile

    def by_number(self) -> dict[int, DailySection]:
        return {d.number: d for d in self.daily}


def _read(bundle: Path, name: str, model):
    return model.model_validate(json.loads((bundle / name).read_text(encoding="utf-8")))


def current_bundle(data_dir: Path, network: str, ref: str, private: bool = False) -> Path:
    route = data_dir / "bundles" / ("private" if private else "") / network / ref.lower()
    run = json.loads((route / "current.json").read_text(encoding="utf-8"))["run_id"]
    return route / run


def judge(bundle: Path, profile: RulesProfile) -> Judged:
    sections = _read(bundle, "sections.json", SectionsFile)
    events = _read(bundle, "events.json", EventsFile).events
    scores = _read(bundle, "scores.json", ScoresFile)
    places = _read(bundle, "places.json", PlacesFile).places
    minor = _read(bundle, "minor.json", MinorFile)
    highlights = _read(bundle, "highlights.json", HighlightsFile).highlights
    dream = _read(bundle, "dream.json", DreamFile)
    length = scores.route.to_m
    points = minor.points
    inputs = ecs.EcsInputs(
        events=events,
        daily=sections.daily,
        components=sections.components,
        length_m=length,
        sections=scores.sections,
        coverage=Coverage(places, load_services(), length),
        barriers=[(p.at_m, p.kind) for p in points if p.kind in ("blocks", "dismount", "narrow")],
        rest_areas=[p.at_m for p in points if p.kind == "rest_area"],
        charging=[p.at_m for p in points if p.kind == "charging"],
        highlights=highlights,
        themes={s.number: {k: v.score for k, v in s.themes.items()} for s in dream.sections},
    )
    result = ecs.evaluate(profile, inputs)
    stats = [s.model_copy(deep=True) for s in scores.sections]
    route = scores.route.model_copy(deep=True)
    ecs.apply_shares(result, route, stats)
    return Judged(daily=sections.daily, sections=stats, result=result, profile=profile)


def _over(track: list[ecs.Run], m0: float, m1: float) -> dict[str, float]:
    return ecs._Shares(track).over(m0, m1)


def failing(judged: Judged, m0: float, m1: float, tier: str) -> list[tuple[str, float]]:
    """Criteria of `tier` failing over [m0, m1], with the share of the stretch they fail on, largest first."""
    total = max(m1 - m0, 1e-9)
    out = []
    for c in judged.result.minor.criteria:
        if c.tier != tier or not c.checked:
            continue
        runs = [(r.from_m, r.to_m, r.result) for r in judged.result.minor.tracks[c.id]]
        share = _over(runs, m0, m1)["fail"] / total
        if share > 0.005:
            out.append((c.id, share))
    return sorted(out, key=lambda t: -t[1])


@dataclass
class RowResult:
    row: dict
    ours: dict[str, dict[str, float]]
    """tier -> {pass, fail, unknown} share"""
    why: dict[str, list[tuple[str, float]]]
    notes: dict[str, str]


def compare_rows(calibration: dict, judged: list[Judged]) -> list[RowResult]:
    out = []
    for row in calibration["rows"]:
        numbers = row["sections"]
        found = next((j for j in judged if all(n in j.by_number() for n in numbers)), None)
        if found is None:
            raise ValueError(f"sections {numbers} ({row['start']} – {row['stop']}) are in none of the bundles")
        days = [found.by_number()[n] for n in numbers]
        m0, m1 = days[0].from_m, days[-1].to_m
        total = max(m1 - m0, 1e-9)
        ours = {}
        for tier, track in found.result.tier_tracks.items():
            lens = _over(track, m0, m1)
            ours[tier] = {k: lens[k] / total for k in ("pass", "fail", "unknown")}
        why = {t: failing(found, m0, m1, t) for t in ecs.TIERS}
        notes: dict[str, str] = {}
        for s in found.sections:
            if s.number in numbers:
                for cid, note in s.notes.items():
                    notes.setdefault(cid, note if len(numbers) == 1 else f"{s.number}: {note}")
        out.append(RowResult(row=row, ours=ours, why=why, notes=notes))
    return out


def _pct(x: float) -> str:
    return f"{round(x * 100):d}%"


def report(calibration: dict, results: dict[str, list[RowResult]]) -> str:
    """Markdown: a summary per profile, then a table per profile with the reasons behind our failures."""
    lines = [
        f"# ECS comparison: {calibration['route']}",
        "",
        f"ECF's results: {calibration['source']} (published {calibration['published']}, surveyed under "
        f"{calibration['criteria_edition']}). Ours: re-judged from the current bundles. Shares are of each row's "
        "length; ours leave out the criteria the audit doesn't check, and an unknown is not a pass.",
        "",
    ]
    for pid, rows in results.items():
        lines += [f"## {pid}", ""]
        for tier in ecs.TIERS:
            diffs = [abs(r.ours[tier]["pass"] - r.row[tier]) for r in rows]
            theirs_full = [r.row[tier] >= 0.995 for r in rows]
            ours_full = [r.ours[tier]["pass"] >= 0.995 for r in rows]
            same = sum(a == b for a, b in zip(theirs_full, ours_full, strict=True))
            within = sum(d <= 0.10 for d in diffs)
            lines.append(
                f"- **{tier.capitalize()}:** average difference {sum(diffs) / len(diffs) * 100:.0f} points; "
                f"within 10 points on {within} of {len(rows)} rows; the same verdict on meeting it in full on "
                f"{same} of {len(rows)} (ECF {sum(theirs_full)}, ours {sum(ours_full)})."
            )
        lines += [
            "",
            "| GPX | Daily section | ECF status | ECF E / I / A | Ours E / I / A | Unknown E / I / A "
            "| Why ours fails |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in rows:
            row = r.row
            theirs = " / ".join(_pct(row[t]) for t in ecs.TIERS)
            ours = " / ".join(_pct(r.ours[t]["pass"]) for t in ecs.TIERS)
            unknown = " / ".join(_pct(r.ours[t]["unknown"]) for t in ecs.TIERS)
            reasons = []
            for t in ecs.TIERS:
                for cid, share in r.why[t][:3]:
                    note = r.notes.get(cid)
                    reasons.append(f"{cid} {_pct(share)}" + (f" ({note})" if note else ""))
            nums = "+".join(str(n) for n in row["sections"])
            lines.append(
                f"| {nums} | {row['start']} – {row['stop']} ({row['km']} km) | {row['status']} | {theirs} | {ours} | "
                f"{unknown} | {'; '.join(reasons) or '–'} |"
            )
        lines.append("")
    return "\n".join(lines)


def load_calibration(name: str) -> dict:
    return yaml.safe_load((CALIBRATION_DIR / f"{name}.yaml").read_text(encoding="utf-8"))


INFRASTRUCTURE_ESSENTIAL = ("continuity", "traffic", "surface", "climbing", "signing")


def status_check(judged: Judged) -> dict[str, dict[str, int]]:
    """EuroVelo's development status per daily section against our verdict on the essential infrastructure criteria:
    'meets' (all of the section), 'fails' (any of it), 'unknown' (no failure, some unknown)."""
    crit = {c.id: c for c in judged.result.minor.criteria}
    ids = [c for c in INFRASTRUCTURE_ESSENTIAL if c in crit and crit[c].checked and crit[c].tier == "essential"]
    track = ecs.worst([[(r.from_m, r.to_m, r.result) for r in judged.result.minor.tracks[cid]] for cid in ids])
    table: dict[str, dict[str, int]] = {}
    for d in judged.daily:
        lens = _over(track, d.from_m, d.to_m)
        verdict = "fails" if lens["fail"] > 1.0 else "unknown" if lens["unknown"] > 1.0 else "meets"
        status = d.status.development.value if d.status.development != DevelopmentLevel.UNRECOGNISED else "other"
        row = table.setdefault(status, {"meets": 0, "fails": 0, "unknown": 0})
        row[verdict] += 1
    return table
