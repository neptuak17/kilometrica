"""Services and access (M2): places from OSM and Overture, conflated, located on the route, routed and scored."""

import hashlib
import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz

from dpg_audit.build import RouteBuild
from dpg_audit.layers import elevation
from dpg_audit.lrs.index import RouteIndex
from dpg_audit.match.valhalla import Valhalla
from dpg_audit.models import Place, PlacesFile, ServicesFile, SourceSnapshot
from dpg_audit.services import conflate as cf
from dpg_audit.services.access import ACCESS_VERSION, AccessJob, compute_access, job_key
from dpg_audit.services.coverage import Coverage
from dpg_audit.services.osm_places import RawPlace, read_osm_places
from dpg_audit.services.policy import BikePolicy, CountryLookup
from dpg_audit.services.profile import ServicesProfile
from dpg_audit.services.seasons import UNKNOWN, day_codes, month_codes, season_known
from dpg_audit.services.weblinks import KEEP, check_websites, shared_homepages
from dpg_audit.sources import dem, official, osm, overture

BLOCK_M = 50_000.0
DAY_SERVICES = {"food", "bike_shop", "pharmacy"}
"""Services whose day-by-day opening Plan uses (11.6)."""
DETAIL_TAGS = ("website", "contact:website", "phone", "contact:phone", "stars", "brand", "operator", "fee", "tents")


@dataclass
class ServicesResult:
    places: list[Place]
    file: PlacesFile
    coverage: Coverage
    sources: list[SourceSnapshot]
    counts: dict[str, int]


def _hash(*parts: object) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _place_elevation(lon: np.ndarray, lat: np.ndarray, root: Path) -> np.ndarray:
    """Lowest DEM value within ~30 m of each place, so roofs and trees don't count as climbing."""
    dlat = 30 / 111_320
    dlon = dlat / np.maximum(np.cos(np.radians(lat)), 0.2)
    offsets = ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1))
    # One call, so every DEM tile is read once.
    flat = dem.sample(
        np.concatenate([lon + ox * dlon for ox, _ in offsets]),
        np.concatenate([lat + oy * dlat for _, oy in offsets]),
        root,
    )
    stack = flat.reshape(len(offsets), -1)
    with np.errstate(all="ignore"):
        return np.where(np.all(np.isnan(stack), axis=0), np.nan, np.nanmin(stack, axis=0))


def _detail(primary: RawPlace, members: list[RawPlace]) -> dict:
    tags = primary.tags
    out: dict = {k.removeprefix("contact:"): tags[k] for k in DETAIL_TAGS if tags.get(k)}
    if out.get("website"):
        out["website_source"] = primary.source  # Overture's are checked before Plan links to them (weblinks)
    datasets = sorted({d for m in members for d in m.datasets})
    if datasets:
        out["datasets"] = datasets
    scores = [m.confidence for m in members if m.confidence is not None]
    if scores:
        out["overture_confidence"] = round(max(scores), 2)
    if any(m.tags.get("overture:status") == "temporarily_closed" for m in members):
        out["temporarily_closed"] = True
    if tags.get("seasonal"):
        out["seasonal"] = tags["seasonal"]
    return out


def _official_raw(r: official.OfficialRecord) -> RawPlace:
    """An official record with a position, as a place to merge with OSM and Overture (D71)."""
    tags = {
        "official:source": r.source,
        "official:months": r.months or "",
        "official:label": r.label or "",
        "official:sites": str(r.sites or ""),
    }
    if r.operator:
        tags["operator"] = r.operator
    if r.detail.get("website"):
        tags["website"] = r.detail["website"]
    assert r.lon is not None and r.lat is not None
    return RawPlace("official", f"{r.source}:{r.id}", r.service, r.kind, r.name, r.lon, r.lat, tags)


