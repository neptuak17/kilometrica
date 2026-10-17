"""Paths and runtime settings. Everything is overridable by environment variables."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    """Root of raw/, cache/, work/ and bundles/. Defaults to <repo>/data."""
    return Path(os.environ.get("DPG_DATA_DIR", REPO_ROOT / "data")).resolve()


def work_dir(root: Path, network: str, ref: str) -> Path:
    """Per-route working area for derived, re-creatable data (corridor, OSM cut, matching cache, ...)."""
    return root / "work" / network / ref.lower()


PROJECT_URL = "https://github.com/neptuak17/kilometrica"


def user_agent() -> str:
    """HTTP User-Agent with a contact, as Wikimedia and other providers ask (without one, Wikidata answers 429).
    The project's page by default; set DPG_CONTACT (e.g. an email) to use another."""
    from dpg_audit import __version__

    contact = os.environ.get("DPG_CONTACT") or PROJECT_URL
    return f"Kilometrica-prototype/{__version__} (+{contact})"
