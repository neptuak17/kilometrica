"""Wikipedia articles in every language, and Commons photo galleries, for highlights (11.6, after the owner's review).

OSM's `wikipedia` tag names one article in whichever language the mapper chose (in the Pyrenees, French, Catalan or
Basque), and a bare Wikidata page tells a rider little. The Wikidata item behind a highlight lists its articles in
every language and its Wikimedia Commons gallery. These are looked up here, in the batch audit, so the rider's
device can link to the article in the rider's own language without asking anyone (D30): nothing is fetched until
the rider taps.

Wikidata is CC0. Answers are cached per item for RECHECK_DAYS, in a cache kept by item, not by route (D25).
"""

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from dpg_audit.config import user_agent
from dpg_audit.models import Licence, SourceSnapshot

API = "https://www.wikidata.org/w/api.php"
BATCH = 50
RECHECK_DAYS = 90
NOT_WIKIPEDIA = {
    "commonswiki",
    "specieswiki",
    "metawiki",
    "wikidatawiki",
    "mediawikiwiki",
    "sourceswiki",
    "outreachwiki",
    "wikimaniawiki",
    "foundationwiki",
    "incubatorwiki",
    "wikifunctionswiki",
    "testwiki",
}
WIKIPEDIA_KEY = re.compile(r"^([a-z_]+)wiki$")
LICENCE = Licence(id="CC0-1.0", name="Creative Commons CC0 (Wikidata)", url="https://www.wikidata.org/wiki/Wikidata:Licensing")


def languages(sitelinks: dict[str, dict]) -> tuple[dict[str, str], str | None]:
    """Wikipedia articles by language code (e.g. 'fr', 'zh-yue'), and the Commons page, from an item's sitelinks."""
    articles = {}
    for key, link in sitelinks.items():
        m = WIKIPEDIA_KEY.match(key)
        if m and key not in NOT_WIKIPEDIA and link.get("title"):
            articles[m.group(1).replace("_", "-")] = link["title"]
    commons = sitelinks.get("commonswiki", {}).get("title")
    return dict(sorted(articles.items())), commons


class WikiLinks:
    def __init__(self, cache_path: Path, log: Callable[[str], None] = print):
        self.path = cache_path
        self.log = log
        self.cache: dict[str, dict] = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
        self.client = httpx.Client(timeout=30, headers={"User-Agent": user_agent()})
        self.fetched = 0

    def close(self) -> None:
        self.client.close()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.cache), encoding="utf-8")

    def _get(self, params: dict) -> dict:
        r = self.client.get(API, params={**params, "format": "json", "props": "sitelinks"})
        r.raise_for_status()
        self.fetched += 1
        return r.json().get("entities", {})

    def _store(self, entities: dict, now: str) -> None:
        for qid, e in entities.items():
            if qid.startswith("Q"):
                arts, commons = languages(e.get("sitelinks", {}))
                self.cache[qid] = {"articles": arts, "commons": commons, "checked": now}

    def resolve(self, items: list[tuple[str | None, str | None]]) -> list[tuple[str | None, dict | None]]:
        """For (wikidata, wikipedia) tag pairs: the item id and its links. Unknown or unreachable: (id, None)."""
        now = datetime.now(UTC)
        stamp = now.isoformat(timespec="seconds")
        fresh = now - timedelta(days=RECHECK_DAYS)
        qids: list[str | None] = []
        by_title: dict[str, list[tuple[int, str]]] = {}
        for i, (qid, wp) in enumerate(items):
            if qid and re.fullmatch(r"Q\d+", qid):
                qids.append(qid)
            elif wp and ":" in wp:
                lang, title = wp.split(":", 1)
                by_title.setdefault(lang, []).append((i, title))
                qids.append(None)
            else:
                qids.append(None)
        try:
            # Articles known only by their title: find the item through that language's Wikipedia.
            for lang, pairs in by_title.items():
                for k in range(0, len(pairs), BATCH):
                    chunk = pairs[k : k + BATCH]
                    titles = "|".join(t for _, t in chunk)
                    ents = self._get({"action": "wbgetentities", "sites": f"{lang}wiki", "titles": titles})
                    self._store(ents, stamp)
                    site = f"{lang}wiki"
                    found = {e["sitelinks"].get(site, {}).get("title"): q for q, e in ents.items() if q.startswith("Q")}
                    for i, title in chunk:
                        qids[i] = found.get(title) or found.get(title.replace("_", " "))
            def stale_or_new(q: str) -> bool:
                return q not in self.cache or datetime.fromisoformat(self.cache[q]["checked"]) < fresh

            stale = sorted({q for q in qids if q and stale_or_new(q)})
            for k in range(0, len(stale), BATCH):
                self._store(self._get({"action": "wbgetentities", "ids": "|".join(stale[k : k + BATCH])}), stamp)
        except httpx.HTTPError as e:
            self.log(f"Wikidata unreachable ({type(e).__name__}): highlights keep their OSM links only")
        return [(q, self.cache.get(q) if q else None) for q in qids]

    def snapshot(self, data_dir: Path, items: int) -> SourceSnapshot:
        return SourceSnapshot(
            id="wikidata",
            title=f"Wikidata sitelinks for {items} highlights ({self.fetched} requests this run)",
            url=API,
            retrieved_at=datetime.now(UTC),
            file=self.path.relative_to(data_dir).as_posix() if self.path.is_relative_to(data_dir) else str(self.path),
            sha256="n/a (cached API responses)",
            bytes=self.path.stat().st_size if self.path.exists() else 0,
            licence=LICENCE,
            attribution="Links to Wikipedia and Wikimedia Commons: Wikidata (CC0)",
        )