def _match_anchored(
    anchored: list[official.OfficialRecord], merged: list[cf.Merged], lon: np.ndarray, lat: np.ndarray
) -> dict[int, official.OfficialRecord]:
    """Official records without a position (a park campground by name) matched to a campsite found inside their
    anchor under a matching name, its own or its park's (D71)."""
    camps = [i for i, m in enumerate(merged) if m.primary.service == "accommodation" and m.primary.kind == "campsite"]
    out: dict[int, official.OfficialRecord] = {}
    for r in anchored:
        assert r.anchor is not None
        alon, alat, radius = r.anchor
        best, score = None, 0.0
        for i in camps:
            dx = (lon[i] - alon) * 111_320 * math.cos(math.radians(alat))
            dy = (lat[i] - alat) * 110_540
            if math.hypot(dx, dy) > radius:
                continue
            name = cf.norm_name(merged[i].primary.name or next((p.name for p in merged[i].members if p.name), None))
            if not name:
                continue
            own = cf.camp_name(name)
            names = [cf.camp_name(cf.norm_name(n)) for n in (r.name, r.detail.get("park")) if n]
            s = max(fuzz.token_set_ratio(n, own) for n in names)
            if s >= cf.OFFICIAL_SIMILARITY and s > score and i not in out:
                best, score = i, s
        if best is not None:
            out[best] = r
    return out


