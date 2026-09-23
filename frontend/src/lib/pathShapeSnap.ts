export type ShapeKind = "polyline" | "line" | "ellipse" | "rectangle";

export const SHAPE_COLORS = [
  "#e91e63",
  "#2196f3",
  "#4caf50",
  "#ff9800",
  "#9c27b0",
  "#00bcd4",
] as const;

export type ShapeRole = "target" | "constraint";

export interface LonLat {
  lon: number;
  lat: number;
}

export interface ReferenceShape {
  id: string;
  kind: ShapeKind;
  name: string;
  color: string;
  points: LonLat[];
  radiiM?: { east: number; north: number };
  role: ShapeRole;
  startAngleRad?: number;
}

export interface TimeBinding {
  id: string;
  layerId: string;
  startLogicalIndex: number;
  endLogicalIndex: number;
  targetShapeId: string;
  constraintShapeIds?: string[];
}

export function logicalPointCountFromStats(stats: {
  servingSamples?: number;
  outputSamples?: number;
}): number {
  return stats.servingSamples ?? stats.outputSamples ?? 0;
}

export function createShape(
  kind: ShapeKind,
  points: LonLat[],
  index: number,
  role: ShapeRole = "target",
  radiiM?: { east: number; north: number }
): ReferenceShape {
  return {
    id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: `${role === "constraint" ? "约束" : "目标"}${index + 1}`,
    color: SHAPE_COLORS[index % SHAPE_COLORS.length]!,
    points,
    radiiM,
    role,
  };
}

export function logicalIndexToSampleIndex(
  logicalIndex: number,
  logicalCount: number,
  sampleCount: number
): number {
  if (sampleCount <= 1 || logicalCount <= 1) return 0;
  const t = Math.max(0, Math.min(1, logicalIndex / (logicalCount - 1)));
  return Math.round(t * (sampleCount - 1));
}

export function trailSegmentForLogicalRange(
  samples: { longitude: number; latitude: number }[],
  logicalCount: number,
  startLogical: number,
  endLogical: number
): LonLat[] {
  if (samples.length === 0) return [];
  const start = Math.min(startLogical, endLogical);
  const end = Math.max(startLogical, endLogical);
  const i0 = logicalIndexToSampleIndex(start, logicalCount, samples.length);
  const i1 = logicalIndexToSampleIndex(end, logicalCount, samples.length);
  const lo = Math.min(i0, i1);
  const hi = Math.max(i0, i1);
  return samples.slice(lo, hi + 1).map((s) => ({
    lon: s.longitude,
    lat: s.latitude,
  }));
}

export function createBinding(
  layerId: string,
  startLogicalIndex: number,
  endLogicalIndex: number,
  targetShapeId: string,
  constraintShapeIds?: string[]
): TimeBinding {
  return {
    id: `bind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    layerId,
    startLogicalIndex,
    endLogicalIndex,
    targetShapeId,
    constraintShapeIds,
  };
}
