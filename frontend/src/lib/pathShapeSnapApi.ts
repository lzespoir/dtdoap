import type { PathAdjustPatch } from "../lib/pathAdjust";
import type { ReferenceShape, TimeBinding } from "./pathShapeSnap";
import type { LonLat } from "./pathShapeGeometry";

export interface ShapeSnapApplyConfig {
  layerId: string;
  fileName: string;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  shapes: ReferenceShape[];
  bindings: TimeBinding[];
  corridorWidthM?: number;
}

export interface ShapeSnapApplyResult {
  fileName: string;
  layerId: string;
  logicalPointCount: number;
  pointOffsets: Record<string, { east: number; north: number }>;
  displayTrail: LonLat[];
  patches: PathAdjustPatch[];
}

export async function applyShapeSnap(
  file: File,
  config: ShapeSnapApplyConfig
): Promise<ShapeSnapApplyResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("config", JSON.stringify(config));

  const res = await fetch("/api/tools/path-shape-snap/apply", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "形状附着计算失败");
  }
  return data as ShapeSnapApplyResult;
}
