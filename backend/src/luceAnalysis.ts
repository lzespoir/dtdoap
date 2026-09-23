import {
  filterSamplesWithAwk,
  syncLuceExtracts,
  type LuceVariant,
} from "./luceCache.js";
import {
  cellBoundsFromIndices,
  gridIndexOptionsFromSettings,
  gridIndicesFromLonLat,
} from "./gridUtils.js";
import { loadLuceResult } from "./luceProcessor.js";
import { loadLuceSettings } from "./luceSettings.js";
import type { LuceSettings, RsrpSample } from "./types/luce.js";

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
  variant: LuceVariant;
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
  /** @deprecated 使用 rsrpSpreadSummary */
  spreadSummary: SpreadSummary;
}

function isValidServingSample(s: RsrpSample): boolean {
  return (
    s.kind === "serving" &&
    Number.isFinite(s.longitude) &&
    Number.isFinite(s.latitude) &&
    s.longitude !== 0 &&
    s.latitude !== 0 &&
    Number.isFinite(s.rsrp) &&
    s.rsrp >= -140 &&
    s.rsrp <= -40
  );
}

function isValidSinr(sinr: number | undefined): sinr is number {
  return sinr !== undefined && Number.isFinite(sinr) && sinr >= -30 && sinr <= 40;
}

export function computeGridSpreadMap(
  samples: RsrpSample[],
  settings: LuceSettings,
  gridSizeM: number
): GridSpreadMapCell[] {
  const opts = gridIndexOptionsFromSettings(settings);
  const buckets = new Map<
    string,
    { gx: number; gy: number; rsrp: number[]; sinr: number[] }
  >();

  for (const s of samples) {
    if (!isValidServingSample(s)) continue;
    const { gx, gy } = gridIndicesFromLonLat(
      s.longitude,
      s.latitude,
      gridSizeM,
      opts
    );
    const key = `${gx},${gy}`;
    let cell = buckets.get(key);
    if (!cell) {
      cell = { gx, gy, rsrp: [], sinr: [] };
      buckets.set(key, cell);
    }
    cell.rsrp.push(s.rsrp);
    if (isValidSinr(s.sinr)) cell.sinr.push(s.sinr);
  }

  const out: GridSpreadMapCell[] = [];
  for (const [, cell] of buckets) {
    if (cell.rsrp.length === 0) continue;
    const rsrpMin = Math.min(...cell.rsrp);
    const rsrpMax = Math.max(...cell.rsrp);
    let sinrMin: number | null = null;
    let sinrMax: number | null = null;
    let sinrSpread: number | null = null;
    if (cell.sinr.length > 0) {
      sinrMin = Math.min(...cell.sinr);
      sinrMax = Math.max(...cell.sinr);
      sinrSpread = sinrMax - sinrMin;
    }
    const bounds = cellBoundsFromIndices(
      cell.gx,
      cell.gy,
      gridSizeM,
      opts
    );
    out.push({
      key: `${cell.gx},${cell.gy}`,
      gx: cell.gx,
      gy: cell.gy,
      count: cell.rsrp.length,
      rsrpMin,
      rsrpMax,
      rsrpSpread: rsrpMax - rsrpMin,
      sinrCount: cell.sinr.length,
      sinrMin,
      sinrMax,
      sinrSpread,
      ...bounds,
    });
  }
  return out;
}

function spreadSummaryFromValues(spreads: number[]): SpreadSummary {
  if (spreads.length === 0) {
    return { meanSpread: 0, p50Spread: 0, p90Spread: 0, maxSpread: 0 };
  }
  const sorted = [...spreads].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];
  return {
    meanSpread: sorted.reduce((s, v) => s + v, 0) / n,
    p50Spread: pct(50),
    p90Spread: pct(90),
    maxSpread: sorted[n - 1],
  };
}

export interface GridCellSamplePoint {
  longitude: number;
  latitude: number;
  rsrp: number;
  sinr: number | null;
  pci: number;
}

