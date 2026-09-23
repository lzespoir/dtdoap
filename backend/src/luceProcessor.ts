import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { batchDir } from "./batchStorage.js";
import {
  buildPathsCache,
  filterSamplesWithAwk,
  luceSourceDir,
  manifestKey,
  syncLuceExtracts,
  type LuceVariant,
} from "./luceCache.js";
import { loadLuceSettings, saveLuceSettings } from "./luceSettings.js";
import type {
  CoverageSummary,
  DrivePath,
  GridAggMode,
  GridCell,
  LuceCoverageStats,
  LuceProcessEvent,
  LuceProcessResult,
  LuceSettings,
  RsrpSample,
} from "./types/luce.js";
import {
  cellBoundsFromIndices,
  gridIndexOptionsFromSettings,
  gridIndicesFromLonLat,
  medianLonLatFromSamples,
  type GridIndexOptions,
} from "./gridUtils.js";
import { resolveGrasslandBbox } from "./regionBboxPresets.js";

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * q))
  );
  return sorted[idx];
}

function dbToLinear(vDb: number): number {
  return Math.pow(10, vDb / 10);
}

function linearToDb(vLinear: number): number {
  return 10 * Math.log10(vLinear);
}

function summarize(
  samples: RsrpSample[],
  useLinearDomainAverage = false
): CoverageSummary | null {
  if (samples.length === 0) return null;
  const rsrps = samples
    .map((s) => s.rsrp)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (rsrps.length === 0) return null;
  let sum = 0;
  let sumLinear = 0;
  let cover75 = 0;
  let cover85 = 0;
  let cover90 = 0;
  let cover95 = 0;
  let cover100 = 0;
  let cover105 = 0;
  let cover110 = 0;
  let weak = 0;
  let rangeExcellent = 0;
  let rangeGood = 0;
  let rangeMedium = 0;
  let rangeWeak = 0;
  // SINR bins（阈值：>=10, >=5, >=0, >=-5；以及 < -5 极弱）
  let sinrCover10 = 0;
  let sinrCover5 = 0;
  let sinrCover0 = 0;
  let sinrCoverNeg5 = 0;
  let sinrWeak = 0; // < -5
  let sinrRangeExcellent = 0; // >= 10
  let sinrRangeGood = 0; // [5, 10)
  let sinrRangeMedium = 0; // [0, 5)
  let sinrRangeWeak = 0; // [-5, 0)
  for (const v of rsrps) {
    sum += v;
    if (useLinearDomainAverage) sumLinear += dbToLinear(v);
    if (v >= -75) cover75++;
    if (v >= -85) cover85++;
    if (v >= -90) cover90++;
    if (v >= -95) cover95++;
    if (v >= -100) cover100++;
    if (v >= -105) cover105++;
    if (v >= -110) cover110++;
    if (v < -110) weak++;
    if (v >= -80) rangeExcellent++;
    if (v >= -90 && v < -80) rangeGood++;
    if (v >= -100 && v < -90) rangeMedium++;
    if (v >= -110 && v < -100) rangeWeak++;
  }
  const n = rsrps.length;

  const sinrs = samples
    .map((s) => s.sinr)
    .filter((v): v is number => v !== undefined && Number.isFinite(v))
    .sort((a, b) => a - b);
  const sinrN = sinrs.length;
  const sinrSum = sinrs.reduce((a, b) => a + b, 0);
  const sinrLinearSum = useLinearDomainAverage
    ? sinrs.reduce((a, b) => a + dbToLinear(b), 0)
    : 0;
  for (const v of sinrs) {
    if (v >= 10) sinrCover10++;
    if (v >= 5) sinrCover5++;
    if (v >= 0) sinrCover0++;
    if (v >= -5) sinrCoverNeg5++;
    if (v < -5) sinrWeak++;
    if (v >= 10) sinrRangeExcellent++;
    if (v >= 5 && v < 10) sinrRangeGood++;
    if (v >= 0 && v < 5) sinrRangeMedium++;
    if (v >= -5 && v < 0) sinrRangeWeak++;
  }

  return {
    count: n,
    avgRsrp: Number(
      (
        useLinearDomainAverage && n > 0
          ? linearToDb(sumLinear / n)
          : sum / n
      ).toFixed(2)
    ),
    minRsrp: rsrps[0],
    maxRsrp: rsrps[n - 1],
    p10: percentile(rsrps, 0.1),
    p50: percentile(rsrps, 0.5),
    p90: percentile(rsrps, 0.9),
    cover75: Number((cover75 / n).toFixed(4)),
    cover85: Number((cover85 / n).toFixed(4)),
    cover90: Number((cover90 / n).toFixed(4)),
    cover95: Number((cover95 / n).toFixed(4)),
    cover100: Number((cover100 / n).toFixed(4)),
    cover105: Number((cover105 / n).toFixed(4)),
    cover110: Number((cover110 / n).toFixed(4)),
    weak: Number((weak / n).toFixed(4)),
    avgSinr:
      sinrN > 0
        ? Number(
            (
              useLinearDomainAverage
                ? linearToDb(sinrLinearSum / sinrN)
                : sinrSum / sinrN
            ).toFixed(2)
          )
        : 0,
    p50Sinr: sinrN > 0 ? percentile(sinrs, 0.5) : 0,
    sinrCover10: sinrN > 0 ? Number((sinrCover10 / sinrN).toFixed(4)) : 0,
    sinrCover5: sinrN > 0 ? Number((sinrCover5 / sinrN).toFixed(4)) : 0,
    sinrCover0: sinrN > 0 ? Number((sinrCover0 / sinrN).toFixed(4)) : 0,
    sinrCoverNeg5: sinrN > 0 ? Number((sinrCoverNeg5 / sinrN).toFixed(4)) : 0,
    sinrWeak: sinrN > 0 ? Number((sinrWeak / sinrN).toFixed(4)) : 0,
    rangeExcellent: Number((rangeExcellent / n).toFixed(4)),
    rangeGood: Number((rangeGood / n).toFixed(4)),
    rangeMedium: Number((rangeMedium / n).toFixed(4)),
    rangeWeak: Number((rangeWeak / n).toFixed(4)),
    sinrRangeExcellent: sinrN > 0 ? Number((sinrRangeExcellent / sinrN).toFixed(4)) : 0,
    sinrRangeGood: sinrN > 0 ? Number((sinrRangeGood / sinrN).toFixed(4)) : 0,
    sinrRangeMedium: sinrN > 0 ? Number((sinrRangeMedium / sinrN).toFixed(4)) : 0,
    sinrRangeWeak: sinrN > 0 ? Number((sinrRangeWeak / sinrN).toFixed(4)) : 0,
  };
}

