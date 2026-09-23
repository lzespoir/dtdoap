import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { batchDir } from "./batchStorage.js";
import { loadLuceResult } from "./luceProcessor.js";
import { loadLuceSettings } from "./luceSettings.js";
import { SCRIPTS_DIR } from "./luceShell.js";
import type {
  CoverageStats,
  GridDeltaStats,
  HistogramBin,
  GridMatchInfo,
  GridMatchMode,
  MetricHistogram,
  OptimizationCompare,
  OptimizationSuggestion,
  OptimizationSuggestionResult,
  PciCoverage,
  TargetGroupServingStats,
} from "./types/optimize.js";
import type {
  CoverageSummary,
  GridCell,
  LuceProcessResult,
  RsrpSample,
} from "./types/luce.js";
import {
  gridIndexOptionsFromSettings,
  gridKeyFromCell,
  type GridIndexOptions,
} from "./gridUtils.js";
import {
  defaultLuceSampleDir,
  importLuceFromDir,
} from "./luceSampleDirs.js";

const execFileAsync = promisify(execFile);

const SUGGESTION_FILE = "optimize-params.json";

/** @deprecated 使用 defaultLuceSampleDir("after").absolutePath */
export const DEFAULT_AFTER_SAMPLE_DIR = defaultLuceSampleDir("after").absolutePath;

export function suggestionsPath(batchId: string): string {
  return path.join(batchDir(batchId), SUGGESTION_FILE);
}

export async function loadSuggestions(
  batchId: string
): Promise<OptimizationSuggestionResult | null> {
  try {
    const raw = await fs.promises.readFile(suggestionsPath(batchId), "utf-8");
    return JSON.parse(raw) as OptimizationSuggestionResult;
  } catch {
    return null;
  }
}

async function saveSuggestions(
  batchId: string,
  result: OptimizationSuggestionResult
): Promise<void> {
  await fs.promises.writeFile(
    suggestionsPath(batchId),
    JSON.stringify(result, null, 2),
    "utf-8"
  );
}

function resolvePython(): string {
  return process.env.NETOPT_PYTHON ?? "python3";
}

export interface RunSuggestOptions {
  /** 目标 PCI 列表（未传则使用脚本默认 353/294/330/69） */
  pcis?: number[];
  /** 强制重算 */
  force?: boolean;
}

