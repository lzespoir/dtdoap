export type RsrpDisplayMode = "points" | "heatmap" | "grid";

export type GridIndexMode = "global" | "dataset";

/** dataset 模式下栅格原点经纬度中位数的样本范围 */
export type GridRefOrigin = "before" | "notebook-combined";

/** 栅格内 RSRP/SINR 聚合方式 */
export type GridAggMode = "dominant_pci" | "all_points_mean";

export interface LuceSettings {
  /** 主区 PCI 白名单，空=不过滤 */
  servingPciFilter: number[];
  /** 邻区 PCI 白名单，空=不过滤 */
  neighborPciFilter: number[];
  /** 查看对比时重点展示的小区组名称 */
  comparisonGroupName: string;
  /** 查看对比时重点展示的主服务 PCI；空数组表示仅展示整体指标 */
  comparisonTargetPcis: number[];
  /** 主区 PCI 黑名单（在白名单之后应用），空=不排除 */
  servingPciExclude: number[];
  /** 邻区 PCI 黑名单（在白名单之后应用），空=不排除 */
  neighborPciExclude: number[];
  /** 提取主区 RSRP */
  includeServing: boolean;
  /** 提取邻区 RSRP（分号对应） */
  includeNeighbor: boolean;
  /** 邻区数据来源 */
  neighborSource: "listed" | "detected" | "both";
  /** 显示模式 */
  displayMode: RsrpDisplayMode;
  /** 栅格边长 (m)，grid/heatmap 使用 */
  gridSizeMeters: number;
  /**
   * 栅格索引方式：global=全球 floor（cos(regionCenterLat) 经度换算，与数据集无关）；
   * dataset=以数据集经纬度中位数为原点（与 Notebook 一致）
   */
  gridIndexMode: GridIndexMode;
  /**
   * dataset 原点来源：before=仅优化前采样中位数（处理优化前时的默认）；
   * notebook-combined=优化前+优化后合并采样中位数（与 ipynb 一致，仅处理优化后时写入，需已有优化后数据）
   */
  gridRefOrigin: GridRefOrigin;
  /** dataset 模式原点经度；处理时按 gridRefOrigin 写入 */
  gridRefLon?: number;
  /** dataset 模式原点纬度 */
  gridRefLat?: number;
  /**
   * 栅格聚合：dominant_pci=格内主服 PCI（众数）样本均值（默认）；
   * all_points_mean=格内全部采样点算术平均（与 Notebook 一致）
   */
  gridAggMode: GridAggMode;
  /** 是否显示路测轨迹线 */
  showDrivePath: boolean;
  /** 是否启用栅格聚合（displayMode=points 时也可单独开） */
  useGrid: boolean;
  /** 仅保留中场区域内的采样点（避免看台/边线两圈数据） */
  useRegionFilter: boolean;
  regionCenterLon: number;
  regionCenterLat: number;
  regionRadiusMeters: number;
  /** 仅保留草坪区域内的采样点 */
  useGrasslandFilter: boolean;
  /** 区域范围：custom=下方 grasslandBbox；否则为 config/region-bbox-presets.json 中的 id */
  grasslandBboxSource: "custom" | string;
  /** 草坪区域经纬度边界框（自定义时使用） */
  grasslandBbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  /** 平均值是否先转线性域计算（dBm/dB -> 线性 -> 均值 -> dBm/dB） */
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
  /** 查看对比：RSRP 优质栅格阈值 (dBm) */
  qualityRsrpThresholdDb: number;
  /** 查看对比：SINR 优质栅格阈值 (dB) */
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

/** 单个路测文件对应一条轨迹（不同文件/设备不混合） */
export interface DrivePath {
  fileName: string;
  /** 扁平点列（兼容）；优先用 segments */
  points: PathPoint[];
  /** 按时间序分段，大跳变处断开，避免跨场直线 */
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
  /** ≥ -80 dBm 优质覆盖占比 */
  rangeExcellent: number;
  /** -80 ~ -90 dBm 良好覆盖占比 */
  rangeGood: number;
  /** -90 ~ -100 dBm 中等覆盖占比 */
  rangeMedium: number;
  /** -100 ~ -110 dBm 弱覆盖占比 */
  rangeWeak: number;
  // SINR 区间分布（阈值同上）
  sinrRangeExcellent: number; // >= 10
  sinrRangeGood: number; // [5, 10)
  sinrRangeMedium: number; // [0, 5)
  sinrRangeWeak: number; // [-5, 0)
}

export interface LuceCoverageStats {
  /** 仅主区采样的整体覆盖统计（全量数据，不受 samples 截断影响） */
  serving: CoverageSummary | null;
  /** 按 PCI 拆分的覆盖统计（仅主区） */
  byPci: Record<string, CoverageSummary>;
  /** 中场区域内所有主区采样数（未经 PCI 过滤），用于计算主服务占比 */
  allServingCount?: number;
}

export interface LuceProcessResult {
  /** @deprecated 旧版合并轨迹，请使用 paths */
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
  /** 由全量样本直接算出的覆盖统计（用于优化前后对比） */
  coverage?: LuceCoverageStats;
  processedAt: string;
  settings: LuceSettings;
  /** 源数据缓存指纹，用于判断轨迹是否需重算 */
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
  rsrpRangeMin: -120,
  rsrpRangeMax: -60,
  sinrRangeMin: -10,
  sinrRangeMax: 10,
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
