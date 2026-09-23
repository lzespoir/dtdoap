export type ShapeKind = "polyline" | "line" | "ellipse" | "rectangle";

export interface LonLat {
  lon: number;
  lat: number;
}

export interface ShapeCurve {
  kind: ShapeKind;
  points: LonLat[];
  radiiM?: { east: number; north: number };
  /** 椭圆起始角（弧度，东为 0） */
  startAngleRad?: number;
}

const M_PER_DEG_LAT = 111_320;
const ELLIPSE_ARC_STEPS = 256;

function cosLat(lat: number): number {
  return Math.cos((lat * Math.PI) / 180);
}

export function distanceMeters(a: LonLat, b: LonLat): number {
  const c = cosLat(a.lat);
  const east = (b.lon - a.lon) * M_PER_DEG_LAT * c;
  const north = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(east, north);
}

export function offsetMeters(
  origin: LonLat,
  eastM: number,
  northM: number
): LonLat {
  const c = cosLat(origin.lat);
  return {
    lon: origin.lon + eastM / (M_PER_DEG_LAT * c),
    lat: origin.lat + northM / M_PER_DEG_LAT,
  };
}

function toLocalMeters(origin: LonLat, pt: LonLat): { east: number; north: number } {
  const c = cosLat(origin.lat);
  return {
    east: (pt.lon - origin.lon) * M_PER_DEG_LAT * c,
    north: (pt.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

function rectangleCorners(a: LonLat, b: LonLat): LonLat[] {
  return [
    { lon: a.lon, lat: a.lat },
    { lon: b.lon, lat: a.lat },
    { lon: b.lon, lat: b.lat },
    { lon: a.lon, lat: b.lat },
    { lon: a.lon, lat: a.lat },
  ];
}

function polylineVertices(shape: ShapeCurve): LonLat[] {
  if (shape.kind === "line") {
    if (shape.points.length < 2) return [];
    return [shape.points[0]!, shape.points[1]!];
  }
  if (shape.kind === "rectangle") {
    if (shape.points.length < 2) return [];
    return rectangleCorners(shape.points[0]!, shape.points[1]!);
  }
  if (shape.kind === "polyline") {
    return shape.points.length >= 2 ? [...shape.points] : [];
  }
  return [];
}

function ellipsePoint(
  center: LonLat,
  radii: { east: number; north: number },
  angleRad: number
): LonLat {
  const east = radii.east * Math.cos(angleRad);
  const north = radii.north * Math.sin(angleRad);
  return offsetMeters(center, east, north);
}

function buildEllipseArcTable(shape: ShapeCurve): {
  totalLength: number;
  cumLen: number[];
  angles: number[];
  center: LonLat;
} {
  const center = shape.points[0]!;
  const radii = shape.radiiM ?? { east: 50, north: 50 };
  const start = shape.startAngleRad ?? 0;
  const cumLen: number[] = [0];
  const angles: number[] = [start];
  let total = 0;
  let prev = ellipsePoint(center, radii, start);
  for (let i = 1; i <= ELLIPSE_ARC_STEPS; i++) {
    const angle = start + (i / ELLIPSE_ARC_STEPS) * Math.PI * 2;
    const pt = ellipsePoint(center, radii, angle);
    total += distanceMeters(prev, pt);
    cumLen.push(total);
    angles.push(angle);
    prev = pt;
  }
  return { totalLength: total, cumLen, angles, center };
}

export function shapeTotalLength(shape: ShapeCurve): number {
  if (shape.kind === "ellipse") {
    return buildEllipseArcTable(shape).totalLength;
  }
  const verts = polylineVertices(shape);
  if (verts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < verts.length; i++) {
    total += distanceMeters(verts[i - 1]!, verts[i]!);
  }
  return total;
}

function pointOnPolylineAtArcLength(
  verts: LonLat[],
  s: number
): LonLat {
  if (verts.length === 0) return { lon: 0, lat: 0 };
  if (verts.length === 1) return verts[0]!;
  let acc = 0;
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1]!;
    const b = verts[i]!;
    const segLen = distanceMeters(a, b);
    if (acc + segLen >= s || i === verts.length - 1) {
      const t = segLen > 0 ? Math.max(0, Math.min(1, (s - acc) / segLen)) : 0;
      return {
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      };
    }
    acc += segLen;
  }
  return verts[verts.length - 1]!;
}

function angleAtEllipseArcLength(
  table: ReturnType<typeof buildEllipseArcTable>,
  s: number
): number {
  const { totalLength, cumLen, angles } = table;
  if (totalLength <= 0) return angles[0] ?? 0;
  const clamped = Math.max(0, Math.min(totalLength, s));
  for (let i = 1; i < cumLen.length; i++) {
    if (cumLen[i]! >= clamped) {
      const s0 = cumLen[i - 1]!;
      const s1 = cumLen[i]!;
      const t = s1 > s0 ? (clamped - s0) / (s1 - s0) : 0;
      return angles[i - 1]! + (angles[i]! - angles[i - 1]!) * t;
    }
  }
  return angles[angles.length - 1] ?? 0;
}

export function pointAtArcLength(shape: ShapeCurve, s: number): LonLat {
  if (shape.kind === "ellipse") {
    const table = buildEllipseArcTable(shape);
    const radii = shape.radiiM ?? { east: 50, north: 50 };
    const angle = angleAtEllipseArcLength(table, s);
    return ellipsePoint(table.center, radii, angle);
  }
  const verts = polylineVertices(shape);
  return pointOnPolylineAtArcLength(verts, s);
}

function nearestOnSegment(
  a: LonLat,
  b: LonLat,
  p: LonLat
): { point: LonLat; dist: number; arcFromA: number; t: number } {
  const c = cosLat(a.lat);
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * M_PER_DEG_LAT * c;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (p.lon - a.lon) * M_PER_DEG_LAT * c;
  const py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  const point = offsetMeters(a, qx, qy);
  const dist = Math.hypot(px - qx, py - qy);
  const arcFromA = Math.hypot(qx, qy);
  return { point, dist, arcFromA, t };
}

export function nearestArcLength(
  shape: ShapeCurve,
  pt: LonLat,
  sMin = 0,
  sMax?: number
): { s: number; point: LonLat; dist: number } {
  const L = shapeTotalLength(shape);
  const maxS = sMax ?? L;
  if (L <= 0) {
    const p = shape.points[0] ?? pt;
    return { s: 0, point: p, dist: distanceMeters(p, pt) };
  }

  if (shape.kind === "ellipse") {
    const table = buildEllipseArcTable(shape);
    const radii = shape.radiiM ?? { east: 50, north: 50 };
    const local = toLocalMeters(table.center, pt);
    const angle =
      Math.atan2(local.north / (radii.north || 1), local.east / (radii.east || 1));
    let bestS = 0;
    let bestDist = Infinity;
    let bestPt = pt;
    const samples = 72;
    for (let i = 0; i <= samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const cand = ellipsePoint(table.center, radii, a);
      const dist = distanceMeters(cand, pt);
      const relAngle = a - (shape.startAngleRad ?? 0);
      let s =
        (relAngle < 0 ? relAngle + Math.PI * 2 : relAngle) /
        (Math.PI * 2) *
        table.totalLength;
      if (s < sMin - 1e-6) continue;
      if (s > maxS + 1e-6) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestS = s;
        bestPt = cand;
      }
    }
    const refineSteps = 40;
    let span = L / refineSteps;
    let center = bestS;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = -refineSteps; k <= refineSteps; k++) {
        const s = Math.max(sMin, Math.min(maxS, center + k * span));
        const cand = pointAtArcLength(shape, s);
        const dist = distanceMeters(cand, pt);
        if (dist < bestDist) {
          bestDist = dist;
          bestS = s;
          bestPt = cand;
          center = s;
        }
      }
      span /= 4;
    }
    void angle;
    return { s: bestS, point: bestPt, dist: bestDist };
  }

  const verts = polylineVertices(shape);
  let acc = 0;
  let bestS = sMin;
  let bestDist = Infinity;
  let bestPt = verts[0] ?? pt;
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1]!;
    const b = verts[i]!;
    const segLen = distanceMeters(a, b);
    const hit = nearestOnSegment(a, b, pt);
    const s = acc + hit.arcFromA;
    if (s >= sMin - 1e-6 && s <= maxS + 1e-6 && hit.dist < bestDist) {
      bestDist = hit.dist;
      bestS = s;
      bestPt = hit.point;
    }
    acc += segLen;
  }
  return { s: Math.max(sMin, Math.min(maxS, bestS)), point: bestPt, dist: bestDist };
}

