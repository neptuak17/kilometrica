"""The audit: match the route to OSM, derive layers, classify gaps, add terrain (M1), services and access (M2),
Dream data (M3) and Plan data (M4), apply rules."""

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from dpg_audit import __version__, networks
from dpg_audit import overlap as overlap_mod
from dpg_audit.build import BuildParams, assemble, split_variants
from dpg_audit.bundle import PROFILE_STEP_M, write_bundle
from dpg_audit.config import work_dir
from dpg_audit.dream import themes
from dpg_audit.dream.overview import build_overview
from dpg_audit.dream.pipeline import build_dream
from dpg_audit.dream.profile import load_dream
from dpg_audit.dream.themes import read_settlements
from dpg_audit.layers import classify, elevation
from dpg_audit.layers.events import build_matched_layers
from dpg_audit.layers.gaps import classify_gaps
from dpg_audit.match.matcher import match_lines
from dpg_audit.match.valhalla import Valhalla
from dpg_audit.models import ComponentKind, EventsFile, Licence, ProfileFile, ScoresFile, SourceSnapshot
from dpg_audit.osmdata import load as load_osm
from dpg_audit.plan import build_effort, build_highlights, build_stops
from dpg_audit.rules import ecs
from dpg_audit.rules.evaluate import section_scores, stretch_stats
from dpg_audit.rules.findings import gap_findings, rule_findings, to_findings
from dpg_audit.rules.profile import DEFAULT_RULES, load_route_config, load_rules
from dpg_audit.services import coverage
from dpg_audit.services.pipeline import build_places, services_file
from dpg_audit.services.profile import load_services
from dpg_audit.sources import dem

PIPELINE = "dpg-audit/ecs-2026"


@dataclass
class AuditResult:
    run_id: str
    out: Path
    timings: dict[str, float]


def _log(msg: str) -> None:
    print(msg, flush=True)


