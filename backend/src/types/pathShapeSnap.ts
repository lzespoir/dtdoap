export type ShapeKind = "polyline" | "line" | "ellipse" | "rectangle";
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

export interface ShapeSnapApplyRequest {
  layerId: string;
  fileName: string;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  shapes: ReferenceShape[];
  bindings: TimeBinding[];
  corridorWidthM?: number;
}

export interface ShapeSnapSamplePatch {
  kind: "sample";
  pointIndex: number;
  baseLon: number;
  baseLat: number;
  dEast: number;
  dNorth: number;
  radiusMeters: number;
  segmentKey: string;
}

export interface ShapeSnapApplyResult {
  fileName: string;
  layerId: string;
  logicalPointCount: number;
  pointOffsets: Record<string, { east: number; north: number }>;
  /** 主区路径显示用（已附着、均匀抽稀） */
  displayTrail: LonLat[];
  /** 导出用：逻辑点下标与 CSV 主区坐标 */
  patches: ShapeSnapSamplePatch[];
}