export function monotonicProjectPoints(
  shape: ShapeCurve,
  points: LonLat[]
): LonLat[] {
  if (points.length === 0) return [];
  const L = shapeTotalLength(shape);
  if (L <= 0) return points.map(() => ({ ...points[0]! }));

  const out: LonLat[] = [];
  let sPrev = 0;
  const first = nearestArcLength(shape, points[0]!, 0, L);
  sPrev = first.s;
  out.push(first.point);

  for (let i = 1; i < points.length; i++) {
    const hit = nearestArcLength(shape, points[i]!, sPrev, L);
    sPrev = hit.s;
    out.push(hit.point);
  }
  return out;
}

function sameCoord(a: LonLat, b: LonLat, eps = 1e-7): boolean {
  return Math.abs(a.lon - b.lon) < eps && Math.abs(a.lat - b.lat) < eps;
}

/** 椭圆：以圆心为参考径向附着，角度单调递增 */
function attachEllipseCenterRadial(
  shape: ShapeCurve,
  points: LonLat[]
): LonLat[] {
  const center = shape.points[0]!;
  const radii = shape.radiiM ?? { east: 50, north: 50 };
  const out: LonLat[] = [];
  let thetaPrev = NaN;
  let lastTarget: LonLat | null = null;
  let lastBase: LonLat | null = null;

  for (const p of points) {
    if (lastBase && sameCoord(lastBase, p) && lastTarget) {
      out.push(lastTarget);
      continue;
    }
    const local = toLocalMeters(center, p);
    let theta = Math.atan2(
      local.north / (radii.north || 1),
      local.east / (radii.east || 1)
    );
    if (Number.isFinite(thetaPrev)) {
      while (theta < thetaPrev) theta += Math.PI * 2;
    }
    thetaPrev = theta;
    lastTarget = ellipsePoint(center, radii, theta);
    lastBase = p;
    out.push(lastTarget);
  }
  return out;
}

