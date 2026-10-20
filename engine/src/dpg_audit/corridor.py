"""Corridor polygons around a route: the area whose map data an audit needs."""

import json
from pathlib import Path

from shapely import MultiPolygon, Polygon
from shapely.geometry import LineString, mapping
from shapely.ops import transform, unary_union

from dpg_audit.lrs import MeasuredLine
from dpg_audit.lrs.index import from_laea, to_laea


def corridor(lines: list[MeasuredLine], buffer_m: float, simplify_m: float = 500.0) -> MultiPolygon:
    """Union of `buffer_m` buffers around every ride line, simplified, in WGS84 lon/lat. Buffered in the route's
    equal-area metres (D68)."""
    parts = []
    for line in lines:
        geom = transform(to_laea, LineString(list(zip(line.lon, line.lat, strict=True))))
        parts.append(geom.simplify(simplify_m / 5).buffer(buffer_m, quad_segs=4))
    merged = unary_union(parts).simplify(simplify_m)
    polys = [merged] if isinstance(merged, Polygon) else list(merged.geoms)
    return MultiPolygon([transform(from_laea, p) for p in polys])


def write_geojson(shape: MultiPolygon, path: Path, properties: dict | None = None) -> None:
    feature = {"type": "Feature", "properties": properties or {}, "geometry": mapping(shape)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}), encoding="utf-8")
