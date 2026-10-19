/** The route's geometry by path measure: the ridden lines, the gaps, and points along them. */

/** The route's ridden lines with the path measure of every coordinate (from path.geojson). */
export interface PathLine {
  coords: [number, number][];
  m: number[];
}

export interface PathGap {
  atM: number;
  type: string;
  km: number;
  start: [number, number];
  end: [number, number];
}

export interface Geometry {
  lines: PathLine[];
  gaps: PathGap[];
}

/** The route point at a path measure. */
export function locate(geo: Geometry, m: number): [number, number] | null {
  for (const line of geo.lines) {
    const ms = line.m;
    if (!ms.length || m < ms[0]! - 1e-6 || m > ms[ms.length - 1]! + 1e-6) continue;
    let lo = 0;
    let hi = ms.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ms[mid]! <= m) lo = mid;
      else hi = mid;
    }
    const a = line.coords[lo]!;
    const b = line.coords[hi]!;
    const span = ms[hi]! - ms[lo]!;
    const f = span > 0 ? (m - ms[lo]!) / span : 0;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  return null;
}

/** The track between two path measures, in the direction of travel, one segment per ridden line. */
export function slice(geo: Geometry, fromM: number, toM: number): [number, number][][] {
  const lo = Math.min(fromM, toM);
  const hi = Math.max(fromM, toM);
  const segs: [number, number][][] = [];
  for (const line of geo.lines) {
    const ms = line.m;
    if (!ms.length || ms[ms.length - 1]! <= lo || ms[0]! >= hi) continue;
    const pts: [number, number][] = [];
    const first = locate({ lines: [line], gaps: [] }, Math.max(lo, ms[0]!));
    if (first) pts.push(first);
    for (let i = 0; i < ms.length; i++) if (ms[i]! > lo && ms[i]! < hi) pts.push(line.coords[i]!);
    const last = locate({ lines: [line], gaps: [] }, Math.min(hi, ms[ms.length - 1]!));
    if (last) pts.push(last);
    if (pts.length < 2) continue;
    // The route's lines meet end to end between its sections, or nearly (digitising breaks under ~300 m, like the
    // audit's): join them, so only a real gap breaks the track.
    const prev = segs[segs.length - 1];
    const end = prev?.[prev.length - 1];
    if (prev && end && Math.abs(end[0] - pts[0]![0]) < 0.0035 && Math.abs(end[1] - pts[0]![1]) < 0.0027) prev.push(...pts);
    else segs.push(pts);
  }
  if (toM < fromM) return segs.reverse().map((s) => s.reverse());
  return segs;
}

/** Compass bearing in degrees (0 = north, clockwise) from a to b, or null if they're the same point. */
export function bearing(a: [number, number], b: [number, number]): number | null {
  const rad = Math.PI / 180;
  const [lon1, lat1] = [a[0] * rad, a[1] * rad];
  const [lon2, lat2] = [b[0] * rad, b[1] * rad];
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}
