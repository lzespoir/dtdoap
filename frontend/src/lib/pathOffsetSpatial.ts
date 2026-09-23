/** 按原始经纬度在已编辑轨迹顶点间空间插值偏移（避免时间序映射造成同位置来回折） */

export interface PathPatchLike {
  kind: "path" | "sample";
  pointIndex: number;
  baseLon: number;
  baseLat: number;
  dEast: number;
  dNorth: number;
  segmentKey?: string;
}

const M_PER_DEG_LAT = 111_320;

export function distanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const cosLat = Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * M_PER_DEG_LAT * cosLat;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

function toMeters(
  lon: number,
  lat: number,
  refLat: number
): { x: number; y: number } {
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  return { x: lon * M_PER_DEG_LAT * cosLat, y: lat * M_PER_DEG_LAT };
}

export function pointToSegmentMeters(
  lon: number,
  lat: number,
  lonA: number,
  latA: number,
  lonB: number,
  latB: number
): { distM: number; frac: number } {
  const refLat = lat;
  const p = toMeters(lon, lat, refLat);
  const a = toMeters(lonA, latA, refLat);
  const b = toMeters(lonB, latB, refLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    return {
      distM: Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2),
      frac: 0,
    };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return {
    distM: Math.sqrt((p.x - qx) ** 2 + (p.y - qy) ** 2),
    frac: t,
  };
}

function lerpOffset(
  a: { dEast: number; dNorth: number },
  b: { dEast: number; dNorth: number },
  frac: number
): { east: number; north: number } {
  return {
    east: a.dEast + (b.dEast - a.dEast) * frac,
    north: a.dNorth + (b.dNorth - a.dNorth) * frac,
  };
}

export function coordOffsetKey(lon: number, lat: number): string {
  return `${lon.toFixed(7)},${lat.toFixed(7)}`;
}

export function pathOffsetFromPatchesByPosition(
  patches: PathPatchLike[],
  lon: number,
  lat: number,
  maxCorridorMeters = 35
): {
  east: number;
  north: number;
  matchedPathPatches: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey?: string;
    weight: number;
  }[];
} {
  const pathPatches = patches
    .filter((p) => p.kind === "path")
    .sort((a, b) => a.pointIndex - b.pointIndex);

  if (pathPatches.length === 0) {
    return { east: 0, north: 0, matchedPathPatches: [] };
  }
  if (pathPatches.length === 1) {
    const p = pathPatches[0]!;
    return {
      east: p.dEast,
      north: p.dNorth,
      matchedPathPatches: [
        {
          pointIndex: p.pointIndex,
          dEast: p.dEast,
          dNorth: p.dNorth,
          segmentKey: p.segmentKey,
          weight: 1,
        },
      ],
    };
  }

  let bestDist = Infinity;
  let bestEast = 0;
  let bestNorth = 0;
  let bestMatch: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey?: string;
    weight: number;
  }[] = [];

  for (const p of pathPatches) {
    const d = distanceMeters(lon, lat, p.baseLon, p.baseLat);
    if (d < bestDist) {
      bestDist = d;
      bestEast = p.dEast;
      bestNorth = p.dNorth;
      bestMatch = [
        {
          pointIndex: p.pointIndex,
          dEast: p.dEast,
          dNorth: p.dNorth,
          segmentKey: p.segmentKey,
          weight: 1,
        },
      ];
    }
  }

  for (let i = 0; i < pathPatches.length - 1; i++) {
    const a = pathPatches[i]!;
    const b = pathPatches[i + 1]!;
    if (b.pointIndex - a.pointIndex > 12) continue;
    const seg = pointToSegmentMeters(
      lon,
      lat,
      a.baseLon,
      a.baseLat,
      b.baseLon,
      b.baseLat
    );
    if (seg.distM >= bestDist) continue;
    const blended = lerpOffset(a, b, seg.frac);
    bestDist = seg.distM;
    bestEast = blended.east;
    bestNorth = blended.north;
    bestMatch = [
      {
        pointIndex: a.pointIndex,
        dEast: a.dEast,
        dNorth: a.dNorth,
        segmentKey: a.segmentKey,
        weight: 1 - seg.frac,
      },
      {
        pointIndex: b.pointIndex,
        dEast: b.dEast,
        dNorth: b.dNorth,
        segmentKey: b.segmentKey,
        weight: seg.frac,
      },
    ];
  }

  if (bestDist > maxCorridorMeters) {
    return { east: 0, north: 0, matchedPathPatches: [] };
  }

  return { east: bestEast, north: bestNorth, matchedPathPatches: bestMatch };
}
