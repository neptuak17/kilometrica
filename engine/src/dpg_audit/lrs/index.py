"""Spatial index over a route path, for projecting many points (places) onto it quickly.

Candidate search runs in equal-area metres, which is close enough to find the nearest segment; the reported measures
and offsets are then computed exactly (geodesic) on the chosen part. The projection is ETRS89-LAEA (EPSG:3035) for
routes in and around Europe, and a LAEA centred on the route elsewhere (D68): `use_projection_for`.
"""

from dataclasses import dataclass

import numpy as np
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree

from dpg_audit.lrs.geodesy import distance
from dpg_audit.lrs.line import Projection
from dpg_audit.lrs.path import RoutePath

EUROPE = "EPSG:3035"
LAEA_SLACK = 1.12
"""LAEA distances can be a few per cent off far from its centre (e.g. Cyprus); pre-filters widen by this factor."""
PASS_GAP_M = 5_000.0
"""A route passes a place again when it has left the place's reach for at least this far along it, then come back (a
loop's start town, the way home on an out-and-back; D110). A shorter excursion is the same pass winding."""

_projection: dict = {}


def _use(crs: str) -> None:
    _projection.update(
        crs=crs,
        to=Transformer.from_crs("EPSG:4326", crs, always_xy=True),
        back=Transformer.from_crs(crs, "EPSG:4326", always_xy=True),
    )


_use(EUROPE)


def use_projection_for(lon, lat) -> str:
    """Pick the metric projection for a route's audit, from its points (D68). ETRS89-LAEA serves Europe, Türkiye and
    Cyprus; far from its centre its distances are tens of per cent off (British Columbia lies 130° of longitude away),
    so a route elsewhere gets a LAEA centred on itself. Set once per run, when the route is assembled; every corridor,
    nearness search and grouping then measures in the same frame."""
    lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
    if lon.min() >= -32 and lon.max() <= 45 and lat.min() >= 27 and lat.max() <= 72:
        crs = EUROPE
    else:
        lon0, lat0 = (lon.min() + lon.max()) / 2, (lat.min() + lat.max()) / 2
        crs = f"+proj=laea +lat_0={lat0:.4f} +lon_0={lon0:.4f} +ellps=GRS80 +units=m +no_defs"
    if crs != _projection["crs"]:
        _use(crs)
    return crs


def to_laea(lon, lat) -> tuple[np.ndarray, np.ndarray]:
    x, y = _projection["to"].transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    return np.asarray(x), np.asarray(y)


