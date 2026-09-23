import { buildCsvLogicalPointIndexFromBuffer } from "./luceLogicalPoints.js";
import {
  applyCorridorConstraint,
  attachPointsToShape,
  clampToRectangle,
  type LonLat,
  type ShapeCurve,
} from "./pathShapeGeometry.js";
import type {
  ReferenceShape,
  ShapeSnapApplyRequest,
  ShapeSnapApplyResult,
  ShapeSnapSamplePatch,
  TimeBinding,
} from "./types/pathShapeSnap.js";

const M_PER_DEG_LAT = 111_320;

function referenceShapeToCurve(shape: ReferenceShape): ShapeCurve {
  return {
    kind: shape.kind,
    points: shape.points,
    radiiM: shape.radiiM,
    startAngleRad: shape.startAngleRad,
  };
}

function applyConstraints(
  pt: LonLat,
  constraints: ReferenceShape[],
  corridorWidthM: number
): LonLat {
  let out = pt;
  for (const c of constraints) {
    if (c.kind === "rectangle" && c.points.length >= 2) {
      out = clampToRectangle(out, c.points[0]!, c.points[1]!);
    } else if (
      c.kind === "line" ||
      c.kind === "polyline" ||
      (c.kind === "ellipse" && c.role === "constraint")
    ) {
      out = applyCorridorConstraint(
        out,
        referenceShapeToCurve(c),
        corridorWidthM
      );
    }
  }
  return out;
}

function offsetToLonLat(
  baseLon: number,
  baseLat: number,
  targetLon: number,
  targetLat: number,
  layerEast: number,
  layerNorth: number
): { east: number; north: number } {
  const cosLat = Math.cos((baseLat * Math.PI) / 180);
  const totalEast = (targetLon - baseLon) * M_PER_DEG_LAT * cosLat;
  const totalNorth = (targetLat - baseLat) * M_PER_DEG_LAT;
  return {
    east: totalEast - layerEast,
    north: totalNorth - layerNorth,
  };
}

function applyBinding(
  groups: { lon: number; lat: number }[],
  shapes: ReferenceShape[],
  binding: TimeBinding,
  corridorWidthM: number,
  pointOffsets: Record<string, { east: number; north: number }>,
  layerId: string,
  layerEast: number,
  layerNorth: number
): void {
  const target = shapes.find((s) => s.id === binding.targetShapeId);
  if (!target || target.role !== "target") return;

  const constraints = (binding.constraintShapeIds ?? [])
    .map((id) => shapes.find((s) => s.id === id))
    .filter((s): s is ReferenceShape => !!s && s.role === "constraint");

  const start = Math.min(binding.startLogicalIndex, binding.endLogicalIndex);
  const end = Math.max(binding.startLogicalIndex, binding.endLogicalIndex);

  const basePoints: LonLat[] = [];
  const logicalIndices: number[] = [];
  for (let li = start; li <= end && li < groups.length; li++) {
    const g = groups[li];
    if (!g) continue;
    basePoints.push({ lon: g.lon, lat: g.lat });
    logicalIndices.push(li);
  }
  if (basePoints.length === 0) return;

  const curve = referenceShapeToCurve(target);
  let projected = attachPointsToShape(curve, basePoints);
  projected = projected.map((pt) =>
    applyConstraints(pt, constraints, corridorWidthM)
  );

  for (let j = 0; j < logicalIndices.length; j++) {
    const li = logicalIndices[j]!;
    const g = groups[li]!;
    const targetPt = projected[j]!;
    const off = offsetToLonLat(
      g.lon,
      g.lat,
      targetPt.lon,
      targetPt.lat,
      layerEast,
      layerNorth
    );
    const key = `${layerId}:sample:${li}`;
    pointOffsets[key] = off;
  }
}

function buildDisplayTrail(
  groups: { lon: number; lat: number }[],
  pointOffsets: Record<string, { east: number; north: number }>,
  layerId: string,
  layerEast: number,
  layerNorth: number,
  maxPoints = 2500
): LonLat[] {
  const n = groups.length;
  if (n === 0) return [];
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const trail: LonLat[] = [];
  for (let i = 0; i < n; i += step) {
    const g = groups[i]!;
    const key = `${layerId}:sample:${i}`;
    const off = pointOffsets[key] ?? { east: 0, north: 0 };
    const cosLat = Math.cos((g.lat * Math.PI) / 180);
    trail.push({
      lon:
        g.lon +
        (layerEast + off.east) / (M_PER_DEG_LAT * cosLat),
      lat: g.lat + (layerNorth + off.north) / M_PER_DEG_LAT,
    });
  }
  const last = groups[n - 1]!;
  const lastKey = `${layerId}:sample:${n - 1}`;
  const lastOff = pointOffsets[lastKey] ?? { east: 0, north: 0 };
  const cosLat = Math.cos((last.lat * Math.PI) / 180);
  const lastPt = {
    lon:
      last.lon +
      (layerEast + lastOff.east) / (M_PER_DEG_LAT * cosLat),
    lat: last.lat + (layerNorth + lastOff.north) / M_PER_DEG_LAT,
  };
  const prev = trail[trail.length - 1];
  if (!prev || prev.lon !== lastPt.lon || prev.lat !== lastPt.lat) {
    trail.push(lastPt);
  }
  return trail;
}

function buildExportPatches(
  groups: { lon: number; lat: number }[],
  pointOffsets: Record<string, { east: number; north: number }>,
  layerId: string
): ShapeSnapSamplePatch[] {
  const patches: ShapeSnapSamplePatch[] = [];
  for (const [key, off] of Object.entries(pointOffsets)) {
    if (Math.abs(off.east) < 1e-6 && Math.abs(off.north) < 1e-6) continue;
    const parts = key.split(":");
    if (parts.length !== 3 || parts[0] !== layerId || parts[1] !== "sample") {
      continue;
    }
    const li = Number(parts[2]);
    if (!Number.isFinite(li) || li < 0 || li >= groups.length) continue;
    const g = groups[li]!;
    patches.push({
      kind: "sample",
      pointIndex: li,
      baseLon: g.lon,
      baseLat: g.lat,
      dEast: off.east,
      dNorth: off.north,
      radiusMeters: 4,
      segmentKey: "0:0",
    });
  }
  return patches;
}

export function computeShapeSnapApply(
  csvBuffer: Buffer,
  req: ShapeSnapApplyRequest
): ShapeSnapApplyResult {
  const index = buildCsvLogicalPointIndexFromBuffer(csvBuffer);
  const groups = index.groups.map((g) => ({
    lon: g.lon,
    lat: g.lat,
  }));

  const pointOffsets: Record<string, { east: number; north: number }> = {};
  const corridorWidthM = req.corridorWidthM ?? 15;

  const forLayer = req.bindings
    .filter((b) => b.layerId === req.layerId)
    .sort((a, b) => a.startLogicalIndex - b.startLogicalIndex);

  for (const binding of forLayer) {
    applyBinding(
      groups,
      req.shapes,
      binding,
      corridorWidthM,
      pointOffsets,
      req.layerId,
      req.offsetEastMeters,
      req.offsetNorthMeters
    );
  }

  const displayTrail = buildDisplayTrail(
    groups,
    pointOffsets,
    req.layerId,
    req.offsetEastMeters,
    req.offsetNorthMeters
  );

  const patches = buildExportPatches(groups, pointOffsets, req.layerId);

  return {
    fileName: req.fileName,
    layerId: req.layerId,
    logicalPointCount: index.logicalPointCount,
    pointOffsets,
    displayTrail,
    patches,
  };
}