function buildCoverageStats(
  samples: RsrpSample[],
  useLinearDomainAverage = false
): LuceCoverageStats {
  const serving = samples.filter((s) => s.kind === "serving");
  const byPci: Record<string, CoverageSummary> = {};
  const pciMap = new Map<number, RsrpSample[]>();
  for (const s of serving) {
    const arr = pciMap.get(s.pci) ?? [];
    arr.push(s);
    pciMap.set(s.pci, arr);
  }
  for (const [pci, arr] of pciMap) {
    const sm = summarize(arr, useLinearDomainAverage);
    if (sm) byPci[String(pci)] = sm;
  }
  return {
    serving: summarize(serving, useLinearDomainAverage),
    byPci,
  };
}

function resultFileName(variant: LuceVariant): string {
  return variant === "after" ? "luce-result-after.json" : "luce-result.json";
}

export function resultPath(
  batchId: string,
  variant: LuceVariant = "before"
): string {
  return path.join(batchDir(batchId), resultFileName(variant));
}

interface PciAcc {
  rsrpSum: number;
  rsrpLinearSum: number;
  sinrSum: number;
  sinrLinearSum: number;
  sinrCount: number;
  count: number;
}

function buildGrid(
  samples: RsrpSample[],
  sizeM: number,
  gridOpts: GridIndexOptions,
  preferredPcis: number[] = [],
  useLinearDomainAverage = false,
  gridAggMode: GridAggMode = "dominant_pci",
  log?: (msg: string) => void
): GridCell[] {
  const preferredSet = new Set(preferredPcis);
  const allPointsMean = gridAggMode === "all_points_mean";

  const buckets = new Map<
    string,
    { gx: number; gy: number; byPci: Map<number, PciAcc> }
  >();

  for (const s of samples) {
    const { gx, gy } = gridIndicesFromLonLat(
      s.longitude,
      s.latitude,
      sizeM,
      gridOpts
    );
    const key = `${gx},${gy}`;
    const hasSinr = s.sinr !== undefined && Number.isFinite(s.sinr);

    let cell = buckets.get(key);
    if (!cell) {
      cell = { gx, gy, byPci: new Map() };
      buckets.set(key, cell);
    }

    const acc = cell.byPci.get(s.pci);
    if (acc) {
      acc.rsrpSum += s.rsrp;
      acc.rsrpLinearSum += dbToLinear(s.rsrp);
      if (hasSinr) { acc.sinrSum += s.sinr!; acc.sinrCount++; }
      if (hasSinr) acc.sinrLinearSum += dbToLinear(s.sinr!);
      acc.count += 1;
    } else {
      cell.byPci.set(s.pci, {
        rsrpSum: s.rsrp,
        rsrpLinearSum: dbToLinear(s.rsrp),
        sinrSum: hasSinr ? s.sinr! : 0,
        sinrLinearSum: hasSinr ? dbToLinear(s.sinr!) : 0,
        sinrCount: hasSinr ? 1 : 0,
        count: 1,
      });
    }
  }

  let tieCount = 0;

  return [...buckets.values()].map((cell) => {
    let bestPci = 0;
    let bestCount = 0;
    let tied = false;

    for (const [pci, acc] of cell.byPci) {
      if (acc.count > bestCount) {
        bestPci = pci;
        bestCount = acc.count;
        tied = false;
      } else if (acc.count === bestCount) {
        tied = true;
        if (preferredSet.has(pci) && !preferredSet.has(bestPci)) {
          bestPci = pci;
        }
      }
    }

    if (tied) {
      tieCount++;
      if (tieCount <= 5) {
        const pcis = [...cell.byPci.entries()]
          .filter(([, a]) => a.count === bestCount)
          .map(([p]) => p);
        log?.(
          `栅格 (${cell.gx},${cell.gy}) PCI 数量相同 [${pcis.join(",")}]×${bestCount}，选择 PCI ${bestPci}${preferredSet.has(bestPci) ? "（优先PCI）" : ""}`
        );
      }
    }

    let rsrpSum = 0;
    let rsrpLinearSum = 0;
    let sinrSum = 0;
    let sinrLinearSum = 0;
    let sinrCount = 0;
    let totalCount = 0;

    if (allPointsMean) {
      for (const acc of cell.byPci.values()) {
        totalCount += acc.count;
        rsrpSum += acc.rsrpSum;
        rsrpLinearSum += acc.rsrpLinearSum;
        sinrSum += acc.sinrSum;
        sinrLinearSum += acc.sinrLinearSum;
        sinrCount += acc.sinrCount;
      }
    } else {
      const b = cell.byPci.get(bestPci)!;
      totalCount = b.count;
      rsrpSum = b.rsrpSum;
      rsrpLinearSum = b.rsrpLinearSum;
      sinrSum = b.sinrSum;
      sinrLinearSum = b.sinrLinearSum;
      sinrCount = b.sinrCount;
    }

    const bounds = cellBoundsFromIndices(cell.gx, cell.gy, sizeM, gridOpts);
    return {
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
      longitude: bounds.longitude,
      latitude: bounds.latitude,
      rsrp:
        totalCount > 0
          ? useLinearDomainAverage
            ? linearToDb(rsrpLinearSum / totalCount)
            : rsrpSum / totalCount
          : Number.NaN,
      sinr:
        sinrCount > 0
          ? useLinearDomainAverage
            ? linearToDb(sinrLinearSum / sinrCount)
            : sinrSum / sinrCount
          : Number.NaN,
      pci: bestPci,
      count: totalCount,
    };
  });
}