export async function runOptimizationSuggest(
  batchId: string,
  opts: RunSuggestOptions = {}
): Promise<OptimizationSuggestionResult> {
  if (!opts.force) {
    const cached = await loadSuggestions(batchId);
    if (cached) return cached;
  }

  const script = path.join(SCRIPTS_DIR, "optimize_params.py");
  const args = ["--batch-dir", batchDir(batchId)];
  if (opts.pcis?.length) {
    args.push("--pci", opts.pcis.join(","));
  }

  const { stdout } = await execFileAsync(resolvePython(), [script, ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as Omit<
    OptimizationSuggestionResult,
    "generatedAt"
  >;
  const result: OptimizationSuggestionResult = {
    ...parsed,
    generatedAt: new Date().toISOString(),
  };
  await saveSuggestions(batchId, result);
  return result;
}

/** 把外部目录里的 csv 拷贝进 batch/luce-after/ */
export async function importAfterFromDir(
  batchId: string,
  sourceDir?: string
) {
  return importLuceFromDir(batchId, "after", sourceDir);
}

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

function statsForSamples(
  samples: RsrpSample[],
  useLinearDomainAverage = false
): CoverageStats | null {
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
  let sinrCover10 = 0;
  let sinrCover5 = 0;
  let sinrCover0 = 0;
  let sinrCoverNeg5 = 0;
  let sinrWeak = 0; // < -5
  let sinrRangeExcellent = 0; // >= 10
  let sinrRangeGood = 0; // [5,10)
  let sinrRangeMedium = 0; // [0,5)
  let sinrRangeWeak = 0; // [-5,0)
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
    sinrRangeExcellent:
      sinrN > 0 ? Number((sinrRangeExcellent / sinrN).toFixed(4)) : 0,
    sinrRangeGood:
      sinrN > 0 ? Number((sinrRangeGood / sinrN).toFixed(4)) : 0,
    sinrRangeMedium:
      sinrN > 0 ? Number((sinrRangeMedium / sinrN).toFixed(4)) : 0,
    sinrRangeWeak:
      sinrN > 0 ? Number((sinrRangeWeak / sinrN).toFixed(4)) : 0,
  };
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Number((a - b).toFixed(4));
}

function summaryToStats(s: CoverageSummary | null | undefined): CoverageStats | null {
  if (!s) return null;
  return {
    ...s,
    cover75: (s as any).cover75 ?? 0,
    cover85: (s as any).cover85 ?? 0,
    cover90: s.cover90 ?? 0,
    cover100: s.cover100 ?? 0,
    cover110: s.cover110 ?? 0,
    avgSinr: s.avgSinr ?? 0,
    p50Sinr: s.p50Sinr ?? 0,
    sinrCover10: s.sinrCover10 ?? 0,
    sinrCover5: s.sinrCover5 ?? 0,
    sinrCover0: s.sinrCover0 ?? 0,
    sinrCoverNeg5: s.sinrCoverNeg5 ?? 0,
    sinrWeak: s.sinrWeak ?? 0,
    rangeExcellent: s.rangeExcellent ?? 0,
    rangeGood: s.rangeGood ?? 0,
    rangeMedium: s.rangeMedium ?? 0,
    rangeWeak: s.rangeWeak ?? 0,
    sinrRangeExcellent: s.sinrRangeExcellent ?? 0,
    sinrRangeGood: s.sinrRangeGood ?? 0,
    sinrRangeMedium: s.sinrRangeMedium ?? 0,
    sinrRangeWeak: s.sinrRangeWeak ?? 0,
  };
}

/** 优先使用预计算 coverage，回退到 samples（截断时不完整） */
function overallStats(
  res: LuceProcessResult | null,
  useLinearDomainAverage = false
): CoverageStats | null {
  if (!res) return null;
  if (res.coverage?.serving) {
    const s = res.coverage.serving as unknown as CoverageSummary;
    // 兼容旧缓存：老数据可能没有 sinrCover* / sinrRange* 字段
    if (
      Number.isFinite((s as any).sinrCover0) &&
      Number.isFinite((s as any).sinrWeak) &&
      Number.isFinite((s as any).sinrRangeExcellent)
    ) {
      return summaryToStats(res.coverage.serving);
    }
  }
  return statsForSamples(
    (res.samples ?? []).filter((s) => s.kind === "serving"),
    useLinearDomainAverage
  );
}

function statsForPci(
  res: LuceProcessResult | null,
  pci: number,
  useLinearDomainAverage = false
): CoverageStats | null {
  if (!res) return null;
  const pre = res.coverage?.byPci?.[String(pci)];
  if (pre) {
    const s = pre as any;
    if (
      Number.isFinite(s.sinrCover0) &&
      Number.isFinite(s.sinrWeak) &&
      Number.isFinite(s.sinrRangeExcellent)
    ) {
      return summaryToStats(pre);
    }
  }
  return statsForSamples(
    (res.samples ?? []).filter((s) => s.kind === "serving" && s.pci === pci),
    useLinearDomainAverage
  );
}

/** 把全量 coverage 按目标 PCI 子集汇总：count 加权平均；覆盖率按 count 加权 */
function aggregateByPciSubset(
  res: LuceProcessResult | null,
  pcis: number[],
  useLinearDomainAverage = false
): CoverageStats | null {
  if (!res?.coverage?.byPci) return overallStats(res, useLinearDomainAverage);
  if (pcis.length === 0) return overallStats(res, useLinearDomainAverage);
  // 兼容旧缓存：如果 coverage.byPci 缺失 SINR 分段字段，则直接从 samples 重新计算
  const first = res.coverage.byPci[String(pcis[0])];
  if (first) {
    const s = first as any;
    if (
      !Number.isFinite(s.sinrCover0) ||
      !Number.isFinite(s.sinrWeak) ||
      !Number.isFinite(s.sinrRangeExcellent)
    ) {
      const pcisSet = new Set(pcis);
      return statsForSamples(
        (res.samples ?? []).filter(
          (x) => x.kind === "serving" && pcisSet.has(x.pci)
        ),
        useLinearDomainAverage
      );
    }
  }

  let count = 0;
  let sumRsrp = 0;
  let c75Cnt = 0;
  let c85Cnt = 0;
  let c90Cnt = 0;
  let c95Cnt = 0;
  let c100Cnt = 0;
  let c105Cnt = 0;
  let c110Cnt = 0;
  let weakCnt = 0;
  let rgExcellent = 0;
  let rgGood = 0;
  let rgMedium = 0;
  let rgWeak = 0;
  // SINR bins（阈值：>=10, >=5, >=0, >=-5；以及 < -5 极弱）
  let sinrCover10Cnt = 0;
  let sinrCover5Cnt = 0;
  let sinrCover0Cnt = 0;
  let sinrCoverNeg5Cnt = 0;
  let sinrWeakCnt = 0; // < -5
  let sinrRangeExcellent = 0;
  let sinrRangeGood = 0;
  let sinrRangeMedium = 0;
  let sinrRangeWeak = 0;
  let sinrW = 0;
  let sinrP50W = 0;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;
  let p10w = 0;
  let p50w = 0;
  let p90w = 0;

  let any = false;
  for (const pci of pcis) {
    const s = res.coverage.byPci[String(pci)];
    if (!s) continue;
    any = true;
    count += s.count;
    sumRsrp += s.avgRsrp * s.count;
    c75Cnt += ((s as any).cover75 ?? 0) * s.count;
    c85Cnt += ((s as any).cover85 ?? 0) * s.count;
    c90Cnt += (s.cover90 ?? 0) * s.count;
    c95Cnt += s.cover95 * s.count;
    c100Cnt += (s.cover100 ?? 0) * s.count;
    c105Cnt += s.cover105 * s.count;
    c110Cnt += (s.cover110 ?? 0) * s.count;
    weakCnt += s.weak * s.count;
    sinrW += (s.avgSinr ?? 0) * s.count;
    sinrP50W += (s.p50Sinr ?? 0) * s.count;
    sinrCover10Cnt += (s.sinrCover10 ?? 0) * s.count;
    sinrCover5Cnt += (s.sinrCover5 ?? 0) * s.count;
    sinrCover0Cnt += (s.sinrCover0 ?? 0) * s.count;
    sinrCoverNeg5Cnt += (s.sinrCoverNeg5 ?? 0) * s.count;
    sinrWeakCnt += (s.sinrWeak ?? 0) * s.count;
    rgExcellent += (s.rangeExcellent ?? 0) * s.count;
    rgGood += (s.rangeGood ?? 0) * s.count;
    rgMedium += (s.rangeMedium ?? 0) * s.count;
    rgWeak += (s.rangeWeak ?? 0) * s.count;
    sinrRangeExcellent += (s.sinrRangeExcellent ?? 0) * s.count;
    sinrRangeGood += (s.sinrRangeGood ?? 0) * s.count;
    sinrRangeMedium += (s.sinrRangeMedium ?? 0) * s.count;
    sinrRangeWeak += (s.sinrRangeWeak ?? 0) * s.count;
    p10w += s.p10 * s.count;
    p50w += s.p50 * s.count;
    p90w += s.p90 * s.count;
    if (s.minRsrp < minR) minR = s.minRsrp;
    if (s.maxRsrp > maxR) maxR = s.maxRsrp;
  }
  if (!any || count === 0) return null;
  return {
    count,
    avgRsrp: Number((sumRsrp / count).toFixed(2)),
    minRsrp: minR,
    maxRsrp: maxR,
    p10: Number((p10w / count).toFixed(2)),
    p50: Number((p50w / count).toFixed(2)),
    p90: Number((p90w / count).toFixed(2)),
    cover75: Number((c75Cnt / count).toFixed(4)),
    cover85: Number((c85Cnt / count).toFixed(4)),
    cover90: Number((c90Cnt / count).toFixed(4)),
    cover95: Number((c95Cnt / count).toFixed(4)),
    cover100: Number((c100Cnt / count).toFixed(4)),
    cover105: Number((c105Cnt / count).toFixed(4)),
    cover110: Number((c110Cnt / count).toFixed(4)),
    weak: Number((weakCnt / count).toFixed(4)),
    avgSinr: Number((sinrW / count).toFixed(2)),
    p50Sinr: Number((sinrP50W / count).toFixed(2)),
    sinrCover10: Number((sinrCover10Cnt / count).toFixed(4)),
    sinrCover5: Number((sinrCover5Cnt / count).toFixed(4)),
    sinrCover0: Number((sinrCover0Cnt / count).toFixed(4)),
    sinrCoverNeg5: Number((sinrCoverNeg5Cnt / count).toFixed(4)),
    sinrWeak: Number((sinrWeakCnt / count).toFixed(4)),
    rangeExcellent: Number((rgExcellent / count).toFixed(4)),
    rangeGood: Number((rgGood / count).toFixed(4)),
    rangeMedium: Number((rgMedium / count).toFixed(4)),
    rangeWeak: Number((rgWeak / count).toFixed(4)),
    sinrRangeExcellent: Number((sinrRangeExcellent / count).toFixed(4)),
    sinrRangeGood: Number((sinrRangeGood / count).toFixed(4)),
    sinrRangeMedium: Number((sinrRangeMedium / count).toFixed(4)),
    sinrRangeWeak: Number((sinrRangeWeak / count).toFixed(4)),
  };
}

function buildGridKeySet(
  grid: GridCell[],
  sizeM: number,
  opts: GridIndexOptions
): Set<string> {
  const s = new Set<string>();
  for (const c of grid) s.add(gridKeyFromCell(c, sizeM, opts));
  return s;
}

function filterGridByKeys(
  grid: GridCell[],
  allowed: Set<string>,
  sizeM: number,
  opts: GridIndexOptions
): GridCell[] {
  return grid.filter((c) => allowed.has(gridKeyFromCell(c, sizeM, opts)));
}

function statsFromGridCells(
  cells: GridCell[],
  useLinearDomainAverage = false
): CoverageStats | null {
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
  // SINR bins（阈值：>=10, >=5, >=0, >=-5；以及 < -5 极弱）
  let sinrCover10 = 0;
  let sinrCover5 = 0;
  let sinrCover0 = 0;
  let sinrCoverNeg5 = 0;
  let sinrWeak = 0; // < -5
  let sinrRangeExcellent = 0; // >= 10
  let sinrRangeGood = 0; // [5,10)
  let sinrRangeMedium = 0; // [0,5)
  let sinrRangeWeak = 0; // [-5,0)
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
    p50Sinr: sinrCount > 0 ? (() => {
      sinrBuckets.sort((a, b) => a.sinr - b.sinr);
      let acc = 0;
      const target = sinrCount * 0.5;
      for (const b of sinrBuckets) {
        acc += b.count;
        if (acc >= target) return Number(b.sinr.toFixed(2));
      }
      return Number(sinrBuckets[sinrBuckets.length - 1].sinr.toFixed(2));
    })() : 0,
    sinrCover10:
      sinrCount > 0 ? Number((sinrCover10 / sinrCount).toFixed(4)) : 0,
    sinrCover5:
      sinrCount > 0 ? Number((sinrCover5 / sinrCount).toFixed(4)) : 0,
    sinrCover0:
      sinrCount > 0 ? Number((sinrCover0 / sinrCount).toFixed(4)) : 0,
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

function buildGridKeyMap(
  grid: GridCell[],
  sizeM: number,
  opts: GridIndexOptions
): Map<string, GridCell> {
  const m = new Map<string, GridCell>();
  for (const c of grid) m.set(gridKeyFromCell(c, sizeM, opts), c);
  return m;
}

function computeGridDelta(
  beforeGrid: GridCell[],
  afterGrid: GridCell[],
  sizeM: number,
  opts: GridIndexOptions
): GridDeltaStats {
  const beforeMap = buildGridKeyMap(beforeGrid, sizeM, opts);
  const afterMap = buildGridKeyMap(afterGrid, sizeM, opts);

  let improved = 0;
  let degraded = 0;
  let unchanged = 0;

  for (const [key, bCell] of beforeMap) {
    const aCell = afterMap.get(key);
    if (!aCell) continue;
    const d = aCell.rsrp - bCell.rsrp;
    if (d > 0.5) improved++;
    else if (d < -0.5) degraded++;
    else unchanged++;
  }

  const common = improved + degraded + unchanged;
  return {
    commonGrids: common,
    improvedGrids: improved,
    degradedGrids: degraded,
    unchangedGrids: unchanged,
    improvedRatio: common > 0 ? Number((improved / common).toFixed(4)) : 0,
    degradedRatio: common > 0 ? Number((degraded / common).toFixed(4)) : 0,
  };
}

function computeTargetGroupServingStats(
  res: LuceProcessResult | null,
  targetPcis: number[]
): TargetGroupServingStats | undefined {
  if (!res?.coverage?.serving || targetPcis.length === 0) return undefined;

  const totalCount = res.coverage.allServingCount ?? res.coverage.serving.count;
  if (totalCount === 0) return undefined;

  const byPci: TargetGroupServingStats["byPci"] = [];
  let targetCount = 0;
  for (const pci of targetPcis) {
    const s = res.coverage.byPci?.[String(pci)];
    const cnt = s?.count ?? 0;
    targetCount += cnt;
    byPci.push({
      pci,
      count: cnt,
      ratio: Number((cnt / totalCount).toFixed(4)),
    });
  }
  return {
    targetCount,
    totalCount,
    ratio: Number((targetCount / totalCount).toFixed(4)),
    byPci,
  };
}

type WeightedMetricPoint = { value: number; count: number };

function buildMetricHistogram(
  before: WeightedMetricPoint[],
  after: WeightedMetricPoint[],
  metric: "rsrp" | "sinr"
): MetricHistogram | undefined {
  if (before.length === 0 && after.length === 0) return undefined;
  const all = [...before, ...after];
  if (all.length === 0) return undefined;

  const binSize = metric === "rsrp" ? 2 : 1;
  const unit = metric === "rsrp" ? "dBm" : "dB";
  const minV = Math.min(...all.map((p) => p.value));
  const maxV = Math.max(...all.map((p) => p.value));
  const start = Math.floor(minV / binSize) * binSize;
  let end = Math.ceil(maxV / binSize) * binSize;
  if (end <= start) end = start + binSize;
  const binCount = Math.max(1, Math.ceil((end - start) / binSize));

  const beforeBins = new Array<number>(binCount).fill(0);
  const afterBins = new Array<number>(binCount).fill(0);
  const toIndex = (v: number): number => {
    const raw = Math.floor((v - start) / binSize);
    return Math.min(binCount - 1, Math.max(0, raw));
  };
  for (const p of before) beforeBins[toIndex(p.value)] += p.count;
  for (const p of after) afterBins[toIndex(p.value)] += p.count;

  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const from = Number((start + i * binSize).toFixed(3));
    const to = Number((from + binSize).toFixed(3));
    bins.push({
      from,
      to,
      beforeCount: Math.round(beforeBins[i]),
      afterCount: Math.round(afterBins[i]),
    });
  }
  return { metric, unit, binSize, bins };
}

/** 直方图：按栅格计 1（每个栅格一条），不用栅格内采样点数加权 */
function cellsToMetricPoints(
  cells: GridCell[],
  metric: "rsrp" | "sinr"
): WeightedMetricPoint[] {
  const out: WeightedMetricPoint[] = [];
  for (const c of cells) {
    const v = metric === "rsrp" ? c.rsrp : c.sinr;
    if (!Number.isFinite(v)) continue;
    out.push({ value: Number(v), count: 1 });
  }
  return out;
}

function samplesToMetricPoints(
  samples: RsrpSample[],
  metric: "rsrp" | "sinr"
): WeightedMetricPoint[] {
  const out: WeightedMetricPoint[] = [];
  for (const s of samples) {
    const v = metric === "rsrp" ? s.rsrp : s.sinr;
    if (!Number.isFinite(v)) continue;
    out.push({ value: Number(v), count: 1 });
  }
  return out;
}

function qualityRatioFromMetricPoints(
  points: WeightedMetricPoint[],
  threshold: number
): number {
  let good = 0;
  let total = 0;
  for (const p of points) {
    total += p.count;
    if (p.value >= threshold) good += p.count;
  }
  return total > 0 ? Number((good / total).toFixed(4)) : 0;
}

function servingSamplesForCompare(
  res: LuceProcessResult | null
): RsrpSample[] {
  if (!res) return [];
  return (res.samples ?? []).filter((s) => s.kind === "serving");
}


export async function computeCompare(
  batchId: string,
  targetPcisOverride: number[] | undefined,
  gridMatchMode: GridMatchMode = "default"
): Promise<OptimizationCompare> {
  const [beforeRes, afterRes, settings] = await Promise.all([
    loadLuceResult(batchId, "before"),
    loadLuceResult(batchId, "after"),
    loadLuceSettings(batchId),
  ]);
  const targetPcis = targetPcisOverride ?? settings.comparisonTargetPcis;

  let before: CoverageStats | null;
  let after: CoverageStats | null;
  let gridMatchInfo: GridMatchInfo | undefined;
  let beforeRsrpPoints: WeightedMetricPoint[] = [];
  let afterRsrpPoints: WeightedMetricPoint[] = [];
  let beforeSinrPoints: WeightedMetricPoint[] = [];
  let afterSinrPoints: WeightedMetricPoint[] = [];
  let histogramByGrid = false;

  const useLinearDomainAverage = settings.useLinearDomainAverage ?? false;

  const useGridMatch =
    gridMatchMode !== "default" &&
    beforeRes?.grid?.length &&
    afterRes?.grid?.length;

  if (useGridMatch) {
    const sizeM = settings.gridSizeMeters;
    const gridOpts = gridIndexOptionsFromSettings(settings);
    const beforeKeys = buildGridKeySet(beforeRes!.grid!, sizeM, gridOpts);
    const afterKeys = buildGridKeySet(afterRes!.grid!, sizeM, gridOpts);

    let allowedKeys: Set<string>;
    if (gridMatchMode === "before") {
      allowedKeys = beforeKeys;
    } else if (gridMatchMode === "after") {
      allowedKeys = afterKeys;
    } else {
      allowedKeys = new Set<string>();
      for (const k of beforeKeys) {
        if (afterKeys.has(k)) allowedKeys.add(k);
      }
    }

    gridMatchInfo = {
      beforeGridCount: beforeKeys.size,
      afterGridCount: afterKeys.size,
      matchedGridCount: allowedKeys.size,
    };

    const filteredBefore = filterGridByKeys(
      beforeRes!.grid!,
      allowedKeys,
      sizeM,
      gridOpts
    );
    const filteredAfter = filterGridByKeys(
      afterRes!.grid!,
      allowedKeys,
      sizeM,
      gridOpts
    );

    before = statsFromGridCells(filteredBefore, useLinearDomainAverage);
    after = statsFromGridCells(filteredAfter, useLinearDomainAverage);
    beforeRsrpPoints = cellsToMetricPoints(filteredBefore, "rsrp");
    afterRsrpPoints = cellsToMetricPoints(filteredAfter, "rsrp");
    beforeSinrPoints = cellsToMetricPoints(filteredBefore, "sinr");
    afterSinrPoints = cellsToMetricPoints(filteredAfter, "sinr");
    histogramByGrid = true;
  } else {
    before = overallStats(beforeRes, useLinearDomainAverage);
    after = overallStats(afterRes, useLinearDomainAverage);
    if (beforeRes?.grid?.length && afterRes?.grid?.length) {
      beforeRsrpPoints = cellsToMetricPoints(beforeRes.grid, "rsrp");
      afterRsrpPoints = cellsToMetricPoints(afterRes.grid, "rsrp");
      beforeSinrPoints = cellsToMetricPoints(beforeRes.grid, "sinr");
      afterSinrPoints = cellsToMetricPoints(afterRes.grid, "sinr");
      histogramByGrid = true;
    } else {
      const beforeSamples = servingSamplesForCompare(beforeRes);
      const afterSamples = servingSamplesForCompare(afterRes);
      beforeRsrpPoints = samplesToMetricPoints(beforeSamples, "rsrp");
      afterRsrpPoints = samplesToMetricPoints(afterSamples, "rsrp");
      beforeSinrPoints = samplesToMetricPoints(beforeSamples, "sinr");
      afterSinrPoints = samplesToMetricPoints(afterSamples, "sinr");
    }
  }

  const pciStats: PciCoverage[] = targetPcis.map((pci) => {
    const b = statsForPci(beforeRes, pci, useLinearDomainAverage);
    const a = statsForPci(afterRes, pci, useLinearDomainAverage);
    return {
      pci,
      before: b,
      after: a,
      deltaAvg: diff(a?.avgRsrp, b?.avgRsrp),
      deltaCover95: diff(a?.cover95, b?.cover95),
    };
  });

  const targetGroupServingBefore = computeTargetGroupServingStats(
    beforeRes,
    targetPcis
  );
  const targetGroupServingAfter = computeTargetGroupServingStats(
    afterRes,
    targetPcis
  );

  let gridDelta: GridDeltaStats | undefined;
  if (beforeRes?.grid?.length && afterRes?.grid?.length) {
    const sizeM = settings.gridSizeMeters;
    const gridOpts = gridIndexOptionsFromSettings(settings);
    gridDelta = computeGridDelta(
      beforeRes.grid,
      afterRes.grid,
      sizeM,
      gridOpts
    );
  }

  const qualityRsrpThresholdDb = settings.qualityRsrpThresholdDb;
  const qualitySinrThresholdDb = settings.qualitySinrThresholdDb;
  const beforeQualityRsrp = qualityRatioFromMetricPoints(
    beforeRsrpPoints,
    qualityRsrpThresholdDb
  );
  const afterQualityRsrp = qualityRatioFromMetricPoints(
    afterRsrpPoints,
    qualityRsrpThresholdDb
  );
  const beforeQualitySinr = qualityRatioFromMetricPoints(
    beforeSinrPoints,
    qualitySinrThresholdDb
  );
  const afterQualitySinr = qualityRatioFromMetricPoints(
    afterSinrPoints,
    qualitySinrThresholdDb
  );

  return {
    before,
    after,
    deltaAvg: diff(after?.avgRsrp, before?.avgRsrp),
    deltaCover75: diff(after?.cover75, before?.cover75),
    deltaCover85: diff(after?.cover85, before?.cover85),
    deltaCover90: diff(after?.cover90, before?.cover90),
    deltaCover95: diff(after?.cover95, before?.cover95),
    deltaCover100: diff(after?.cover100, before?.cover100),
    deltaCover105: diff(after?.cover105, before?.cover105),
    deltaCover110: diff(after?.cover110, before?.cover110),
    deltaWeak: diff(after?.weak, before?.weak),
    deltaSinr: diff(after?.avgSinr, before?.avgSinr),
    deltaSinrCover10: diff(after?.sinrCover10, before?.sinrCover10),
    deltaSinrCover5: diff(after?.sinrCover5, before?.sinrCover5),
    deltaSinrCover0: diff(after?.sinrCover0, before?.sinrCover0),
    deltaSinrCoverNeg5: diff(after?.sinrCoverNeg5, before?.sinrCoverNeg5),
    deltaSinrWeak: diff(after?.sinrWeak, before?.sinrWeak),
    deltaRangeExcellent: diff(after?.rangeExcellent, before?.rangeExcellent),
    deltaRangeGood: diff(after?.rangeGood, before?.rangeGood),
    deltaRangeMedium: diff(after?.rangeMedium, before?.rangeMedium),
    deltaRangeWeak: diff(after?.rangeWeak, before?.rangeWeak),
    deltaSinrRangeExcellent: diff(
      after?.sinrRangeExcellent,
      before?.sinrRangeExcellent
    ),
    deltaSinrRangeGood: diff(after?.sinrRangeGood, before?.sinrRangeGood),
    deltaSinrRangeMedium: diff(
      after?.sinrRangeMedium,
      before?.sinrRangeMedium
    ),
    deltaSinrRangeWeak: diff(after?.sinrRangeWeak, before?.sinrRangeWeak),
    deltaTargetGroupServingRatio: diff(
      targetGroupServingAfter?.ratio,
      targetGroupServingBefore?.ratio
    ),
    pciStats,
    targetGroupName: settings.comparisonGroupName,
    targetPcis,
    regionFiltered: settings.useRegionFilter,
    grasslandFiltered: settings.useGrasslandFilter,
    targetGroupServingBefore,
    targetGroupServingAfter,
    gridDelta,
    rsrpHistogram: buildMetricHistogram(
      beforeRsrpPoints,
      afterRsrpPoints,
      "rsrp"
    ),
    sinrHistogram: buildMetricHistogram(
      beforeSinrPoints,
      afterSinrPoints,
      "sinr"
    ),
    histogramByGrid,
    gridMatchMode,
    gridMatchInfo,
    qualityRsrpThresholdDb,
    qualitySinrThresholdDb,
    beforeQualityRsrp,
    afterQualityRsrp,
    deltaQualityRsrp: diff(afterQualityRsrp, beforeQualityRsrp),
    beforeQualitySinr,
    afterQualitySinr,
    deltaQualitySinr: diff(afterQualitySinr, beforeQualitySinr),
    generatedAt: new Date().toISOString(),
  };
}
