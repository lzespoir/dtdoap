import type { LuceSettings } from "../types/luce";

export type ToolDatasetVariant = "before" | "after" | "both";
export type SpreadMetric = "rsrp" | "sinr";

export interface SpreadSummary {
  meanSpread: number;
  p50Spread: number;
  p90Spread: number;
  maxSpread: number;
}

export interface GridSpreadMapCell {
  key: string;
  gx: number;
  gy: number;
  count: number;
  rsrpMin: number;
  rsrpMax: number;
  rsrpSpread: number;
  sinrCount: number;
  sinrMin: number | null;
  sinrMax: number | null;
  sinrSpread: number | null;
  west: number;
  south: number;
  east: number;
  north: number;
  longitude: number;
  latitude: number;
}

export interface GridSpreadMapResult {
  variant: "before" | "after";
  sampleCount: number;
  sinrSampleCount: number;
  gridSizeMeters: number;
  settings: LuceSettings;
  processedAt: string | null;
  gridCells: GridSpreadMapCell[];
  gridCellCount: number;
  sinrGridCellCount: number;
  rsrpSpreadSummary: SpreadSummary;
  sinrSpreadSummary: SpreadSummary;
  spreadSummary: SpreadSummary;
}

export function cellSpread(
  cell: GridSpreadMapCell,
  metric: SpreadMetric
): number | null {
  return metric === "rsrp" ? cell.rsrpSpread : cell.sinrSpread;
}

export function cellHasMetric(
  cell: GridSpreadMapCell,
  metric: SpreadMetric
): boolean {
  if (metric === "rsrp") return cell.count > 0;
  return cell.sinrCount > 0 && cell.sinrSpread !== null;
}

export function summaryForMetric(
  data: GridSpreadMapResult,
  metric: SpreadMetric
): SpreadSummary {
  return metric === "rsrp" ? data.rsrpSpreadSummary : data.sinrSpreadSummary;
}

export function spreadColorCapFromSummary(summary: SpreadSummary, metric: SpreadMetric): number {
  const p90 = summary.p90Spread;
  const max = summary.maxSpread;
  // 略高于 P90，避免大部分格子挤在暖色/红色段
  const base = Math.max(p90 * 1.25, max * 0.85);
  return Math.max(metric === "sinr" ? 2 : 3, Math.ceil(base * 10) / 10);
}

export interface GridCellSamplePoint {
  longitude: number;
  latitude: number;
  rsrp: number;
  sinr: number | null;
  pci: number;
}

export interface GridCellSamplesResult {
  variant: "before" | "after";
  gx: number;
  gy: number;
  gridSizeMeters: number;
  west: number;
  south: number;
  east: number;
  north: number;
  points: GridCellSamplePoint[];
}

export async function fetchGridCellSamples(
  batchId: string,
  variant: "before" | "after",
  gx: number,
  gy: number,
  gridSizeM: number
): Promise<GridCellSamplesResult> {
  const qs = new URLSearchParams({
    variant,
    gx: String(gx),
    gy: String(gy),
    gridSizeM: String(gridSizeM),
  });
  const res = await fetch(
    `/api/batches/${batchId}/luce/analysis/spatial-rsrp/cell?${qs}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "栅格采样点加载失败");
  return data;
}

export async function fetchGridSpreadMap(
  batchId: string,
  variant: ToolDatasetVariant,
  gridSizeM: number
): Promise<
  | { kind: "single"; result: GridSpreadMapResult; variant: "before" | "after" }
  | { kind: "both"; before: GridSpreadMapResult; after: GridSpreadMapResult }
> {
  const qs = new URLSearchParams({
    variant,
    gridSizeM: String(gridSizeM),
  });
  const res = await fetch(
    `/api/batches/${batchId}/luce/analysis/spatial-rsrp?${qs}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "栅格分析失败");
  if (variant === "both") {
    return { kind: "both", before: data.before, after: data.after };
  }
  return { kind: "single", result: data.result, variant: data.variant };
}