/** 优化后 RSRP/SINR 整体偏移（展示/对比用，不写入磁盘 JSON） */
export function applyAfterMetricOffsets(
  result: LuceProcessResult,
  settings: LuceSettings
): LuceProcessResult {
  const rsrpOff = settings.afterRsrpOffsetDb ?? 0;
  const sinrOff = settings.afterSinrOffsetDb ?? 0;
  if (rsrpOff === 0 && sinrOff === 0) return result;

  const adjRsrp = (v: number) => Number((v + rsrpOff).toFixed(4));
  const adjSinr = (v: number) => Number((v + sinrOff).toFixed(4));
  const useLinear = settings.useLinearDomainAverage ?? false;

  const samples = result.samples.map((s) => ({
    ...s,
    rsrp: adjRsrp(s.rsrp),
    sinr:
      s.sinr !== undefined && Number.isFinite(s.sinr)
        ? adjSinr(s.sinr)
        : s.sinr,
  }));
  const grid = result.grid?.map((c) => ({
    ...c,
    rsrp: adjRsrp(c.rsrp),
    sinr: Number.isFinite(c.sinr) ? adjSinr(c.sinr) : c.sinr,
  }));

  let coverage = result.coverage;
  if (grid?.length) {
    coverage = buildCoverageStatsFromGrid(
      grid,
      useLinear,
      result.coverage?.allServingCount
    );
  } else if (samples.length > 0) {
    coverage = {
      ...buildCoverageStats(
        samples.filter((s) => s.kind === "serving"),
        useLinear
      ),
      allServingCount: result.coverage?.allServingCount,
    };
  }

  return { ...result, samples, grid, coverage };
}

