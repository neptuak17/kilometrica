"""Load rules profiles and route-specific configuration (YAML under engine/profiles/)."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from dpg_audit.config import REPO_ROOT
from dpg_audit.layers.gaps import CuratedGap
from dpg_audit.models import Criterion, GapType

PROFILES_DIR = REPO_ROOT / "engine" / "profiles"
DEFAULT_RULES = "ecs-2026"


@dataclass
class RulesProfile:
    id: str
    title: str
    source: str
    criteria: dict[str, dict[str, Any]]
    findings: dict[str, Any]
    pad_point_m: float = 200.0
    """A failure at a point (a barrier, a flight of steps) fails at least this length: ECS's shortest segment."""

    def criterion_info(self) -> list[Criterion]:
        return [
            Criterion(
                id=cid,
                title=c["title"],
                tier=c["tier"],
                group=c["group"],
                basis=c["basis"],
                checked=c["rule"] != "not_checked",
                description=" ".join(c["description"].split()),
            )
            for cid, c in self.criteria.items()
        ]


@dataclass
class RouteConfig:
    route: str
    gaps: list[CuratedGap] = field(default_factory=list)


def load_rules(name: str = DEFAULT_RULES, folder: Path = PROFILES_DIR) -> RulesProfile:
    raw = yaml.safe_load((folder / f"{name}.yaml").read_text(encoding="utf-8"))
    return RulesProfile(
        id=raw["id"],
        title=raw["title"],
        source=raw["source"],
        criteria=raw["criteria"],
        findings=raw.get("findings", {}),
        pad_point_m=float(raw.get("pad_point_m", 200)),
    )


def load_route_config(network: str, ref: str, folder: Path = PROFILES_DIR / "routes") -> RouteConfig:
    path = folder / f"{network}-{ref.lower()}.yaml"
    if not path.exists():
        return RouteConfig(route=f"{network}:{ref.lower()}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    gaps = [
        CuratedGap(after_section=int(g["after_section"]), type=GapType(g["type"]), note=g.get("note", ""))
        for g in raw.get("gaps", [])
    ]
    return RouteConfig(route=raw.get("route", f"{network}:{ref.lower()}"), gaps=gaps)