def from_laea(x, y) -> tuple[np.ndarray, np.ndarray]:
    lon, lat = _projection["back"].transform(np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    return np.asarray(lon), np.asarray(lat)


@dataclass
class RouteSamples:
    """Points every `step_m` along the ridden path (path measures), with a KD-tree in LAEA metres."""

    m: np.ndarray
    lon: np.ndarray
    lat: np.ndarray
    tree: cKDTree

    def near(self, lon: float, lat: float, radius_m: float, limit: int) -> np.ndarray:
        """Indices of samples within `radius_m` of the point, nearest first, at most `limit` (at least 1)."""
        x, y = to_laea(lon, lat)
        dist, idx = self.tree.query([float(x), float(y)], k=limit, distance_upper_bound=radius_m * LAEA_SLACK)
        idx = np.atleast_1d(idx)[np.isfinite(np.atleast_1d(dist))]
        if idx.size == 0:
            _, idx = self.tree.query([float(x), float(y)], k=1)
            idx = np.atleast_1d(idx)
        return idx.astype(int)

    def near_pass(self, lon: float, lat: float, radius_m: float, limit: int, m: float, window_m: float) -> np.ndarray:
        """Like `near`, but only samples within `window_m` along the route of measure `m`: one pass of a route that
        passes the point more than once (D110). At least the sample nearest to `m`."""
        x, y = to_laea(lon, lat)
        here = np.array([float(x), float(y)])
        idx = np.asarray(self.tree.query_ball_point(here, radius_m * LAEA_SLACK), dtype=int)
        idx = idx[np.abs(self.m[idx] - m) <= window_m] if idx.size else idx
        if idx.size == 0:
            return np.array([int(np.argmin(np.abs(self.m - m)))])
        d = np.hypot(*(self.tree.data[idx] - here).T)
        return idx[np.argsort(d, kind="stable")][:limit].astype(int)


class RouteIndex:
    def __init__(self, path: RoutePath):
        self.path = path
        geoms, owners, locals_ = [], [], []
        for pi, part in enumerate(path.parts):
            x, y = to_laea(part.line.lon, part.line.lat)
            coords = np.stack([np.stack([x[:-1], y[:-1]], 1), np.stack([x[1:], y[1:]], 1)], 1)
            geoms.append(shapely.linestrings(coords))
            owners.append(np.full(len(coords), pi))
            locals_.append(np.arange(len(coords)))
        self.segments = np.concatenate(geoms)
        self.owner = np.concatenate(owners)
        self.local = np.concatenate(locals_)
        """Each segment's index within its part's line."""
        self.seg_start = np.concatenate([part.from_m + part.line.cum[:-1] for part in path.parts])
        self.seg_len = np.concatenate([part.line.seg_len for part in path.parts])
        """Each segment's start along the path, and its length (metres)."""
        self.tree = shapely.STRtree(self.segments)

    def within(self, lon: np.ndarray, lat: np.ndarray, radius_m: np.ndarray | float) -> np.ndarray:
        """Boolean mask: points within roughly `radius_m` of the route (generous; refine with `project`)."""
        x, y = to_laea(lon, lat)
        pts = shapely.points(x, y)
        radius = np.broadcast_to(np.asarray(radius_m, dtype=float) * LAEA_SLACK, pts.shape)
        hits = self.tree.query(pts, predicate="dwithin", distance=radius)
        mask = np.zeros(pts.shape, dtype=bool)
        mask[hits[0]] = True
        return mask

    def project(self, lon: np.ndarray, lat: np.ndarray) -> list[Projection]:
        """Exact projections (path measures) of each point onto its nearest part."""
        x, y = to_laea(lon, lat)
        pts = shapely.points(x, y)
        point_idx, seg_idx = self.tree.query_nearest(pts, all_matches=False)
        nearest = np.empty(pts.shape, dtype=int)
        nearest[point_idx] = seg_idx
        out: list[Projection] = []
        for i, s in enumerate(nearest):
            part = self.path.parts[int(self.owner[s])]
            p = part.line.project(float(lon[i]), float(lat[i]))
            out.append(Projection(p.m + part.from_m, p.offset_m, p.side, p.lon, p.lat, p.segment))
        return out

    def passes(
        self, lon: np.ndarray, lat: np.ndarray, radius_m: np.ndarray | float, gap_m: float = PASS_GAP_M
    ) -> list[list[Projection]]:
        """Each point's projections onto every pass of the route within `radius_m`, nearest first (D110). The first is
        `project`'s. A pass is a run of the route within reach of the point; the route passes it again only after
        leaving its reach for at least `gap_m`, as where a loop comes back to its start town or an out-and-back rides
        home. A place merely within reach of a long stretch (a hospital 15 km off a coast) is one pass."""
        lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
        out = [[p] for p in self.project(lon, lat)]
        if not out:
            return out
        radius = np.broadcast_to(np.asarray(radius_m, dtype=float), lon.shape)
        x, y = to_laea(lon, lat)
        pts = shapely.points(x, y)
        pi, si = self.tree.query(pts, predicate="dwithin", distance=radius * LAEA_SLACK)
        if pi.size == 0:
            return out
        dist = shapely.distance(pts[pi], self.segments[si])
        frac = shapely.line_locate_point(self.segments[si], pts[pi], normalized=True)
        starts, lengths = self.seg_start[si], self.seg_len[si]
        # The candidates of each point, together and along the route: one sort, not a scan per point.
        order = np.lexsort((starts, pi))
        bounds = np.flatnonzero(np.diff(pi[order])) + 1
        for ks in np.split(order, bounds):
            i = int(pi[ks[0]])
            # Runs of segments within reach, joined across stretches out of reach shorter than gap_m. Most points have
            # one run: nothing more to do.
            s = starts[ks]
            ends = np.maximum.accumulate(s + lengths[ks])
            cuts = np.flatnonzero(s[1:] - ends[:-1] > gap_m) + 1
            if cuts.size == 0:
                continue
            first = out[i][0].m
            los, his = s[np.r_[0, cuts]], ends[np.r_[cuts - 1, ks.size - 1]]
            for run, lo, hi in zip(np.split(ks, cuts), los, his, strict=True):
                if lo - 1.0 <= first <= hi + 1.0:
                    continue  # the pass `project` found
                best = int(run[np.argmin(dist[run])])
                self._add_pass(out[i], best, si, frac, lon, lat, x, y, i, radius)
            out[i][1:] = sorted(out[i][1:], key=lambda p: p.offset_m)  # project's stays first
        return out

    def _add_pass(self, found, k, si, frac, lon, lat, x, y, i, radius) -> None:
        """The exact projection of point i onto the segment of candidate k, added to `found` when within reach."""
        s = int(si[k])
        part = self.path.parts[int(self.owner[s])]
        j = int(self.local[s])
        m = part.from_m + float(part.line.cum[j] + frac[k] * part.line.seg_len[j])
        foot_lon, foot_lat = part.line.locate(m - part.from_m)
        offset = distance(float(lon[i]), float(lat[i]), foot_lon, foot_lat)
        if offset > radius[i]:
            return
        (ax, bx), (ay, by) = to_laea(part.line.lon[j : j + 2], part.line.lat[j : j + 2])
        cross = (bx - ax) * (y[i] - ay) - (by - ay) * (x[i] - ax)
        side = 0 if offset < 1e-6 else (1 if cross > 0 else -1)
        found.append(Projection(m, offset, side, foot_lon, foot_lat, j))

    def samples(self, step_m: float) -> RouteSamples:
        ms, lons, lats = [], [], []
        for part in self.path.parts:
            local = np.append(np.arange(0.0, part.line.length, step_m), part.line.length)
            lon, lat = part.line.locate(local)
            ms.append(local + part.from_m)
            lons.append(np.atleast_1d(lon))
            lats.append(np.atleast_1d(lat))
        m, lon, lat = np.concatenate(ms), np.concatenate(lons), np.concatenate(lats)
        x, y = to_laea(lon, lat)
        return RouteSamples(m=m, lon=lon, lat=lat, tree=cKDTree(np.stack([x, y], 1)))