def build_places(
    root: Path,
    wd: Path,
    build: RouteBuild,
    profs: list[elevation.PartProfile],
    client: Valhalla,
    tileset: str,
    route_sha: str,
    profile: ServicesProfile,
    *,
    workers: int = 6,
    overture_release: str | None = None,
    log: Callable[[str], None] = print,
) -> ServicesResult:
    index = RouteIndex(build.path)
    places_dir = wd / "places"
    max_show = max(t.show_m for t in profile.types.values())

    log("reading service places from the OSM corridor …")
    raw = read_osm_places(wd / "osm" / "corridor.osm.pbf", places_dir)
    n_osm = len(raw)

    release = overture_release or overture.latest_release()
    pts = [p.line.resample(1000.0) for p in build.path.parts]
    boxes = overture.boxes_along(
        np.concatenate([ln.lon for ln in pts]),
        np.concatenate([ln.lat for ln in pts]),
        np.concatenate([ln.cum + part.from_m for ln, part in zip(pts, build.path.parts, strict=True)]),
        BLOCK_M,
        max_show,
    )
    cache = places_dir / f"overture-{release}-{_hash(boxes, overture.QUERY_VERSION)}.json"
    log(f"Overture places {release}: {len(boxes)} boxes{' (cached)' if cache.exists() else ''} …")
    records = overture.fetch_places(release, boxes, cache)
    raw += overture.to_raw(records, profile.overture_min_confidence)
    n_overture = len(raw) - n_osm

    # Official places from public bodies where a region publishes them (D71), each source kept by area.
    lons, lats = np.concatenate([ln.lon for ln in pts]), np.concatenate([ln.lat for ln in pts])
    pad_lat = max_show / 111_000 + 0.02
    pad_lon = pad_lat / max(0.2, math.cos(math.radians(float(lats.mean()))))
    found, official_snaps = official.near_route(
        root,
        float(lons.min()) - pad_lon,
        float(lats.min()) - pad_lat,
        float(lons.max()) + pad_lon,
        float(lats.max()) + pad_lat,
        profile.season_year,
        log,
    )
    raw += [_official_raw(r) for r in found if r.lon is not None]
    anchored = [r for r in found if r.lon is None]

    show = np.array([profile.types[r.service].show_m for r in raw])
    near = index.within(np.array([r.lon for r in raw]), np.array([r.lat for r in raw]), show)
    raw = [r for r, keep in zip(raw, near, strict=True) if keep]
    log(f"{n_osm:,} OSM + {n_overture:,} Overture places; {len(raw):,} near the route; conflating …")
    merged = cf.conflate(raw)
    floor = profile.overture_meta_stay_min_confidence
    weak = sum(cf.weak_meta_stay(m, floor) for m in merged)
    merged = [m for m in merged if not cf.weak_meta_stay(m, floor)]
    log(f"left out {weak:,} places to stay only Meta lists, below confidence {floor}")

    lon = np.array([m.primary.lon for m in merged])
    lat = np.array([m.primary.lat for m in merged])
    show_r = np.array([profile.types[m.primary.service].show_m for m in merged])
    # Every pass of the route near the place (D110): a loop's start town, the way home on an out-and-back.
    passes = index.passes(lon, lat, show_r)
    keep = [i for i, ps in enumerate(passes) if ps[0].offset_m <= show_r[i]]
    merged, passes = [merged[i] for i in keep], [passes[i] for i in keep]
    lon, lat = lon[keep], lat[keep]
    countries = CountryLookup(osm.geofabrik_index(root)).lookup(lon, lat)
    policy = BikePolicy.load()
    enrich = _match_anchored(anchored, merged, lon, lat)
    # One entry per place and pass: (place, pass, how many passes, projection).
    entries = [(i, k, len(ps), p) for i, ps in enumerate(passes) for k, p in enumerate(ps)]

    def key_of(i: int, k: int, n: int) -> str:
        prim = merged[i].primary
        key = job_key(profile.types[prim.service].costing, prim.lon, prim.lat)
        return key if n == 1 else f"{key}|pass {k + 1} of {n}"

    samples = index.samples(profile.route_sample_m)
    jobs: list[tuple[float, AccessJob]] = []
    for i, k, n, p in entries:
        prim = merged[i].primary
        cfg = profile.types[prim.service]
        if p.offset_m <= profile.skip_routing_m:
            continue
        if n == 1:
            src = samples.near(prim.lon, prim.lat, cfg.show_m, profile.max_sources)
        else:  # routed from this pass only (nearer it than any other pass), so each has its own access point
            window = min(abs(p.m - q.m) for q in passes[i] if q is not p) / 2
            src = samples.near_pass(prim.lon, prim.lat, cfg.show_m, profile.max_sources, p.m, window)
        jobs.append((p.m, AccessJob(key_of(i, k, n), prim.lon, prim.lat, cfg.costing, [int(s) for s in src], p.m)))
    jobs.sort(key=lambda j: j[0])
    access_cache = places_dir / (
        f"access-{_hash(tileset, route_sha, ACCESS_VERSION, profile.route_sample_m, profile.max_sources)}.json"
    )
    access = compute_access([j for _, j in jobs], samples, client, access_cache, workers)

    access_at = np.array(
        [
            p.m if p.offset_m <= profile.skip_routing_m else (access[key_of(i, k, n)].at_m or p.m)
            for i, k, n, p in entries
        ]
    )
    log("terrain at places …")
    place_ele = _place_elevation(lon, lat, root)
    route_ele = elevation.at(profs, access_at)

    places: list[Place] = []
    for e, (i, k, n, p) in enumerate(entries):
        m = merged[i]
        prim = m.primary
        cfg = profile.types[prim.service]
        if p.offset_m <= profile.skip_routing_m:
            dist: float | None = p.offset_m
        else:
            dist = access[key_of(i, k, n)].distance_m
        if dist is not None and dist > cfg.show_m:
            continue
        if k > 0 and dist is None:
            continue  # another pass that can't reach it adds nothing
        climb = None
        if not (np.isnan(place_ele[i]) or np.isnan(route_ele[e])):
            climb = round(max(0.0, float(place_ele[i] - route_ele[e])), 0)
        minutes = None
        if dist is not None and cfg.costing == "bicycle":
            minutes = round(profile.minutes(dist, climb), 1)
        counts = dist is not None and dist <= cfg.count_m and (cfg.count_min is None or (minutes or 0) <= cfg.count_min)
        osm_rec = next((r for r in m.members if r.source == "osm"), None)
        months = month_codes(osm_rec.tags, profile.season_year) if osm_rec else UNKNOWN
        detail = _detail(prim, m.members)
        # An official season, or none at all for an unmanaged site, outranks OSM's tags (D71).
        off = next((r for r in m.members if r.source == "official"), None)
        extra = enrich.get(i)
        if extra and extra.months:
            months = extra.months
        elif off and off.tags.get("official:months"):
            months = off.tags["official:months"]
        for info in (
            {"label": off.tags.get("official:label"), "sites": off.tags.get("official:sites")} if off else {},
            {"label": extra.label, "sites": extra.sites, "park": extra.detail.get("park")} if extra else {},
        ):
            for key, v in info.items():
                if v not in (None, ""):
                    detail["official" if key == "label" else key] = int(v) if key == "sites" else v
        if off and off.tags.get("website") and "website" not in detail:
            detail["website"] = off.tags["website"]
        if dist is None:
            detail["unreachable"] = True
        hours = osm_rec.tags.get("opening_hours") if osm_rec else None
        if hours and prim.service in DAY_SERVICES:
            days = day_codes(hours, profile.season_year)
            if days:
                detail["days"] = days  # Plan: open on a given date (11.6)
        if prim.service == "station":
            row = policy.lookup(prim.kind, countries[i], prim.tags)
            detail.update(
                bikes=row.bikes if row else "unknown",
                bike_note=row.note if row else "No policy recorded for this country.",
                bike_source=row.source if row else None,
                bike_confidence=row.confidence if row else "low",
            )
        name = prim.name or next((r.name for r in m.members if r.name), None)
        places.append(
            Place(
                # The same place on a later pass of the route has an id of its own (D110).
                id=m.sources[0] if k == 0 else f"{m.sources[0]}~{k + 1}",
                service=prim.service,
                kind=prim.kind,
                name=name,
                lon=round(prim.lon, 6),
                lat=round(prim.lat, 6),
                at_m=round(p.m, 1),
                offset_m=round(p.offset_m, 1),
                side="on" if p.side == 0 else ("left" if p.side > 0 else "right"),
                access_m=None if dist is None else round(dist),
                access_min=minutes,
                climb_m=climb,
                access_at_m=round(float(access_at[e]), 1),
                counts=counts,
                on_route=dist is not None and dist <= profile.on_route_m,
                months=months,
                opening_hours=osm_rec.tags.get("opening_hours") if osm_rec else None,
                country=countries[i],
                sources=m.sources,
                confidence=cf.confidence(m),  # type: ignore[arg-type]
                detail=detail,
            )
        )
    places.sort(key=lambda p: (p.access_at_m, p.service, p.id))
    vet_websites(places, root / "raw" / "weblinks" / "checks.json", log)
    counts: dict[str, int] = {}
    for p in places:
        counts[p.service] = counts.get(p.service, 0) + 1
    sources = [overture.snapshot(release, cache, root, len(records)), *official_snaps]
    return ServicesResult(
        places=places,
        file=PlacesFile(season_year=profile.season_year, places=places),
        coverage=Coverage(places, profile, build.path.length),
        sources=sources,
        counts=counts,
    )