def run(
    root: Path,
    network: str,
    ref: str,
    *,
    snapshot: str | None,
    valhalla_url: str,
    workers: int,
    rules_name: str = DEFAULT_RULES,
    services_name: str = "services-v0",
    overture_release: str | None = None,
    dream_name: str = "dream-v0",
    other_ways: bool = False,
) -> AuditResult:
    """`other_ways`: audit the ways the main line sets aside (D65) as one line of their own, as a private bundle
    `<ref>-ways`, for the ECS comparison only (D106); riders keep the main line."""
    t: dict[str, float] = {}
    t0 = time.perf_counter()
    src = networks.get(network)
    snap = src.snapshot(ref, root, snapshot)
    rules = load_rules(rules_name)
    route_cfg = load_route_config(network, ref)
    wd = work_dir(root, network, ref)
    pbf = wd / "osm" / "corridor.osm.pbf"
    if not pbf.exists():
        raise FileNotFoundError(f"{pbf} missing: run `dpg osm-prepare {network} {ref}` first")
    route_sha = snap.sha256
    # Stages of a rider's own file are named after the towns at their ends (D40); Plan's stops use the same towns.
    settlements = read_settlements(pbf, wd / "dream")
    route = src.route(ref, root)
    tracks = src.tracks(snap, root, settlements)
    if other_ways:
        _, chains = split_variants(tracks, BuildParams())
        if not chains:
            raise ValueError(f"{network} {ref} sets no ways aside")
        tracks = [t for chain in chains for t in chain]
        route = route.model_copy(
            update={"id": f"{route.id}-ways", "ref": f"{route.ref}-ways", "name": f"{route.name} (other ways)"}
        )
        route_sha = f"{snap.sha256}-ways"
        # Its own working area, sharing the main line's OSM cut, so that caches built from the line stay apart.
        main_osm, wd = wd / "osm", work_dir(root, network, f"{ref}-ways")
        wd.mkdir(parents=True, exist_ok=True)
        if not (wd / "osm").exists():
            (wd / "osm").symlink_to(main_osm, target_is_directory=True)
    build = assemble(route, tracks)
    osm_sources = [SourceSnapshot.model_validate(s) for s in json.loads((wd / "osm" / "sources.json").read_text())]

    client = Valhalla(valhalla_url)
    status = client.status()
    tileset = str(status.get("tileset_last_modified", "unknown"))
    _log(f"matching {len(build.lines)} sections with Valhalla {status.get('version')} …")
    matches = match_lines(client, build.lines, wd / "match", tileset, workers)
    t["match"] = time.perf_counter() - t0

    way_ids = {p.edge["way_id"] for m in matches for p in m.pieces if p.edge and "way_id" in p.edge}
    _log(f"reading OSM tags for {len(way_ids):,} matched ways …")
    osm = load_osm(pbf, way_ids, wd / "osm")
    ev_number = classify.eurovelo_number(build.route.ref) if src.eurovelo else None
    matched = build_matched_layers(build.path, matches, osm, ev_number)
    notes = classify_gaps(build.components, osm.ferries, route_cfg.gaps)
    t["layers"] = time.perf_counter() - t0 - sum(t.values())

    _log("sampling terrain (Copernicus DEM GLO-30) …")
    profs = elevation.profiles(build.path, lambda lon, lat: dem.sample(lon, lat, root), matched.structures)
    # The terrain under a straight-line placeholder says nothing about the real road.
    untrusted = [(f.from_m, f.to_m) for f in build.findings if f.rule_id == "source.straight_segment"]
    elevation.mark_untrusted(profs, untrusted)
    unknown = elevation.unknown_terrain([(d.from_m, d.to_m) for d in build.daily], untrusted)
    grad = elevation.gradient_events(profs, untrusted)
    # A climb runs on across stage ends, but not across a gap in the track (D82).
    breaks = [c.from_m for c in build.components if c.kind == ComponentKind.GAP]
    climbs = elevation.climbs(profs, untrusted=untrusted, breaks=breaks)
    t["terrain"] = time.perf_counter() - t0 - sum(t.values())

    svc_profile = load_services(services_name)
    services = build_places(
        root,
        wd,
        build,
        profs,
        client,
        tileset,
        route_sha,
        svc_profile,
        workers=workers,
        overture_release=overture_release,
        log=_log,
    )
    client.close()
    _log("places kept: " + ", ".join(f"{k} {v:,}" for k, v in services.counts.items()))
    t["services"] = time.perf_counter() - t0 - sum(t.values())

    events = sorted(matched.events + grad, key=lambda e: (e.layer, e.from_m))
    scores = ScoresFile(
        rules_profile=rules.id,
        criteria=rules.criterion_info(),
        route=stretch_stats(0.0, build.path.length, events, profs, unknown),
        sections=section_scores(build.daily, events, profs, unknown),
        climbs=climbs,
    )
    kept = [f.model_dump() for f in build.findings if f.rule_id != "source.gap_between_sections"]
    findings = to_findings(
        kept
        + gap_findings(build.components, notes, eurovelo=src.eurovelo)
        + rule_findings(rules, build.path, events, climbs, build.daily, scores.sections, matches, src.eurovelo)
        + coverage.findings(services.coverage, build.path.locate)
    )
    svc_file = services_file(services, build, svc_profile)

    dream = build_dream(
        root,
        wd,
        build,
        profs,
        events,
        scores.sections,
        services.places,
        services.coverage,
        svc_file,
        findings,
        load_dream(dream_name),
        untrusted=untrusted,
        extra_countries={p.country for p in services.places if p.country and p.counts},
        log=_log,
    )
    t["dream"] = time.perf_counter() - t0 - sum(t.values())

    _log("plan data: stops, effort, highlights …")
    stops = build_stops(build.path, services.places, settlements, services.coverage, svc_profile.season_year)
    effort = build_effort(build, profs, events, unknown)
    highlights, wiki_source = build_highlights(build.path, themes.prepare(pbf, build.lines, wd / "dream"), root, _log)
    _log(f"plan: {len(stops.stops):,} stops, {len(highlights.highlights):,} highlights")
    overview = build_overview(build.daily, dream.file, highlights, build.summary().status_breakdown)
    t["plan"] = time.perf_counter() - t0 - sum(t.values())

    minor = _ecs(rules, build, events, scores, services.coverage, osm, highlights.highlights, dream.file)
    _log(
        f"ECS ({rules.id}): essential {scores.route.essential_pass:.0%}, important {scores.route.important_pass:.0%}, "
        f"additional {scores.route.additional_pass:.0%} of the length"
    )

    ms = np.concatenate([np.append(np.arange(p.from_m, p.to_m, PROFILE_STEP_M), p.to_m) for p in build.path.parts])
    dem_ele = elevation.at(profs, ms)
    gpx = []
    for m in ms:
        part = build.path.part_at(float(m))
        e = part.line.elevation_at(float(m) - part.from_m)
        gpx.append(None if e is None or np.isnan(e) else round(float(e), 1))
    profile = ProfileFile(
        step_m=PROFILE_STEP_M,
        source="Copernicus DEM GLO-30, smoothed; bridges and tunnels interpolated",
        m=[round(float(m), 1) for m in ms],
        ele=[None if np.isnan(e) else round(float(e), 1) for e in dem_ele],
        gpx_ele=gpx,
    )
    tiles = dem.needed_tiles(
        np.concatenate([p.line.lon for p in build.path.parts]), np.concatenate([p.line.lat for p in build.path.parts])
    )
    valhalla_source = SourceSnapshot(
        id="valhalla",
        title=f"Valhalla {status.get('version')} map matching and access routing (tiles {tileset})",
        url=valhalla_url,
        retrieved_at=snap.retrieved_at,
        file="-",
        sha256="n/a",
        bytes=0,
        licence=Licence(id="MIT", name="MIT License", url="https://github.com/valhalla/valhalla/blob/master/COPYING"),
        attribution="Map matching and routing by Valhalla (MIT)",
    )
    sources = [snap, *osm_sources, *services.sources, dem.snapshot(root, len(tiles)), *dream.sources, valhalla_source]
    if wiki_source:
        sources.append(wiki_source)
    ways = overlap_mod.ways_file(build, matches)
    waypoints = src.waypoints(snap, root)
    shared = overlap_mod.overlap(ways, build.path.length, root, exclude=build.route.id) if src.private else []
    for o in shared:
        _log(f"overlap: {o.shared_m / 1000:,.1f} km ({o.share:.0%}) follows {o.name}")
    run_id, out = write_bundle(
        build,
        sources,
        root,
        pipeline=PIPELINE,
        findings=findings,
        profile=profile,
        events=EventsFile(layers=classify.LAYERS, events=events),
        minor=minor,
        scores=scores,
        places=services.file,
        services=svc_file,
        dream=dream.file,
        ways=ways,
        user_places=overlap_mod.user_places(build, waypoints) if waypoints else None,
        stops=stops,
        effort=effort,
        highlights=highlights,
        calendar=dream.calendar,
        overlap=shared,
        overview=overview,
        private=src.private or other_ways,
    )
    t["rules+write"] = time.perf_counter() - t0 - sum(t.values())
    _log(
        f"engine {__version__}: unmatched {matched.unmatched_m / 1000:.1f} km, "
        f"approximate {matched.approx_m / 1000:.1f} km"
    )
    return AuditResult(run_id=run_id, out=out, timings=t)


