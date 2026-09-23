import { RSRP_RANGE, SINR_RANGE } from "../constants";

export type RsrpDisplayMode = "points" | "heatmap" | "grid";

export type GridIndexMode = "global" | "dataset";

export type GridRefOrigin = "before" | "notebook-combined";

export type GridAggMode = "dominant_pci" | "all_points_mean";

/** 地图 RSRP/SINR 色标取值范围 */
export interface MetricColorRange {
  min: number;
  max: number;
}

export interface LuceSettings {
  servingPciFilter: number[];
  neighborPciFilter: number[];
  /** 查看对比时重点展示的小区组名称 */
  comparisonGroupName: string;
  /** 查看对比时重点展示的主服务 PCI；空数组表示仅展示整体指标 */
  comparisonTargetPcis: number[];
  /** 主区 PCI 排除（先应用上方白名单，再排除） */
  servingPciExclude: number[];
  /** 邻区 PCI 排除（先应用上方白名单，再排除） */
  neighborPciExclude: number[];
  includeServing: boolean;
  includeNeighbor: boolean;
  neighborSource: "listed" | "detected" | "both";
  displayMode: RsrpDisplayMode;
  gridSizeMeters: number;
  gridIndexMode: GridIndexMode;
  gridRefOrigin: GridRefOrigin;
  gridRefLon?: number;
  gridRefLat?: number;
  gridAggMode: GridAggMode;
  showDrivePath: boolean;
  useGrid: boolean;
  useRegionFilter: boolean;
  regionCenterLon: number;
  regionCenterLat: number;
  regionRadiusMeters: number;
  useGrasslandFilter: boolean;
  /** custom 或 config/region-bbox-presets.json 中的预设 id */
  grasslandBboxSource: "custom" | string;
  grasslandBbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  useLinearDomainAverage: boolean;
  /** 地图 RSRP 图例/着色下限 (dBm) */
  rsrpRangeMin: number;
  /** 地图 RSRP 图例/着色上限 (dBm) */
  rsrpRangeMax: number;
  /** 地图 SINR 图例/着色下限 (dB) */
  sinrRangeMin: number;
  /** 地图 SINR 图例/着色上限 (dB) */
  sinrRangeMax: number;
  /** PCI 着色自定义颜色，键为 PCI 字符串 */
  pciColorOverrides: Record<string, string>;
  /** 读取优化后数据时 RSRP 整体偏移 (dB)，0=不减 */
  afterRsrpOffsetDb: number;
  /** 读取优化后数据时 SINR 整体偏移 (dB)，0=不减 */
  afterSinrOffsetDb: number;
  /** 查看对比：RSRP 优质栅格阈值 (dBm)，栅格 RSRP ≥ 此值计为优质 */
  qualityRsrpThresholdDb: number;
  /** 查看对比：SINR 优质栅格阈值 (dB)，栅格 SINR ≥ 此值计为优质 */
  qualitySinrThresholdDb: number;
}

export interface RsrpSample {
  longitude: number;
  latitude: number;
  rsrp: number;
  pci: number;
  kind: "serving" | "neighbor";
  time?: string;
  sinr?: number;
}

export interface GridCell {
  longitude: number;
  latitude: number;
  west: number;
  south: number;
  east: number;
  north: number;
  rsrp: number;
  sinr: number;
  pci: number;
  count: number;
}

export interface PathPoint {
  longitude: number;
  latitude: number;
}

export interface DrivePath {
  fileName: string;
  points: PathPoint[];
  segments?: PathPoint[][];
}

export interface CoverageSummary {
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

export interface LuceCoverageStats {
  serving: CoverageSummary | null;
  byPci: Record<string, CoverageSummary>;
  allServingCount?: number;
}

export interface LuceProcessResult {
  path?: PathPoint[];
  paths: DrivePath[];
  samples: RsrpSample[];
  grid?: GridCell[];
  stats: {
    totalRows: number;
    skippedNoLocation: number;
    skippedEmptyRsrp: number;
    servingSamples: number;
    neighborSamples: number;
    outputSamples: number;
    pathSegments: number;
    pathPoints: number;
  };
  coverage?: LuceCoverageStats;
  processedAt: string;
  settings: LuceSettings;
  cacheKey?: string;
}

export interface LuceProcessSummary {
  stats: LuceProcessResult["stats"];
  processedAt: string;
  settings: LuceSettings;
  pathSegments: number;
  pathPoints: number;
  sampleCount: number;
  gridCount: number;
}

export interface LuceProcessEvent {
  type: "log" | "progress" | "done" | "error";
  message?: string;
  percent?: number;
  summary?: LuceProcessSummary;
}

export const DEFAULT_LUCE_SETTINGS: LuceSettings = {
  servingPciFilter: [],
  neighborPciFilter: [],
  comparisonGroupName: "关注小区组",
  comparisonTargetPcis: [],
  servingPciExclude: [],
  neighborPciExclude: [],
  includeServing: true,
  includeNeighbor: false,
  neighborSource: "listed",
  displayMode: "grid",
  gridSizeMeters: 5,
  gridIndexMode: "global",
  gridRefOrigin: "before",
  gridAggMode: "dominant_pci",
  showDrivePath: false,
  useGrid: true,
  /** 默认关闭；开启后请把中心设到当前工参/路测区域，避免误滤空 */
  useRegionFilter: false,
  regionCenterLon: 114.212309,
  regionCenterLat: 22.697092,
  regionRadiusMeters: 80,
  useGrasslandFilter: false,
  grasslandBboxSource: "custom",
  useLinearDomainAverage: false,
  rsrpRangeMin: RSRP_RANGE.min,
  rsrpRangeMax: RSRP_RANGE.max,
  sinrRangeMin: SINR_RANGE.min,
  sinrRangeMax: SINR_RANGE.max,
  pciColorOverrides: {},
  afterRsrpOffsetDb: 0,
  afterSinrOffsetDb: 0,
  qualityRsrpThresholdDb: -85,
  qualitySinrThresholdDb: 0,
  grasslandBbox: {
    lonMin: 114.211915,
    lonMax: 114.2128324,
    latMin: 22.6965001,
    latMax: 22.6977605,
  },
};