function summarizeGridCells(
  cells: GridCell[],
  useLinearDomainAverage = false
): CoverageSummary | null {
  if (cells.length === 0) return null;

  let totalCount = 0;
  let sumRsrp = 0;
  let sumRsrpLinear = 0;
  let sumSinr = 0;
  let sumSinrLinear = 0;
  let sinrCount = 0;
  let cover75 = 0;
  let cover85 = 0;
  let cover90 = 0;
  let cover95 = 0;
  let cover100 = 0;
  let cover105 = 0;
  let cover110 = 0;
  let weak = 0;
  let rangeExcellent = 0;
  let rangeGood = 0;
  let rangeMedium = 0;
  let rangeWeak = 0;
  let sinrCover10 = 0;
  let sinrCover5 = 0;
  let sinrCover0 = 0;
  let sinrCoverNeg5 = 0;
  let sinrWeak = 0;
  let sinrRangeExcellent = 0;
  let sinrRangeGood = 0;
  let sinrRangeMedium = 0;
  let sinrRangeWeak = 0;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;
  const buckets: { rsrp: number; count: number }[] = [];
  const sinrBuckets: { sinr: number; count: number }[] = [];

  for (const c of cells) {
    totalCount += c.count;
    sumRsrp += c.rsrp * c.count;
    if (useLinearDomainAverage) {
      sumRsrpLinear += dbToLinear(c.rsrp) * c.count;
    }
    if (c.rsrp >= -75) cover75 += c.count;
    if (c.rsrp >= -85) cover85 += c.count;
    if (c.rsrp >= -90) cover90 += c.count;
    if (c.rsrp >= -95) cover95 += c.count;
    if (c.rsrp >= -100) cover100 += c.count;
    if (c.rsrp >= -105) cover105 += c.count;
    if (c.rsrp >= -110) cover110 += c.count;
    if (c.rsrp < -110) weak += c.count;
    if (c.rsrp >= -80) rangeExcellent += c.count;
    if (c.rsrp >= -90 && c.rsrp < -80) rangeGood += c.count;
    if (c.rsrp >= -100 && c.rsrp < -90) rangeMedium += c.count;
    if (c.rsrp >= -110 && c.rsrp < -100) rangeWeak += c.count;
    if (Number.isFinite(c.sinr)) {
      sumSinr += c.sinr * c.count;
      if (useLinearDomainAverage) {
        sumSinrLinear += dbToLinear(c.sinr) * c.count;
      }
      sinrCount += c.count;
      sinrBuckets.push({ sinr: c.sinr, count: c.count });
      if (c.sinr >= 10) sinrCover10 += c.count;
      if (c.sinr >= 5) sinrCover5 += c.count;
      if (c.sinr >= 0) sinrCover0 += c.count;
      if (c.sinr >= -5) sinrCoverNeg5 += c.count;
      if (c.sinr < -5) sinrWeak += c.count;
      if (c.sinr >= 10) sinrRangeExcellent += c.count;
      if (c.sinr >= 5 && c.sinr < 10) sinrRangeGood += c.count;
      if (c.sinr >= 0 && c.sinr < 5) sinrRangeMedium += c.count;
      if (c.sinr >= -5 && c.sinr < 0) sinrRangeWeak += c.count;
    }
    if (c.rsrp < minR) minR = c.rsrp;
    if (c.rsrp > maxR) maxR = c.rsrp;
    buckets.push({ rsrp: c.rsrp, count: c.count });
  }
  if (totalCount === 0) return null;

  buckets.sort((a, b) => a.rsrp - b.rsrp);
  const pVal = (q: number): number => {
    let accum = 0;
    const target = totalCount * q;
    for (const b of buckets) {
      accum += b.count;
      if (accum >= target) return b.rsrp;
    }
    return buckets[buckets.length - 1].rsrp;
  };

  return {
    count: totalCount,
    avgRsrp: Number(
      (
        useLinearDomainAverage
          ? linearToDb(sumRsrpLinear / totalCount)
          : sumRsrp / totalCount
      ).toFixed(2)
    ),
    minRsrp: Number(minR.toFixed(2)),
    maxRsrp: Number(maxR.toFixed(2)),
    p10: pVal(0.1),
    p50: pVal(0.5),
    p90: pVal(0.9),
    cover75: Number((cover75 / totalCount).toFixed(4)),
    cover85: Number((cover85 / totalCount).toFixed(4)),
    cover90: Number((cover90 / totalCount).toFixed(4)),
    cover95: Number((cover95 / totalCount).toFixed(4)),
    cover100: Number((cover100 / totalCount).toFixed(4)),
    cover105: Number((cover105 / totalCount).toFixed(4)),
    cover110: Number((cover110 / totalCount).toFixed(4)),
    weak: Number((weak / totalCount).toFixed(4)),
    avgSinr:
      sinrCount > 0
        ? Number(
            (
              useLinearDomainAverage
                ? linearToDb(sumSinrLinear / sinrCount)
                : sumSinr / sinrCount
            ).toFixed(2)
          )
        : 0,
    p50Sinr:
      sinrCount > 0
        ? (() => {
            sinrBuckets.sort((a, b) => a.sinr - b.sinr);
            let acc = 0;
            const target = sinrCount * 0.5;
            for (const b of sinrBuckets) {
              acc += b.count;
              if (acc >= target) return Number(b.sinr.toFixed(2));
            }
            return Number(sinrBuckets[sinrBuckets.length - 1].sinr.toFixed(2));
          })()
        : 0,
    sinrCover10:
      sinrCount > 0 ? Number((sinrCover10 / sinrCount).toFixed(4)) : 0,
    sinrCover5: sinrCount > 0 ? Number((sinrCover5 / sinrCount).toFixed(4)) : 0,
    sinrCover0: sinrCount > 0 ? Number((sinrCover0 / sinrCount).toFixed(4)) : 0,
    sinrCoverNeg5:
      sinrCount > 0 ? Number((sinrCoverNeg5 / sinrCount).toFixed(4)) : 0,
    sinrWeak: sinrCount > 0 ? Number((sinrWeak / sinrCount).toFixed(4)) : 0,
    rangeExcellent: Number((rangeExcellent / totalCount).toFixed(4)),
    rangeGood: Number((rangeGood / totalCount).toFixed(4)),
    rangeMedium: Number((rangeMedium / totalCount).toFixed(4)),
    rangeWeak: Number((rangeWeak / totalCount).toFixed(4)),
    sinrRangeExcellent:
      sinrCount > 0 ? Number((sinrRangeExcellent / sinrCount).toFixed(4)) : 0,
    sinrRangeGood:
      sinrCount > 0 ? Number((sinrRangeGood / sinrCount).toFixed(4)) : 0,
    sinrRangeMedium:
      sinrCount > 0 ? Number((sinrRangeMedium / sinrCount).toFixed(4)) : 0,
    sinrRangeWeak:
      sinrCount > 0 ? Number((sinrRangeWeak / sinrCount).toFixed(4)) : 0,
  };
}

