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
  sinrRangeExcellent: number;
  sinrRangeGood: number;
  sinrRangeMedium: number;
  sinrRangeWeak: number;
}

export interface PciCoverage {
  pci: number;
  before: CoverageStats | null;
  after: CoverageStats | null;
  deltaAvg: number | null;
  deltaCover95: number | null;
}

export interface TargetGroupServingStats {
  targetCount: number;
  totalCount: number;
  ratio: number;
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
  from: number;
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
  targetGroupName: string;
  targetPcis: number[];
  regionFiltered: boolean;
  grasslandFiltered: boolean;
  targetGroupServingBefore?: TargetGroupServingStats;
  targetGroupServingAfter?: TargetGroupServingStats;
  gridDelta?: GridDeltaStats;
  rsrpHistogram?: MetricHistogram;
  sinrHistogram?: MetricHistogram;
  histogramByGrid?: boolean;
  gridMatchMode: GridMatchMode;
  gridMatchInfo?: GridMatchInfo;
  /** 优质栅格 RSRP 阈值 (dBm)，来自批次设置 */
  qualityRsrpThresholdDb: number;
  /** 优质栅格 SINR 阈值 (dB)，来自批次设置 */
  qualitySinrThresholdDb: number;
  beforeQualityRsrp: number;
  afterQualityRsrp: number;
  deltaQualityRsrp: number | null;
  beforeQualitySinr: number;
  afterQualitySinr: number;
  deltaQualitySinr: number | null;
  generatedAt: string;
}
