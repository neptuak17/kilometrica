"""Check the websites that come from Overture before Plan links to them (11.6, after the owner's review).

OpenStreetMap's websites proved reliable. Overture's (mostly from Meta and Foursquare) often aren't: a sample along
the Pyrenees route found dead domains, pages that are gone, servers' default pages, directory front pages and a
wedding-venue listing. So every Overture website for a place to stay is fetched once (cached by URL for
RECHECK_DAYS) and kept only when it answers with the place's own site. Each kept link records when it was checked.

A site that refuses automated requests (401, 403, 429) is kept: it exists, we just can't look. If most checks in a
batch fail to connect, well-known sites are tried: when they fail too, the network is down and nothing is judged.
(A batch of sites that really are gone fails just as much, so the failure rate alone can't tell.)
"""

import json
import re
import threading
from collections import defaultdict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import httpx

from dpg_audit.config import user_agent

RECHECK_DAYS = 30
TIMEOUT_S = 12.0
RETRY_TIMEOUT_S = 30.0
TIMEOUTS = {"ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout"}
"""Failures retried once, more patiently, before a site counts as dead."""
READ_BYTES = 64_000
PER_HOST = 2
"""At most this many requests at once to one host."""
SAVE_EVERY = 500
CONTROL_URLS = ("https://www.wikipedia.org/", "https://www.cloudflare.com/", "https://www.openstreetmap.org/")


def network_up(client: httpx.Client) -> bool:
    for url in CONTROL_URLS:
        status, _, _, error = _fetch(client, url)
        if error is None and status is not None and status < 500:
            return True
    return False

# Booking sites, directories and maps: not the place's own site (affiliate links may come later, D41).
DIRECTORY_DOMAINS = {
    "booking.com",
    "airbnb.com",
    "airbnb.fr",
    "airbnb.es",
    "airbnb.it",
    "airbnb.de",
    "airbnb.co.uk",
    "tripadvisor.com",
    "tripadvisor.fr",
    "tripadvisor.es",
    "tripadvisor.it",
    "expedia.com",
    "hotels.com",
    "agoda.com",
    "trivago.com",
    "kayak.com",
    "vrbo.com",
    "abritel.fr",
    "homeaway.com",
    "hostelworld.com",
    "mariages.net",
    "venez.fr",
    "pagesjaunes.fr",
    "yelp.com",
    "google.com",
    "goo.gl",
    "maps.app.goo.gl",
}
DEFAULT_PAGE = re.compile(
    r"apache2 (debian|ubuntu) default page|welcome to nginx|<title>\s*it works!?\s*</title>|"
    r"this domain (is|may be) for sale|buy this domain|domain is parked|sedoparking|parkingcrew|"
    r"hugedomains|this site is under construction|index of /",
    re.I,
)
SECOND_LEVEL = {"co", "com", "org", "net", "gov", "ac", "edu", "gob", "nom"}


def registrable(host: str) -> str:
    """example.co.uk -> example.co.uk, www.hotel.fr -> hotel.fr (a small heuristic, no public suffix list)."""
    parts = host.lower().removeprefix("www.").split(".")
    if len(parts) >= 3 and parts[-2] in SECOND_LEVEL and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def normal_url(url: str) -> str:
    url = url.strip()
    return url if re.match(r"^https?://", url, re.I) else f"http://{url}"


@dataclass
class Check:
    url: str
    verdict: str
    """ok, blocked (refuses robots; kept), dead, moved, default_page, directory, unreachable (network down)"""
    status: int | None
    final_url: str | None
    checked: str
    error: str | None = None
    """Why a fetch failed (e.g. ConnectError), when it did."""


def judge(url: str, status: int | None, final_url: str | None, head: str, error: str | None) -> str:
    """The verdict for one fetch. Pure, for testing."""
    host = urlparse(normal_url(url)).netloc
    if registrable(host) in DIRECTORY_DOMAINS:
        return "directory"
    if error is not None:
        return "dead"
    if status in (401, 403, 429):
        return "blocked"
    if status is None or status >= 400:
        return "dead"
    if final_url and registrable(urlparse(final_url).netloc) != registrable(host):
        final = registrable(urlparse(final_url).netloc)
        return "directory" if final in DIRECTORY_DOMAINS else "moved"
    if DEFAULT_PAGE.search(head):
        return "default_page"
    return "ok"