export interface GridCellSamplesResult {
  variant: LuceVariant;
  gx: number;
  gy: number;
  gridSizeMeters: number;
  west: number;
  south: number;
  east: number;
  north: number;
  points: GridCellSamplePoint[];
}

async function loadServingForGridAnalysis(
  batchId: string,
  variant: LuceVariant,
  gridSizeMeters?: number
): Promise<{
  serving: RsrpSample[];
  analysisSettings: LuceSettings;
  sizeM: number;
  processedAt: string | null;
}> {
  const settings = await loadLuceSettings(batchId);
  const result = await loadLuceResult(batchId, variant);
  if (!result) {
    throw new Error(
      variant === "after"
        ? "尚未处理优化后路测数据"
        : "尚未处理优化前路测数据"
    );
  }

  const analysisSettings = { ...(result.settings ?? settings) };
  const sizeM =
    Number.isFinite(gridSizeMeters) && gridSizeMeters! > 0
      ? gridSizeMeters!
      : analysisSettings.gridSizeMeters || 5;
  analysisSettings.gridSizeMeters = sizeM;

  const manifest = await syncLuceExtracts(batchId, variant);
  const raw = await filterSamplesWithAwk(
    batchId,
    variant,
    manifest,
    analysisSettings
  );
  const serving = raw.filter(isValidServingSample);
  return {
    serving,
    analysisSettings,
    sizeM,
    processedAt: result.processedAt ?? null,
  };
}

export async function runGridCellSamples(
  batchId: string,
  variant: LuceVariant,
  gx: number,
  gy: number,
  gridSizeMeters?: number
): Promise<GridCellSamplesResult> {
  const { serving, analysisSettings, sizeM } = await loadServingForGridAnalysis(
    batchId,
    variant,
    gridSizeMeters
  );
  const opts = gridIndexOptionsFromSettings(analysisSettings);
  const points: GridCellSamplePoint[] = [];

  for (const s of serving) {
    const idx = gridIndicesFromLonLat(
      s.longitude,
      s.latitude,
      sizeM,
      opts
    );
    if (idx.gx !== gx || idx.gy !== gy) continue;
    points.push({
      longitude: s.longitude,
      latitude: s.latitude,
      rsrp: s.rsrp,
      sinr: isValidSinr(s.sinr) ? s.sinr : null,
      pci: s.pci,
    });
  }

  const bounds = cellBoundsFromIndices(gx, gy, sizeM, opts);
  return {
    variant,
    gx,
    gy,
    gridSizeMeters: sizeM,
    points,
    ...bounds,
  };
}

export async function runGridSpreadMapAnalysis(
  batchId: string,
  variant: LuceVariant,
  gridSizeMeters?: number
): Promise<GridSpreadMapResult> {
  const { serving, analysisSettings, sizeM, processedAt } =
    await loadServingForGridAnalysis(batchId, variant, gridSizeMeters);
  const sinrSampleCount = serving.filter((s) => isValidSinr(s.sinr)).length;

  const gridCells = computeGridSpreadMap(serving, analysisSettings, sizeM);
  const sinrSpreads = gridCells
    .map((c) => c.sinrSpread)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const rsrpSpreadSummary = spreadSummaryFromValues(
    gridCells.map((c) => c.rsrpSpread)
  );
  const sinrSpreadSummary = spreadSummaryFromValues(sinrSpreads);

  return {
    variant,
    sampleCount: serving.length,
    sinrSampleCount,
    gridSizeMeters: sizeM,
    settings: analysisSettings,
    processedAt,
    gridCells,
    gridCellCount: gridCells.length,
    sinrGridCellCount: sinrSpreads.length,
    rsrpSpreadSummary,
    sinrSpreadSummary,
    spreadSummary: rsrpSpreadSummary,
  };
}

/** @deprecated 使用 runGridSpreadMapAnalysis */
export async function runSpatialRsrpAnalysis(
  batchId: string,
  variant: LuceVariant,
  gridSizeMeters?: number
): Promise<GridSpreadMapResult> {
  return runGridSpreadMapAnalysis(batchId, variant, gridSizeMeters);
}