def vet_websites(places: list[Place], cache: Path, log: Callable[[str], None] = print) -> None:
    """Keep a place to stay's website only when it is its own: Overture's are fetched and judged (weblinks), and a
    front page shared by several differently named places is dropped whatever its source. A dropped link leaves
    its reason in `website_rejected`; a checked one, its date in `website_checked`."""
    beds = [p for p in places if p.service == "accommodation" and p.detail.get("website")]
    shared = shared_homepages([(p.detail["website"], p.name) for p in beds])
    overture = [p for p in beds if p.detail.get("website_source") == "overture" and p.detail["website"] not in shared]
    checks = check_websites([p.detail["website"] for p in overture], cache, log=log) if overture else {}
    dropped: dict[str, int] = {}
    for p in beds:
        url = p.detail["website"]
        reason = None
        if url in shared:
            reason = "shared_homepage"
        elif p.detail.get("website_source") == "overture":
            c = checks.get(url)
            if c is not None and c.verdict != "unreachable":
                if c.verdict in KEEP:
                    p.detail["website_checked"] = c.checked[:10]
                else:
                    reason = c.verdict
        if reason:
            p.detail["website_rejected"] = reason
            del p.detail["website"]
            dropped[reason] = dropped.get(reason, 0) + 1
    if dropped:
        log("websites dropped: " + ", ".join(f"{k} {v:,}" for k, v in sorted(dropped.items())))


def services_file(result: ServicesResult, build: RouteBuild, profile: ServicesProfile) -> ServicesFile:
    sections, route = result.coverage.section_stats(build.daily)
    return ServicesFile(
        rules_profile=profile.id,
        season_year=profile.season_year,
        types=[t.info() for t in profile.types.values()],
        route_longest_gap_m=route,
        sections=sections,
        gaps=result.coverage.gap_list(),
        season_known={
            s: round(sum(season_known(p.months) for p in ps) / len(ps), 4)
            for s in profile.types
            if (ps := [p for p in result.places if p.service == s and p.counts])
        },
    )