KEEP = {"ok", "blocked"}


def _fetch(
    client: httpx.Client, url: str, timeout: float = TIMEOUT_S
) -> tuple[int | None, str | None, str, str | None]:
    try:
        with client.stream("GET", normal_url(url), timeout=timeout) as r:
            data = b""
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) >= READ_BYTES:
                    break
            return r.status_code, str(r.url), data.decode("utf-8", "ignore"), None
    except Exception as e:  # noqa: BLE001 - any failure (bad URL, TLS, network) means no usable site
        return None, None, "", type(e).__name__


def check_websites(
    urls: Iterable[str],
    cache_path: Path,
    *,
    workers: int = 16,
    now: datetime | None = None,
    log: Callable[[str], None] = print,
) -> dict[str, Check]:
    """A verdict per URL, from the cache when it is recent enough. Network-down runs judge nothing."""
    now = now or datetime.now(UTC)
    cache: dict[str, dict] = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    fresh = now - timedelta(days=RECHECK_DAYS)
    out: dict[str, Check] = {}
    todo: list[str] = []
    for u in sorted(set(urls)):
        hit = cache.get(u)
        # A failure cached before reasons were kept may have been a timeout: check it again, patiently.
        unexplained = hit is not None and hit["verdict"] == "dead" and hit["status"] is None and not hit.get("error")
        if hit and not unexplained and datetime.fromisoformat(hit["checked"]) >= fresh:
            out[u] = Check(**hit)
        elif registrable(urlparse(normal_url(u)).netloc) in DIRECTORY_DOMAINS:
            out[u] = Check(u, "directory", None, None, now.isoformat(timespec="seconds"))
        else:
            todo.append(u)
    if not todo:
        return out
    log(f"checking {len(todo):,} Overture websites ({len(out):,} known) …")
    locks: dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(PER_HOST))
    guard = threading.Lock()
    headers = {"User-Agent": f"Mozilla/5.0 (compatible; {user_agent()}; link check)"}
    with httpx.Client(timeout=TIMEOUT_S, follow_redirects=True, headers=headers, verify=True) as client:

        def one(u: str) -> Check:
            host = urlparse(normal_url(u)).netloc.lower()
            with guard:
                sem = locks[host]
            with sem:
                status, final, head, error = _fetch(client, u)
                if error in TIMEOUTS:  # slow, not necessarily gone: one more, patient try
                    status, final, head, error = _fetch(client, u, RETRY_TIMEOUT_S)
            verdict = judge(u, status, final, head, error)
            return Check(u, verdict, status, final, now.isoformat(timespec="seconds"), error)

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # In chunks, saving after each, so an interrupted run keeps what it has checked.
            for k in range(0, len(todo), SAVE_EVERY):
                results = list(pool.map(one, todo[k : k + SAVE_EVERY]))
                unreachable = sum(r.verdict == "dead" and r.status is None for r in results)
                if len(results) >= 20 and unreachable / len(results) > 0.5 and not network_up(client):
                    log(f"website check: {unreachable} of {len(results)} unreachable; the network looks down, so "
                        "nothing more is judged")
                    for u in todo[k:]:
                        out[u] = Check(u, "unreachable", None, None, now.isoformat(timespec="seconds"))
                    return out
                for r in results:
                    out[r.url] = r
                    cache[r.url] = asdict(r)
                cache_path.write_text(json.dumps(cache), encoding="utf-8")
                log(f"  {min(k + SAVE_EVERY, len(todo)):,} of {len(todo):,} checked")
    return out


def shared_homepages(sites: list[tuple[str, str | None]], min_places: int = 3) -> set[str]:
    """URLs that are just a domain's front page and are given for `min_places` or more differently named places
    (e.g. one association's homepage for nine of its campsites): not any one place's own site."""
    by_domain: dict[str, set[str]] = defaultdict(set)
    for url, name in sites:
        parsed = urlparse(normal_url(url))
        if parsed.path in ("", "/") and not parsed.query:
            by_domain[registrable(parsed.netloc)].add((name or "").lower())
    shared = {d for d, names in by_domain.items() if len(names) >= min_places}
    out = set()
    for u, _ in sites:
        parsed = urlparse(normal_url(u))
        if parsed.path in ("", "/") and not parsed.query and registrable(parsed.netloc) in shared:
            out.add(u)
    return out