def _ecs(rules, build, events, scores, cov, osm, highlights, dream_file):
    """Judge the ECS criteria (D106) and fill their shares into the scores; returns the criteria file."""
    clearance = float(rules.criteria.get("obstacles", {}).get("min_clearance_m", 1.3))
    barriers = [
        (m, effect)
        for m, b in ecs.locate_points(build.path, osm.barriers, ecs.BARRIER_REACH_M)
        if (effect := ecs.barrier_effect(b["barrier"], b["tags"], clearance))
    ]
    rest = [m for m, _ in ecs.locate_points(build.path, osm.rest_areas, ecs.POINT_REACH_M)]
    charging = [m for m, _ in ecs.locate_points(build.path, osm.charging, ecs.POINT_REACH_M)]
    themes = {s.number: {k: v.score for k, v in s.themes.items()} for s in dream_file.sections}
    result = ecs.evaluate(
        rules,
        ecs.EcsInputs(
            events=events,
            daily=build.daily,
            components=build.components,
            length_m=build.path.length,
            sections=scores.sections,
            coverage=cov,
            barriers=barriers,
            rest_areas=rest,
            charging=charging,
            highlights=highlights,
            themes=themes,
            missing_links=not build.route.id.endswith("-ways"),
        ),
    )
    ecs.apply_shares(result, scores.route, scores.sections)
    return result.minor