/** 开放/折线形状：弧长单调投影；连续同坐标复用上一结果 */
function attachMonotonicWithDedup(
  shape: ShapeCurve,
  points: LonLat[]
): LonLat[] {
  if (points.length === 0) return [];
  const L = shapeTotalLength(shape);
  if (L <= 0) return points.map(() => ({ ...points[0]! }));

  const out: LonLat[] = [];
  let sPrev = 0;
  let lastTarget: LonLat | null = null;
  let lastBase: LonLat | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (lastBase && sameCoord(lastBase, p) && lastTarget) {
      out.push(lastTarget);
      continue;
    }
    const hit =
      i === 0
        ? nearestArcLength(shape, p, 0, L)
        : nearestArcLength(shape, p, sPrev, L);
    sPrev = hit.s;
    lastTarget = hit.point;
    lastBase = p;
    out.push(hit.point);
  }
  return out;
}

export function attachPointsToShape(
  shape: ShapeCurve,
  points: LonLat[]
): LonLat[] {
  if (shape.kind === "ellipse") {
    return attachEllipseCenterRadial(shape, points);
  }
  return attachMonotonicWithDedup(shape, points);
}

export function clampToRectangle(pt: LonLat, a: LonLat, b: LonLat): LonLat {
  const west = Math.min(a.lon, b.lon);
  const east = Math.max(a.lon, b.lon);
  const south = Math.min(a.lat, b.lat);
  const north = Math.max(a.lat, b.lat);
  return {
    lon: Math.max(west, Math.min(east, pt.lon)),
    lat: Math.max(south, Math.min(north, pt.lat)),
  };
}

export function applyCorridorConstraint(
  pt: LonLat,
  corridor: ShapeCurve,
  maxWidthM: number
): LonLat {
  const hit = nearestArcLength(corridor, pt);
  if (hit.dist <= maxWidthM) return pt;
  const c = cosLat(pt.lat);
  const east = (hit.point.lon - pt.lon) * M_PER_DEG_LAT * c;
  const north = (hit.point.lat - pt.lat) * M_PER_DEG_LAT;
  const len = Math.hypot(east, north);
  if (len <= 1e-6) return hit.point;
  const pull = (len - maxWidthM) / len;
  return {
    lon: pt.lon + (east * pull) / (M_PER_DEG_LAT * c),
    lat: pt.lat + (north * pull) / M_PER_DEG_LAT,
  };
}

export function shapeToPolylinePositions(shape: ShapeCurve): LonLat[] {
  if (shape.kind === "ellipse") {
    const table = buildEllipseArcTable(shape);
    const radii = shape.radiiM ?? { east: 50, north: 50 };
    const out: LonLat[] = [];
    for (let i = 0; i <= ELLIPSE_ARC_STEPS; i++) {
      const angle = (table.angles[i] ?? 0);
      out.push(ellipsePoint(table.center, radii, angle));
    }
    return out;
  }
  return polylineVertices(shape);
}
