export interface PathAdjustPatch {
  kind: "path" | "sample";
  pointIndex: number;
  baseLon: number;
  baseLat: number;
  dEast: number;
  dNorth: number;
  radiusMeters: number;
  /** 轨迹段键 pathIndex:segmentIndex */
  segmentKey?: string;
}

export interface SegmentTimeline {
  sampleCount: number;
  previewSampleCount?: number;
  logicalPointCount?: number;
  pathPointCount?: number;
  pathSegmentKeys: string[];
}

export interface FilePathCorrection {
  fileName: string;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  patches: PathAdjustPatch[];
  segmentTimeline?: SegmentTimeline;
}

export interface RowOffsetDebug {
  rowIndex: number;
  lon: number;
  lat: number;
  sampleIdx: number;
  rowSeg: string | null;
  layerEast: number;
  layerNorth: number;
  patchEast: number;
  patchNorth: number;
  totalEast: number;
  totalNorth: number;
  shiftMeters: number;
  outLon: number;
  outLat: number;
  sampleDirectEast: number;
  sampleDirectNorth: number;
  pathMappedEast: number;
  pathMappedNorth: number;
  pathMappedIndex: number;
  matchedPathPatchCount: number;
  matchedPathPatches: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey?: string;
  }[];
}

export interface ExportDebugReport {
  fileName: string;
  /** 主区逻辑采样点数 */
  dataRowCount: number;
  validCoordRows?: number;
  sampleCount: number;
  pathSegmentKeyCount: number;
  patchCount: number;
  pathPatchCount: number;
  samplePatchCount: number;
  layerOffsetEast: number;
  layerOffsetNorth: number;
  sampledRows: RowOffsetDebug[];
  maxShiftRow: RowOffsetDebug | null;
  rowsWithShiftOver10m: number;
  rowsWithShiftOver50m: number;
  rowsWithShiftOver100m: number;
}