function buildCoverageStatsFromGrid(
  grid: GridCell[],
  useLinearDomainAverage: boolean,
  allServingCount?: number
): LuceCoverageStats {
  const byPci: Record<string, CoverageSummary> = {};
  const pciMap = new Map<number, GridCell[]>();
  for (const c of grid) {
    const arr = pciMap.get(c.pci) ?? [];
    arr.push(c);
    pciMap.set(c.pci, arr);
  }
  for (const [pci, cells] of pciMap) {
    const sm = summarizeGridCells(cells, useLinearDomainAverage);
    if (sm) byPci[String(pci)] = sm;
  }
  return {
    serving: summarizeGridCells(grid, useLinearDomainAverage),
    byPci,
    allServingCount,
  };
}

export async function loadLuceResult(
  batchId: string,
  variant: LuceVariant = "before"
): Promise<LuceProcessResult | null> {
  try {
    const raw = await fs.promises.readFile(
      resultPath(batchId, variant),
      "utf-8"
    );
    let result = JSON.parse(raw) as LuceProcessResult;
    if (variant === "after") {
      const settings = await loadLuceSettings(batchId);
      result = applyAfterMetricOffsets(result, settings);
    }
    return result;
  } catch {
    return null;
  }
}

export async function hasAfterSource(batchId: string): Promise<boolean> {
  try {
    const names = await fs.promises.readdir(luceSourceDir(batchId, "after"));
    return names.some((n) => n.toLowerCase().endsWith(".csv"));
  } catch {
    return false;
  }
}

