export type GridMatchMode = "default" | "before" | "after" | "intersection";

export interface GridMatchInfo {
  beforeGridCount: number;
  afterGridCount: number;
  matchedGridCount: number;
}

export interface OptimizationSuggestion {
  pci: number;
  cellName: string;
  stationName: string;
  azimuthOriginal: number | null;
  downtiltOriginal: number | null;
  azimuthSuggest: number;
  downtiltSuggest: number;
  deltaAzimuth: number | null;
  deltaDowntilt: number | null;
  note: string;
}

export interface OptimizationSuggestionResult {
  method: string;
  targetPcis: number[];
  suggestions: OptimizationSuggestion[];
  notes: string[];
  generatedAt: string;
}

export interface CoverageStats {
  count: number;
  avgRsrp: number;
  minRsrp: number;
  maxRsrp: number;
  p10: number;
  p50: number;
  p90: number;
  cover75: number;
  cover85: number;
  cover90: number;
  cover95: number;
  cover100: number;
  cover105: number;
  cover110: number;
  weak: number;
  avgSinr: number;
  p50Sinr: number;
  // SINR 覆盖率（阈值：>=10, >=5, >=0, >=-5；以及 < -5 极弱）
  sinrCover10: number;
  sinrCover5: number;
  sinrCover0: number;
  sinrCoverNeg5: number;
  sinrWeak: number; // < -5
  rangeExcellent: number;
  rangeGood: number;
  rangeMedium: number;
  rangeWeak: number;
  // SINR 区间分布（阈值同上）
  sinrRangeExcellent: number; // >= 10
  sinrRangeGood: number; // [5, 10)
  sinrRangeMedium: number; // [0, 5)
  sinrRangeWeak: number; // [-5, 0)
}

export interface PciCoverage {
  pci: number;
  before: CoverageStats | null;
  after: CoverageStats | null;
  /** 平均 RSRP 改善量 (dB)，after-before；null 表示一侧缺数据 */
  deltaAvg: number | null;
  /** -95 覆盖率改善 (百分点) */
  deltaCover95: number | null;
}

export interface TargetGroupServingStats {
  /** 配置的目标 PCI 作为主服务小区的采样数 */
  targetCount: number;
  /** 全部主区采样数 */
  totalCount: number;
  /** 关注小区组作为主服务的占比 */
  ratio: number;
  /** 按 PCI 拆分 */
  byPci: { pci: number; count: number; ratio: number }[];
}

export interface GridDeltaStats {
  commonGrids: number;
  improvedGrids: number;
  degradedGrids: number;
  unchangedGrids: number;
  improvedRatio: number;
  degradedRatio: number;
}

export interface HistogramBin {
  /** bin 左边界（包含） */
  from: number;
  /** bin 右边界（不包含，最后一个 bin 可视为包含） */
  to: number;
  beforeCount: number;
  afterCount: number;
}

export interface MetricHistogram {
  metric: "rsrp" | "sinr";
  unit: "dBm" | "dB";
  binSize: number;
  bins: HistogramBin[];
}

export interface OptimizationCompare {
  before: CoverageStats | null;
  after: CoverageStats | null;
  deltaAvg: number | null;
  deltaCover75: number | null;
  deltaCover85: number | null;
  deltaCover90: number | null;
  deltaCover95: number | null;
  deltaCover100: number | null;
  deltaCover105: number | null;
  deltaCover110: number | null;
  deltaWeak: number | null;
  deltaSinr: number | null;
  deltaSinrCover10: number | null;
  deltaSinrCover5: number | null;
  deltaSinrCover0: number | null;
  deltaSinrCoverNeg5: number | null;
  deltaSinrWeak: number | null;
  deltaRangeExcellent: number | null;
  deltaRangeGood: number | null;
  deltaRangeMedium: number | null;
  deltaRangeWeak: number | null;
  deltaSinrRangeExcellent: number | null;
  deltaSinrRangeGood: number | null;
  deltaSinrRangeMedium: number | null;
  deltaSinrRangeWeak: number | null;
  /** 关注小区组主服务占比变化（百分点） */
  deltaTargetGroupServingRatio: number | null;
  pciStats: PciCoverage[];
  /** 关注小区组名称 */
  targetGroupName: string;
  /** 关注小区组的 PCI；不改变整体 KPI 的统计范围 */
  targetPcis: number[];
  /** 是否启用了中场区域过滤 */
  regionFiltered: boolean;
  /** 是否启用了草坪区域过滤 */
  grasslandFiltered: boolean;
  targetGroupServingBefore?: TargetGroupServingStats;
  targetGroupServingAfter?: TargetGroupServingStats;
  gridDelta?: GridDeltaStats;
  rsrpHistogram?: MetricHistogram;
  sinrHistogram?: MetricHistogram;
  /** 强度分布直方图是否按栅格代表值统计（每栅格计 1） */
  histogramByGrid?: boolean;
  gridMatchMode: GridMatchMode;
  gridMatchInfo?: GridMatchInfo;
  qualityRsrpThresholdDb: number;
  qualitySinrThresholdDb: number;
  beforeQualityRsrp: number;
  afterQualityRsrp: number;
  deltaQualityRsrp: number | null;
  beforeQualitySinr: number;
  afterQualitySinr: number;
  deltaQualitySinr: number | null;
  generatedAt: string;
}