/**
 * Quick count of ALL serving samples in the region from extract TSVs,
 * ignoring the PCI filter. Used to compute serving dominance ratio.
 * Extract TSV columns: lon lat time servingPci servingRsrp ...
 */
async function countAllServingInRegion(
  batchId: string,
  variant: LuceVariant,
  manifest: { files: { extract: string }[] },
  settings: LuceSettings
): Promise<number> {
  const mPerDeg = 111_320;
  const cosLat = Math.cos((settings.regionCenterLat * Math.PI) / 180);
  const cLon = settings.regionCenterLon;
  const cLat = settings.regionCenterLat;
  const r2 = settings.regionRadiusMeters * settings.regionRadiusMeters;
  const useRegion = settings.useRegionFilter;

  let count = 0;
  for (const f of manifest.files) {
    const tsvAbs = path.join(batchDir(batchId), f.extract);
    const rl = createInterface({
      input: fs.createReadStream(tsvAbs, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const tab1 = line.indexOf("\t");
      if (tab1 < 0) continue;
      const tab2 = line.indexOf("\t", tab1 + 1);
      if (tab2 < 0) continue;
      const tab3 = line.indexOf("\t", tab2 + 1);
      if (tab3 < 0) continue;
      const tab4 = line.indexOf("\t", tab3 + 1);
      if (tab4 < 0) continue;

      const spci = line.substring(tab3 + 1, tab4);
      if (!spci || spci === "" || spci === "-") continue;

      const srsrp = line.substring(tab4 + 1, line.indexOf("\t", tab4 + 1) >>> 0 || undefined);
      if (!srsrp || srsrp === "") continue;

      const lon = Number(line.substring(0, tab1));
      const lat = Number(line.substring(tab1 + 1, tab2));
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      if (useRegion) {
        const dx = (lon - cLon) * mPerDeg * cosLat;
        const dy = (lat - cLat) * mPerDeg;
        if (dx * dx + dy * dy > r2) continue;
      }
      if (settings.useGrasslandFilter) {
        const bb = resolveGrasslandBbox(settings);
        if (lon < bb.lonMin || lon > bb.lonMax) continue;
        if (lat < bb.latMin || lat > bb.latMax) continue;
      }
      count++;
    }
  }
  return count;
}

export async function processLuceBatch(
  batchId: string,
  settingsOverride?: Partial<LuceSettings>,
  emit?: (e: LuceProcessEvent) => void,
  variant: LuceVariant = "before"
): Promise<LuceProcessResult> {
  const emitEv = emit ?? (() => {});
  let settings: LuceSettings = {
    ...(await loadLuceSettings(batchId)),
    ...settingsOverride,
  };

  const servingFilter = settings.servingPciFilter;
  const neighborFilter = settings.neighborPciFilter;
  const servingExclude = settings.servingPciExclude ?? [];
  const neighborExclude = settings.neighborPciExclude ?? [];

  const variantLabel = variant === "after" ? "优化后" : "优化前";
  emitEv({
    type: "log",
    message: `开始路测数据处理（awk 加速 / ${variantLabel}）…`,
  });
  emitEv({
    type: "log",
    message:
      `主区 PCI：${servingFilter.length ? servingFilter.join(", ") : "全部"}` +
      (servingExclude.length ? `，排除 ${servingExclude.join(", ")}` : "") +
      `；邻区 PCI：${neighborFilter.length ? neighborFilter.join(", ") : "全部"}` +
      (neighborExclude.length ? `，排除 ${neighborExclude.join(", ")}` : ""),
  });

  emitEv({ type: "progress", percent: 5, message: "awk 提取关键列…" });
  const manifest = await syncLuceExtracts(batchId, variant, emitEv);

  const paths: DrivePath[] =
    variant === "after"
      ? []
      : await (async () => {
          emitEv({
            type: "progress",
            percent: 15,
            message: "awk 计算轨迹…",
          });
          return buildPathsCache(batchId, variant, manifest, emitEv);
        })();

  const samples = await filterSamplesWithAwk(
    batchId,
    variant,
    manifest,
    settings,
    emitEv
  );

  emitEv({ type: "log", message: "正在生成栅格与结果文件…" });

  let grid: GridCell[] | undefined;
  const useGridAgg =
    settings.useGrid ||
    settings.displayMode === "grid" ||
    settings.displayMode === "heatmap";

  if (settings.gridIndexMode === "dataset") {
    const hasRef =
      Number.isFinite(settings.gridRefLon) &&
      Number.isFinite(settings.gridRefLat);
    const afterExists = await hasAfterSource(batchId);
    const useNotebookCombined =
      settings.gridRefOrigin === "notebook-combined" &&
      afterExists &&
      variant === "after";

    let refSamples = samples;
    let shouldUpdateRef = false;

    if (useNotebookCombined) {
      emitEv({
        type: "log",
        message: "Notebook 原点：合并优化前+优化后采样计算经纬度中位数…",
      });
      const beforeManifest = await syncLuceExtracts(batchId, "before", emitEv);
      const beforeSamples = await filterSamplesWithAwk(
        batchId,
        "before",
        beforeManifest,
        settings,
        emitEv
      );
      refSamples = [...beforeSamples, ...samples];
      shouldUpdateRef = refSamples.length > 0;
    } else if (variant === "before") {
      refSamples = samples;
      shouldUpdateRef = !hasRef && samples.length > 0;
    }

    if (shouldUpdateRef) {
      const { lon, lat } = medianLonLatFromSamples(refSamples);
      settings = { ...settings, gridRefLon: lon, gridRefLat: lat };
      await saveLuceSettings(batchId, settings);
      const label = useNotebookCombined
        ? "Notebook 合并优化前后"
        : "优化前";
      emitEv({
        type: "log",
        message: `数据集栅格原点（${label} 中位数）：${lon.toFixed(6)}, ${lat.toFixed(6)}`,
      });
      if (useNotebookCombined) {
        emitEv({
          type: "log",
          message:
            "已写入合并原点。请再对「优化前」执行保存并重新处理，使前后栅格键与 Notebook 一致。",
        });
      }
    }
  }

  const gridOpts = gridIndexOptionsFromSettings(settings);

  if (useGridAgg && samples.length > 0) {
    const modeLabel =
      settings.gridIndexMode === "dataset" ? "数据集原点" : "全球 floor";
    const aggLabel =
      settings.gridAggMode === "all_points_mean"
        ? "格内全点均值"
        : "主服PCI众数";
    emitEv({
      type: "log",
      message: `栅格聚合（${settings.gridSizeMeters}m，${modeLabel}，${aggLabel}）…`,
    });
    grid = buildGrid(
      samples,
      settings.gridSizeMeters,
      gridOpts,
      settings.servingPciFilter,
      settings.useLinearDomainAverage,
      settings.gridAggMode ?? "dominant_pci",
      (msg) => emitEv({ type: "log", message: msg })
    );
  }

  const coverage = buildCoverageStats(samples, settings.useLinearDomainAverage);

  if (settings.servingPciFilter.length > 0) {
    coverage.allServingCount = await countAllServingInRegion(
      batchId,
      variant,
      manifest,
      settings
    );
  }

  const stats: LuceProcessResult["stats"] = {
    totalRows: manifest.files.reduce((n, f) => n + f.rows, 0),
    skippedNoLocation: 0,
    skippedEmptyRsrp: 0,
    servingSamples: samples.filter((s) => s.kind === "serving").length,
    neighborSamples: samples.filter((s) => s.kind === "neighbor").length,
    outputSamples: samples.length,
    pathSegments: paths.length,
    pathPoints: paths.reduce((n, p) => n + p.points.length, 0),
  };

  const result: LuceProcessResult = {
    paths,
    samples:
      useGridAgg && settings.displayMode !== "points"
        ? samples.slice(0, Math.min(samples.length, 5_000))
        : samples,
    grid,
    stats,
    coverage,
    processedAt: new Date().toISOString(),
    settings,
    cacheKey: manifestKey(manifest),
  };

  await fs.promises.writeFile(
    resultPath(batchId, variant),
    JSON.stringify(result),
    "utf-8"
  );

  emitEv({
    type: "progress",
    percent: 100,
    message: "处理完成",
  });
  emitEv({
    type: "done",
    message: `路测处理完成：${paths.length} 条轨迹共 ${stats.pathPoints} 点，RSRP 采样 ${stats.outputSamples} 个${
      grid ? `，栅格 ${grid.length} 格` : ""
    }`,
    summary: {
      stats: result.stats,
      processedAt: result.processedAt,
      settings: result.settings,
      pathSegments: paths.length,
      pathPoints: stats.pathPoints,
      sampleCount: result.samples.length,
      gridCount: result.grid?.length ?? 0,
    },
  });

  return result;
}

export function buildLuceGridFromSamples(
  samples: RsrpSample[],
  settings: LuceSettings
): GridCell[] {
  if (samples.length === 0) return [];
  return buildGrid(
    samples,
    settings.gridSizeMeters,
    gridIndexOptionsFromSettings(settings),
    settings.servingPciFilter,
    settings.useLinearDomainAverage,
    settings.gridAggMode ?? "dominant_pci"
  );
}
