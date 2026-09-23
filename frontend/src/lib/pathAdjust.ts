import type { QuickPreviewItem } from "./quickPathApi";
import { pathOffsetFromPatchesByPosition } from "./pathOffsetSpatial";
import type { DrivePath } from "../types/luce";

export const PATH_LAYER_COLORS = [
  "#00bcd4",
  "#ff9800",
  "#8bc34a",
  "#e91e63",
  "#9c27b0",
  "#ffc107",
  "#03a9f4",
  "#795548",
] as const;

export type PathAdjustDisplay = "path" | "samples" | "both";

export interface PathAdjustLayer {
  id: string;
  fileName: string;
  visible: boolean;
  locked: boolean;
  active: boolean;
  color: string;
  item: QuickPreviewItem;
  /** 整层平移 (m)，东为正 */
  offsetEastMeters: number;
  /** 整层平移 (m)，北为正 */
  offsetNorthMeters: number;
  /** 单点额外偏移 (m)，键为 pointKey */
  pointOffsets: Record<string, { east: number; north: number }>;
  /** 形状附着服务端返回的导出补丁（逻辑点下标） */
  shapeSnapPatches?: PathAdjustPatch[];
}

export interface AdjustPoint {
  key: string;
  layerId: string;
  kind: "path" | "sample";
  index: number;
  baseLon: number;
  baseLat: number;
}

export function pointKey(
  layerId: string,
  kind: "path" | "sample",
  index: number
): string {
  return `${layerId}:${kind}:${index}`;
}

export function patchRadiusForKind(kind: "path" | "sample"): number {
  return kind === "sample" ? 4 : 6;
}

function samePathPoint(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number }
): boolean {
  return a.longitude === b.longitude && a.latitude === b.latitude;
}

function flattenedSegmentKeysForPath(
  path: DrivePath,
  pathIndex: number
): string[] {
  const keys: string[] = [];
  if (path.segments?.length) {
    let flatPrev: { longitude: number; latitude: number } | null = null;
    for (let segmentIndex = 0; segmentIndex < path.segments.length; segmentIndex++) {
      const seg = path.segments[segmentIndex]!;
      for (let i = 0; i < seg.length; i++) {
        const p = seg[i]!;
        if (flatPrev && i === 0 && samePathPoint(flatPrev, p)) continue;
        keys.push(`${pathIndex}:${segmentIndex}`);
        flatPrev = p;
      }
      if (seg.length > 0) flatPrev = seg[seg.length - 1]!;
    }
    return keys;
  }
  for (let i = 0; i < path.points.length; i++) {
    keys.push(`${pathIndex}:0`);
  }
  return keys;
}

function pathPointCount(layer: PathAdjustLayer): number {
  let n = 0;
  for (const path of layer.item.result.paths) {
    n += path.points.length;
  }
  return n;
}

function alignSegmentKeys(keys: string[], count: number): string[] {
  if (count === 0) return [];
  if (keys.length === count) return keys;
  if (keys.length === 0) return Array.from({ length: count }, () => "0:0");
  if (keys.length > count) return keys.slice(0, count);
  const last = keys[keys.length - 1]!;
  return [...keys, ...Array.from({ length: count - keys.length }, () => last)];
}

/** 与 path.points 扁平索引一一对应的轨迹段键 */
export function buildPathSegmentKeys(layer: PathAdjustLayer): string[] {
  const keys: string[] = [];
  layer.item.result.paths.forEach((path, pathIndex) => {
    keys.push(...flattenedSegmentKeysForPath(path, pathIndex));
  });
  return alignSegmentKeys(keys, pathPointCount(layer));
}

/** 各轨迹段在扁平 path 索引上的起止（时间早→晚） */
export function listSegmentPathRanges(
  layer: PathAdjustLayer
): {
  pathIndex: number;
  segmentIndex: number;
  startIdx: number;
  endIdx: number;
}[] {
  const segKeys = buildPathSegmentKeys(layer);
  const ranges = new Map<
    string,
    {
      pathIndex: number;
      segmentIndex: number;
      startIdx: number;
      endIdx: number;
    }
  >();
  for (let i = 0; i < segKeys.length; i++) {
    const segKey = segKeys[i]!;
    const existing = ranges.get(segKey);
    if (!existing) {
      const [pathIndex, segmentIndex] = segKey.split(":").map(Number);
      ranges.set(segKey, {
        pathIndex: pathIndex!,
        segmentIndex: segmentIndex!,
        startIdx: i,
        endIdx: i,
      });
    } else {
      existing.endIdx = i;
    }
  }
  return [...ranges.values()];
}

export function segmentKeyForSampleIndex(
  layer: PathAdjustLayer,
  sampleIndex: number
): string {
  const pathSegKeys = buildPathSegmentKeys(layer);
  const sampleCount = layer.item.result.samples.length;
  if (pathSegKeys.length === 0) return "0:0";
  if (sampleCount <= 1) return pathSegKeys[0]!;
  const t = sampleIndex / (sampleCount - 1);
  const pathIdx = Math.min(
    pathSegKeys.length - 1,
    Math.round(t * (pathSegKeys.length - 1))
  );
  return pathSegKeys[pathIdx]!;
}

export function segmentKeyForAdjustKey(
  layer: PathAdjustLayer,
  key: string
): string | null {
  const parts = key.split(":");
  if (parts.length !== 3 || parts[0] !== layer.id) return null;
  const kind = parts[1];
  const index = Number(parts[2]);
  if (!Number.isFinite(index)) return null;
  if (kind === "path") {
    return buildPathSegmentKeys(layer)[index] ?? "0:0";
  }
  if (kind === "sample") {
    return segmentKeyForSampleIndex(layer, index);
  }
  return null;
}

export function buildSegmentTimeline(layer: PathAdjustLayer): SegmentTimeline {
  const stats = layer.item.result.stats;
  const logicalPointCount =
    stats?.servingSamples ??
    stats?.outputSamples ??
    layer.item.result.samples.length;
  return {
    sampleCount: logicalPointCount,
    previewSampleCount: layer.item.result.samples.length,
    logicalPointCount,
    pathPointCount: pathPointCount(layer),
    pathSegmentKeys: buildPathSegmentKeys(layer),
  };
}

/** 按时间比例在两种序列间映射下标（早→晚） */
export function proportionForIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(1, index / (count - 1)));
}

export function exactIndexForProportion(
  proportion: number,
  targetCount: number
): number {
  if (targetCount <= 1) return 0;
  const t = Math.max(0, Math.min(1, proportion));
  return t * (targetCount - 1);
}

export function indexForProportion(
  index: number,
  indexCount: number,
  targetCount: number
): number {
  return Math.round(
    exactIndexForProportion(proportionForIndex(index, indexCount), targetCount)
  );
}

function lerpOffset(
  a: { east: number; north: number },
  b: { east: number; north: number },
  frac: number
): { east: number; north: number } {
  return {
    east: a.east + (b.east - a.east) * frac,
    north: a.north + (b.north - a.north) * frac,
  };
}

export function pathOffsetInterpolated(
  layer: PathAdjustLayer,
  exactPathIdx: number
): { east: number; north: number } {
  const pathCount = pathPointCount(layer);
  if (pathCount <= 1) return pathOffsetAtIndex(layer, 0);
  const idx = Math.max(0, Math.min(pathCount - 1, exactPathIdx));
  const i0 = Math.floor(idx);
  const i1 = Math.min(pathCount - 1, i0 + 1);
  const frac = idx - i0;
  return lerpOffset(
    pathOffsetAtIndex(layer, i0),
    pathOffsetAtIndex(layer, i1),
    frac
  );
}

export function pathOffsetFromPatchesInterpolated(
  patches: PathAdjustPatch[],
  exactPathIdx: number,
  pathPointCount: number
): {
  east: number;
  north: number;
  exactPathIdx: number;
  matchedPathPatches: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey: string;
    weight: number;
  }[];
} {
  if (pathPointCount <= 1) {
    const p = patches.find((x) => x.kind === "path" && x.pointIndex === 0);
    return {
      east: p?.dEast ?? 0,
      north: p?.dNorth ?? 0,
      exactPathIdx: 0,
      matchedPathPatches: [],
    };
  }
  const idx = Math.max(0, Math.min(pathPointCount - 1, exactPathIdx));
  const i0 = Math.floor(idx);
  const i1 = Math.min(pathPointCount - 1, i0 + 1);
  const frac = idx - i0;

  const offsetAt = (pointIndex: number) => {
    const p = patches.find(
      (x) => x.kind === "path" && x.pointIndex === pointIndex
    );
    return {
      east: p?.dEast ?? 0,
      north: p?.dNorth ?? 0,
      patch: p,
    };
  };

  const o0 = offsetAt(i0);
  const o1 = offsetAt(i1);
  const blended = lerpOffset(o0, o1, frac);
  const matchedPathPatches: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey: string;
    weight: number;
  }[] = [];
  if (o0.patch && frac < 1) {
    matchedPathPatches.push({
      pointIndex: i0,
      dEast: o0.patch.dEast,
      dNorth: o0.patch.dNorth,
      segmentKey: o0.patch.segmentKey,
      weight: 1 - frac,
    });
  }
  if (o1.patch && frac > 0) {
    matchedPathPatches.push({
      pointIndex: i1,
      dEast: o1.patch.dEast,
      dNorth: o1.patch.dNorth,
      segmentKey: o1.patch.segmentKey,
      weight: frac,
    });
  }

  return {
    east: blended.east,
    north: blended.north,
    exactPathIdx: idx,
    matchedPathPatches,
  };
}

export function pathIndexForSampleIndex(
  layer: PathAdjustLayer,
  sampleIndex: number
): number {
  return indexForProportion(
    sampleIndex,
    layer.item.result.samples.length,
    pathPointCount(layer)
  );
}

export function pathIndexForCsvRow(
  pathPointCount: number,
  rowIndex: number,
  dataRowCount: number
): number {
  return indexForProportion(rowIndex, dataRowCount, pathPointCount);
}

function pathOffsetAtIndex(
  layer: PathAdjustLayer,
  pathIndex: number
): { east: number; north: number } {
  const key = pointKey(layer.id, "path", pathIndex);
  return layer.pointOffsets[key] ?? { east: 0, north: 0 };
}

/** CSV 有效行序号 → 预览采样下标（与 effectiveLonLat 一致） */
export function sampleIndexForCsvRow(
  sampleCount: number,
  rowIndex: number,
  dataRowCount: number
): number {
  return Math.round(
    exactIndexForProportion(proportionForIndex(rowIndex, dataRowCount), sampleCount)
  );
}

export function segmentKeyForCsvRow(
  timeline: SegmentTimeline,
  rowIndex: number,
  dataRowCount: number
): string {
  const { pathSegmentKeys } = timeline;
  if (pathSegmentKeys.length === 0) return "0:0";
  if (dataRowCount <= 1) return pathSegmentKeys[0]!;
  const pathIdx = Math.round(
    exactIndexForProportion(
      proportionForIndex(rowIndex, dataRowCount),
      pathSegmentKeys.length
    )
  );
  return pathSegmentKeys[pathIdx]!;
}

export function basePositionForPointKey(
  layer: PathAdjustLayer,
  key: string
): { longitude: number; latitude: number; kind: "path" | "sample" } | null {
  const parts = key.split(":");
  if (parts.length !== 3 || parts[0] !== layer.id) return null;
  const kind = parts[1];
  const index = Number(parts[2]);
  if (kind !== "path" && kind !== "sample") return null;
  if (kind === "path") {
    let idx = 0;
    for (const path of layer.item.result.paths) {
      for (const p of path.points) {
        if (idx === index) {
          return {
            longitude: p.longitude,
            latitude: p.latitude,
            kind: "path",
          };
        }
        idx++;
      }
    }
    return null;
  }
  const sample = layer.item.result.samples[index];
  if (!sample) return null;
  return {
    longitude: sample.longitude,
    latitude: sample.latitude,
    kind: "sample",
  };
}

function pathPatchesFromLayer(layer: PathAdjustLayer): PathAdjustPatch[] {
  const patches: PathAdjustPatch[] = [];
  for (const [key, off] of Object.entries(layer.pointOffsets)) {
    if (Math.abs(off.east) < 1e-6 && Math.abs(off.north) < 1e-6) continue;
    const base = basePositionForPointKey(layer, key);
    if (!base || base.kind !== "path") continue;
    patches.push({
      kind: "path",
      pointIndex: Number(key.split(":")[2]),
      baseLon: base.longitude,
      baseLat: base.latitude,
      dEast: off.east,
      dNorth: off.north,
      radiusMeters: patchRadiusForKind("path"),
      segmentKey: segmentKeyForAdjustKey(layer, key) ?? "0:0",
    });
  }
  return patches;
}

/** 采样点跟随轨迹：按原始经纬度在已编辑 path 折线上取偏移 */
function pathOffsetForSampleKey(
  layer: PathAdjustLayer,
  sampleKey: string
): { east: number; north: number } {
  const base = basePositionForPointKey(layer, sampleKey);
  if (!base) return { east: 0, north: 0 };
  const off = pathOffsetFromPatchesByPosition(
    pathPatchesFromLayer(layer),
    base.longitude,
    base.latitude
  );
  return { east: off.east, north: off.north };
}

/** 同段内对所有补丁按半径叠加（未区分 path/sample，导出勿用） */
export function patchDeltaAt(
  layer: PathAdjustLayer,
  lon: number,
  lat: number,
  queryKey?: string
): { east: number; north: number } {
  const querySeg = queryKey ? segmentKeyForAdjustKey(layer, queryKey) : null;
  let east = 0;
  let north = 0;
  for (const [key, off] of Object.entries(layer.pointOffsets)) {
    if (!key.startsWith(`${layer.id}:`)) continue;
    const base = basePositionForPointKey(layer, key);
    if (!base) continue;
    const patchSeg = segmentKeyForAdjustKey(layer, key);
    if (querySeg && patchSeg && querySeg !== patchSeg) continue;
    const radius = patchRadiusForKind(base.kind);
    if (distanceMeters(lon, lat, base.longitude, base.latitude) <= radius) {
      east += off.east;
      north += off.north;
    }
  }
  return { east, north };
}

export function offsetPosition(
  longitude: number,
  latitude: number,
  eastMeters: number,
  northMeters: number
): { longitude: number; latitude: number } {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  return {
    longitude: longitude + eastMeters / (mPerDegLat * cosLat),
    latitude: latitude + northMeters / mPerDegLat,
  };
}

export function effectiveLonLat(
  layer: PathAdjustLayer,
  baseLon: number,
  baseLat: number,
  key?: string
): { longitude: number; latitude: number } {
  let extraEast = 0;
  let extraNorth = 0;
  if (key) {
    const direct = layer.pointOffsets[key] ?? { east: 0, north: 0 };
    extraEast = direct.east;
    extraNorth = direct.north;
    const kind = key.split(":")[1];
    if (kind === "sample") {
      const mapped = pathOffsetForSampleKey(layer, key);
      extraEast += mapped.east;
      extraNorth += mapped.north;
    }
  } else {
    const patch = patchDeltaAt(layer, baseLon, baseLat, key);
    extraEast = patch.east;
    extraNorth = patch.north;
  }
  return offsetPosition(
    baseLon,
    baseLat,
    layer.offsetEastMeters + extraEast,
    layer.offsetNorthMeters + extraNorth
  );
}

export function collectAdjustPoints(
  layer: PathAdjustLayer,
  display: PathAdjustDisplay,
  maxSamples = 8000
): AdjustPoint[] {
  const out: AdjustPoint[] = [];
  if (display === "path" || display === "both") {
    let idx = 0;
    for (const path of layer.item.result.paths) {
      for (const p of path.points) {
        out.push({
          key: pointKey(layer.id, "path", idx),
          layerId: layer.id,
          kind: "path",
          index: idx,
          baseLon: p.longitude,
          baseLat: p.latitude,
        });
        idx++;
      }
    }
  }
  if (display === "samples" || display === "both") {
    const samples = layer.item.result.samples;
    const step = Math.max(1, Math.ceil(samples.length / maxSamples));
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      out.push({
        key: pointKey(layer.id, "sample", i),
        layerId: layer.id,
        kind: "sample",
        index: i,
        baseLon: s.longitude,
        baseLat: s.latitude,
      });
    }
  }
  return out;
}

export function layerFromPreview(
  item: QuickPreviewItem,
  colorIndex: number
): PathAdjustLayer {
  return {
    id: item.id,
    fileName: item.fileName,
    visible: true,
    locked: false,
    active: true,
    color: PATH_LAYER_COLORS[colorIndex % PATH_LAYER_COLORS.length],
    item,
    offsetEastMeters: 0,
    offsetNorthMeters: 0,
    pointOffsets: {},
  };
}

export interface PathFollowAnchor {
  layerId: string;
  fileName: string;
  pathIndex: number;
}

export function mapSampleIndexToPathIndex(
  layer: PathAdjustLayer,
  sampleIndex: number
): number {
  const pathSegKeys = buildPathSegmentKeys(layer);
  const sampleCount = layer.item.result.samples.length;
  if (pathSegKeys.length === 0) return 0;
  if (sampleCount <= 1) return 0;
  const t = sampleIndex / (sampleCount - 1);
  return Math.min(
    pathSegKeys.length - 1,
    Math.round(t * (pathSegKeys.length - 1))
  );
}

export function firstSampleIndexFromPathIndex(
  layer: PathAdjustLayer,
  anchorPathIndex: number
): number {
  const sampleCount = layer.item.result.samples.length;
  if (sampleCount === 0) return 0;
  for (let si = 0; si < sampleCount; si++) {
    if (mapSampleIndexToPathIndex(layer, si) >= anchorPathIndex) return si;
  }
  return sampleCount - 1;
}

/** 锚点起同轨迹段内时间向后的轨迹点 + 采样点 */
export function keysFromPathAnchorForward(
  layer: PathAdjustLayer,
  anchorPathIndex: number
): Set<string> {
  const segKeys = buildPathSegmentKeys(layer);
  const anchorSeg = segKeys[anchorPathIndex];
  const keys = new Set<string>();
  if (!anchorSeg) return keys;

  for (let i = anchorPathIndex; i < segKeys.length; i++) {
    if (segKeys[i] !== anchorSeg) break;
    keys.add(pointKey(layer.id, "path", i));
  }

  const firstSample = firstSampleIndexFromPathIndex(layer, anchorPathIndex);
  const samples = layer.item.result.samples;
  for (let si = firstSample; si < samples.length; si++) {
    if (segmentKeyForSampleIndex(layer, si) !== anchorSeg) continue;
    keys.add(pointKey(layer.id, "sample", si));
  }
  return keys;
}

const FOLLOW_CHAIN_DECAY = 0.74;
const FOLLOW_BLEND = 0.42;
const FOLLOW_RELAX_PASSES = 2;
const FOLLOW_INTERACTIVE_PASSES = 1;
const FOLLOW_OUTLIER_METERS = 12;
const FOLLOW_INTERACTIVE_MAX_SAMPLES = 480;

export interface FollowStraightenOptions {
  /** 拖动中为 true：降采样、少迭代，避免卡顿 */
  interactive?: boolean;
  /** 仅更新轨迹顶点偏移，不处理采样点（拖动预览用） */
  pathOnly?: boolean;
}

function directLonLat(
  layer: PathAdjustLayer,
  baseLon: number,
  baseLat: number,
  key: string,
  pointOffsets: Record<string, { east: number; north: number }>
): { longitude: number; latitude: number } {
  const extra = pointOffsets[key] ?? { east: 0, north: 0 };
  return offsetPosition(
    baseLon,
    baseLat,
    layer.offsetEastMeters + extra.east,
    layer.offsetNorthMeters + extra.north
  );
}

/** 拖动预览：直接读偏移，不做空间补丁扫描 */
export function pathPolylineLonLats(
  layer: PathAdjustLayer,
  pointOffsets?: Record<string, { east: number; north: number }>
): { longitude: number; latitude: number }[][] {
  const offsets = pointOffsets ?? layer.pointOffsets;
  const polylines: { longitude: number; latitude: number }[][] = [];
  let pathPointIdx = 0;
  for (const path of layer.item.result.paths) {
    const positions: { longitude: number; latitude: number }[] = [];
    for (const p of path.points) {
      const key = pointKey(layer.id, "path", pathPointIdx);
      positions.push(
        directLonLat(layer, p.longitude, p.latitude, key, offsets)
      );
      pathPointIdx++;
    }
    if (positions.length >= 2) polylines.push(positions);
  }
  return polylines;
}

function subsampleIndices(indices: number[], maxCount: number): number[] {
  if (indices.length <= maxCount) return indices;
  const step = Math.ceil(indices.length / maxCount);
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += step) out.push(indices[i]!);
  const last = indices[indices.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function pathIndicesInSegmentFrom(
  layer: PathAdjustLayer,
  anchorPathIndex: number
): number[] {
  const segKeys = buildPathSegmentKeys(layer);
  const anchorSeg = segKeys[anchorPathIndex];
  if (!anchorSeg) return [];
  const indices: number[] = [];
  for (let i = anchorPathIndex; i < segKeys.length; i++) {
    if (segKeys[i] !== anchorSeg) break;
    indices.push(i);
  }
  return indices;
}

function sampleIndicesInSegmentFrom(
  layer: PathAdjustLayer,
  anchorPathIndex: number
): number[] {
  const segKeys = buildPathSegmentKeys(layer);
  const anchorSeg = segKeys[anchorPathIndex];
  if (!anchorSeg) return [];
  const firstSi = firstSampleIndexFromPathIndex(layer, anchorPathIndex);
  const indices: number[] = [];
  for (let si = firstSi; si < layer.item.result.samples.length; si++) {
    if (segmentKeyForSampleIndex(layer, si) !== anchorSeg) continue;
    indices.push(si);
  }
  return indices;
}

export function setPointOffsetToLonLat(
  layer: PathAdjustLayer,
  pointOffsets: Record<string, { east: number; north: number }>,
  key: string,
  baseLon: number,
  baseLat: number,
  targetLon: number,
  targetLat: number
): void {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((baseLat * Math.PI) / 180);
  const totalEast = (targetLon - baseLon) * mPerDegLat * cosLat;
  const totalNorth = (targetLat - baseLat) * mPerDegLat;
  pointOffsets[key] = {
    east: totalEast - layer.offsetEastMeters,
    north: totalNorth - layer.offsetNorthMeters,
  };
}

function unitDirMeters(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number
): { east: number; north: number; len: number } {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((fromLat * Math.PI) / 180);
  const east = (toLon - fromLon) * mPerDegLat * cosLat;
  const north = (toLat - fromLat) * mPerDegLat;
  const len = Math.hypot(east, north);
  return { east, north, len };
}

function followBlendFactor(hop: number, outlierMeters: number): number {
  const base = FOLLOW_BLEND * Math.pow(FOLLOW_CHAIN_DECAY, Math.max(0, hop - 1));
  const boost =
    outlierMeters > FOLLOW_OUTLIER_METERS
      ? 1 + Math.min(0.8, (outlierMeters - FOLLOW_OUTLIER_METERS) / 40)
      : 1;
  return Math.min(0.95, base * boost);
}

function relaxPathChain(
  layer: PathAdjustLayer,
  pointOffsets: Record<string, { east: number; north: number }>,
  pathIndices: number[],
  anchorPathIndex: number,
  passes: number
): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 1; j < pathIndices.length; j++) {
      const i = pathIndices[j]!;
      const iPrev = pathIndices[j - 1]!;
      const key = pointKey(layer.id, "path", i);
      const keyPrev = pointKey(layer.id, "path", iPrev);
      const base = basePositionForPointKey(layer, key);
      const basePrev = basePositionForPointKey(layer, keyPrev);
      if (!base || !basePrev) continue;

      const prev = directLonLat(
        layer,
        basePrev.longitude,
        basePrev.latitude,
        keyPrev,
        pointOffsets
      );
      const cur = directLonLat(
        layer,
        base.longitude,
        base.latitude,
        key,
        pointOffsets
      );
      const edge = unitDirMeters(
        basePrev.longitude,
        basePrev.latitude,
        base.longitude,
        base.latitude
      );
      const edgeLen = edge.len > 0.05 ? edge.len : 1;
      const curDir = unitDirMeters(
        prev.longitude,
        prev.latitude,
        cur.longitude,
        cur.latitude
      );
      const useEast = curDir.len > 0.08 ? curDir.east / curDir.len : edge.east / (edge.len || 1);
      const useNorth = curDir.len > 0.08 ? curDir.north / curDir.len : edge.north / (edge.len || 1);
      const ideal = offsetPosition(
        prev.longitude,
        prev.latitude,
        useEast * edgeLen,
        useNorth * edgeLen
      );
      const outlier = distanceMeters(
        cur.longitude,
        cur.latitude,
        ideal.longitude,
        ideal.latitude
      );
      const blend = followBlendFactor(i - anchorPathIndex, outlier);
      const targetLon =
        cur.longitude + (ideal.longitude - cur.longitude) * blend;
      const targetLat =
        cur.latitude + (ideal.latitude - cur.latitude) * blend;
      setPointOffsetToLonLat(
        layer,
        pointOffsets,
        key,
        base.longitude,
        base.latitude,
        targetLon,
        targetLat
      );
    }
  }
}

function relaxSampleChain(
  layer: PathAdjustLayer,
  pointOffsets: Record<string, { east: number; north: number }>,
  sampleIndices: number[],
  anchorPathIndex: number,
  passes: number
): void {
  if (sampleIndices.length === 0) return;
  const anchorKey = pointKey(layer.id, "path", anchorPathIndex);
  const anchorBase = basePositionForPointKey(layer, anchorKey);
  if (!anchorBase) return;

  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < sampleIndices.length; j++) {
      const si = sampleIndices[j]!;
      const key = pointKey(layer.id, "sample", si);
      const base = basePositionForPointKey(layer, key);
      if (!base) continue;

      let prevLon: number;
      let prevLat: number;
      let basePrevLon: number;
      let basePrevLat: number;

      if (j === 0) {
        const anchorPos = directLonLat(
          layer,
          anchorBase.longitude,
          anchorBase.latitude,
          anchorKey,
          pointOffsets
        );
        prevLon = anchorPos.longitude;
        prevLat = anchorPos.latitude;
        basePrevLon = anchorBase.longitude;
        basePrevLat = anchorBase.latitude;
      } else {
        const siPrev = sampleIndices[j - 1]!;
        const prevKey = pointKey(layer.id, "sample", siPrev);
        const prevBase = basePositionForPointKey(layer, prevKey);
        if (!prevBase) continue;
        const prevPos = directLonLat(
          layer,
          prevBase.longitude,
          prevBase.latitude,
          prevKey,
          pointOffsets
        );
        prevLon = prevPos.longitude;
        prevLat = prevPos.latitude;
        basePrevLon = prevBase.longitude;
        basePrevLat = prevBase.latitude;
      }

      const cur = directLonLat(
        layer,
        base.longitude,
        base.latitude,
        key,
        pointOffsets
      );
      const edge = unitDirMeters(basePrevLon, basePrevLat, base.longitude, base.latitude);
      const edgeLen = edge.len > 0.05 ? edge.len : 1;
      const curDir = unitDirMeters(prevLon, prevLat, cur.longitude, cur.latitude);
      const useEast = curDir.len > 0.08 ? curDir.east / curDir.len : edge.east / (edge.len || 1);
      const useNorth = curDir.len > 0.08 ? curDir.north / curDir.len : edge.north / (edge.len || 1);
      const ideal = offsetPosition(prevLon, prevLat, useEast * edgeLen, useNorth * edgeLen);
      const mappedPath = mapSampleIndexToPathIndex(layer, si);
      const hop = Math.max(1, mappedPath - anchorPathIndex);
      const outlier = distanceMeters(
        cur.longitude,
        cur.latitude,
        ideal.longitude,
        ideal.latitude
      );
      const blend = followBlendFactor(hop, outlier);
      const targetLon =
        cur.longitude + (ideal.longitude - cur.longitude) * blend;
      const targetLat =
        cur.latitude + (ideal.latitude - cur.latitude) * blend;
      setPointOffsetToLonLat(
        layer,
        pointOffsets,
        key,
        base.longitude,
        base.latitude,
        targetLon,
        targetLat
      );
    }
  }
}

/**
 * 理线头：锚点钉在鼠标，同段内后续点按时间顺序链式收拢到路径上（非整段平移）。
 */
export function applyFollowStraighten(
  layers: PathAdjustLayer[],
  anchor: PathFollowAnchor,
  mouseLon: number,
  mouseLat: number,
  options?: FollowStraightenOptions
): PathAdjustLayer[] {
  const interactive = options?.interactive ?? false;
  const pathOnly = options?.pathOnly ?? interactive;
  const passes = interactive ? FOLLOW_INTERACTIVE_PASSES : FOLLOW_RELAX_PASSES;

  return layers.map((layer) => {
    if (layer.id !== anchor.layerId || layer.locked) return layer;

    const anchorKey = pointKey(layer.id, "path", anchor.pathIndex);
    const anchorBase = basePositionForPointKey(layer, anchorKey);
    if (!anchorBase) return layer;

    const pointOffsets = { ...layer.pointOffsets };
    setPointOffsetToLonLat(
      layer,
      pointOffsets,
      anchorKey,
      anchorBase.longitude,
      anchorBase.latitude,
      mouseLon,
      mouseLat
    );

    const pathIndices = pathIndicesInSegmentFrom(layer, anchor.pathIndex);
    relaxPathChain(layer, pointOffsets, pathIndices, anchor.pathIndex, passes);

    if (!pathOnly) {
      let sampleIndices = sampleIndicesInSegmentFrom(layer, anchor.pathIndex);
      if (interactive) {
        sampleIndices = subsampleIndices(
          sampleIndices,
          FOLLOW_INTERACTIVE_MAX_SAMPLES
        );
      }
      relaxSampleChain(
        layer,
        pointOffsets,
        sampleIndices,
        anchor.pathIndex,
        passes
      );
    }

    return { ...layer, pointOffsets };
  });
}

export function moveSelectedPoints(
  layers: PathAdjustLayer[],
  selectedKeys: Set<string>,
  dEast: number,
  dNorth: number
): PathAdjustLayer[] {
  if (selectedKeys.size === 0) return layers;
  return layers.map((layer) => {
    if (layer.locked) return layer;
    let changed = false;
    const pointOffsets = { ...layer.pointOffsets };
    for (const key of selectedKeys) {
      if (!key.startsWith(`${layer.id}:`)) continue;
      const cur = pointOffsets[key] ?? { east: 0, north: 0 };
      pointOffsets[key] = {
        east: cur.east + dEast,
        north: cur.north + dNorth,
      };
      changed = true;
    }
    return changed ? { ...layer, pointOffsets } : layer;
  });
}

export function moveActiveLayers(
  layers: PathAdjustLayer[],
  dEast: number,
  dNorth: number
): PathAdjustLayer[] {
  return layers.map((layer) => {
    if (layer.locked || !layer.active) return layer;
    return {
      ...layer,
      offsetEastMeters: layer.offsetEastMeters + dEast,
      offsetNorthMeters: layer.offsetNorthMeters + dNorth,
    };
  });
}

export interface PathAdjustPatch {
  kind: "path" | "sample";
  pointIndex: number;
  baseLon: number;
  baseLat: number;
  dEast: number;
  dNorth: number;
  radiusMeters: number;
  /** 轨迹段键 pathIndex:segmentIndex，交叉轨迹仅影响同一段 */
  segmentKey: string;
}

export interface SegmentTimeline {
  /** 主区逻辑采样点数（= servingSamples，每次主区行一个点） */
  sampleCount: number;
  previewSampleCount?: number;
  logicalPointCount?: number;
  pathPointCount: number;
  pathSegmentKeys: string[];
}

export interface FilePathCorrection {
  fileName: string;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  patches: PathAdjustPatch[];
  segmentTimeline?: SegmentTimeline;
}

/** 与后端 rowExtraOffset 一致，附带分项明细 */
export function rowExtraOffsetFromCorrection(
  correction: FilePathCorrection,
  logicalPointIndex: number,
  lon: number,
  lat: number,
  logicalPointCount: number
): {
  east: number;
  north: number;
  sampleIdx: number;
  rowSeg: string;
  sampleDirectEast: number;
  sampleDirectNorth: number;
  pathMappedEast: number;
  pathMappedNorth: number;
  pathMappedIndex: number;
  matchedPathPatches: {
    pointIndex: number;
    dEast: number;
    dNorth: number;
    segmentKey: string;
  }[];
} {
  const timeline = correction.segmentTimeline;
  if (!timeline) {
    return {
      east: 0,
      north: 0,
      sampleIdx: 0,
      rowSeg: "0:0",
      sampleDirectEast: 0,
      sampleDirectNorth: 0,
      pathMappedEast: 0,
      pathMappedNorth: 0,
      pathMappedIndex: 0,
      matchedPathPatches: [],
    };
  }

  const rowSeg = segmentKeyForCsvRow(
    timeline,
    logicalPointIndex,
    logicalPointCount
  );
  const previewCount =
    timeline.previewSampleCount ?? timeline.sampleCount;
  const sampleIdx = sampleIndexForCsvRow(
    previewCount,
    logicalPointIndex,
    logicalPointCount
  );

  let sampleDirectEast = 0;
  let sampleDirectNorth = 0;

  const logicalPatch = correction.patches.find(
    (p) => p.kind === "sample" && p.pointIndex === logicalPointIndex
  );
  if (logicalPatch) {
    sampleDirectEast = logicalPatch.dEast;
    sampleDirectNorth = logicalPatch.dNorth;
  } else {
    for (const p of correction.patches) {
      if (p.kind === "sample" && p.pointIndex === sampleIdx) {
        sampleDirectEast += p.dEast;
        sampleDirectNorth += p.dNorth;
      }
    }
  }

  const pathOff = pathOffsetFromPatchesByPosition(
    correction.patches,
    lon,
    lat
  );

  return {
    east: sampleDirectEast + pathOff.east,
    north: sampleDirectNorth + pathOff.north,
    sampleIdx,
    rowSeg,
    sampleDirectEast,
    sampleDirectNorth,
    pathMappedEast: pathOff.east,
    pathMappedNorth: pathOff.north,
    pathMappedIndex: pathOff.matchedPathPatches[0]?.pointIndex ?? -1,
    matchedPathPatches: pathOff.matchedPathPatches.map((p) => ({
      pointIndex: p.pointIndex,
      dEast: p.dEast,
      dNorth: p.dNorth,
      segmentKey: p.segmentKey ?? "",
    })),
  };
}

export async function countCsvDataRows(file: File): Promise<number> {
  const { total, valid } = await countCsvRowStats(file);
  return valid > 0 ? valid : total;
}

export async function countCsvRowStats(
  file: File
): Promise<{ total: number; valid: number }> {
  const text = await file.text();
  let total = 0;
  let valid = 0;
  let header = true;
  let lonIdx = -1;
  let latIdx = -1;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (header) {
      const cols = line.split(",");
      for (let i = 0; i < cols.length; i++) {
        const h = cols[i]!.trim().replace(/^\ufeff/, "");
        if (h === "Longitude") lonIdx = i;
        else if (h === "Latitude") latIdx = i;
      }
      header = false;
      continue;
    }
    total++;
    if (lonIdx < 0 || latIdx < 0) continue;
    const cols = line.split(",");
    const lon = Number(cols[lonIdx]);
    const lat = Number(cols[latIdx]);
    if (
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      !(lon === 0 && lat === 0)
    ) {
      valid++;
    }
  }
  return { total, valid };
}

export function csvRowForSampleIndex(
  sampleIndex: number,
  sampleCount: number,
  dataRowCount: number
): number {
  return Math.round(
    exactIndexForProportion(
      proportionForIndex(sampleIndex, sampleCount),
      dataRowCount
    )
  );
}

export interface FrontendExportDiagRow {
  sampleIndex: number;
  csvRowIndex: number;
  baseLon: number;
  baseLat: number;
  displayLon: number;
  displayLat: number;
  exportLon: number;
  exportLat: number;
  displayVsExportMeters: number;
  exportExtra: ReturnType<typeof rowExtraOffsetFromCorrection>;
}

export interface FrontendExportDiagnostics {
  fileName: string;
  dataRowCount: number;
  previewSampleCount: number;
  previewPathPointCount: number;
  statsTotalRowsFromPreview: number | undefined;
  layerOffsetEast: number;
  layerOffsetNorth: number;
  patchCount: number;
  patches: PathAdjustPatch[];
  rows: FrontendExportDiagRow[];
  maxDisplayVsExportMeters: number;
}

export function buildFrontendExportDiagnostics(
  layer: PathAdjustLayer,
  logicalPointCount: number
): FrontendExportDiagnostics {
  const correction = buildFileCorrections([layer])[0]!;
  const samples = layer.item.result.samples;
  const sampleCount = samples.length;
  const indices = new Set<number>([0]);
  if (sampleCount > 1) {
    indices.add(Math.floor(sampleCount / 2));
    indices.add(sampleCount - 1);
  }
  for (const p of correction.patches) {
    if (p.kind === "sample") indices.add(p.pointIndex);
  }
  for (const key of Object.keys(layer.pointOffsets)) {
    const parts = key.split(":");
    if (parts[1] === "sample") indices.add(Number(parts[2]));
  }

  const rows: FrontendExportDiagRow[] = [];
  let maxDisplayVsExportMeters = 0;

  for (const sampleIndex of [...indices].sort((a, b) => a - b)) {
    const sample = samples[sampleIndex];
    if (!sample) continue;
    const csvRowIndex = csvRowForSampleIndex(
      sampleIndex,
      sampleCount,
      logicalPointCount
    );
    const key = pointKey(layer.id, "sample", sampleIndex);
    const display = effectiveLonLat(
      layer,
      sample.longitude,
      sample.latitude,
      key
    );
    const exportExtra = rowExtraOffsetFromCorrection(
      correction,
      sampleIndex,
      sample.longitude,
      sample.latitude,
      logicalPointCount
    );
    const exported = offsetPosition(
      sample.longitude,
      sample.latitude,
      layer.offsetEastMeters + exportExtra.east,
      layer.offsetNorthMeters + exportExtra.north
    );
    const displayVsExportMeters = distanceMeters(
      display.longitude,
      display.latitude,
      exported.longitude,
      exported.latitude
    );
    maxDisplayVsExportMeters = Math.max(
      maxDisplayVsExportMeters,
      displayVsExportMeters
    );
    rows.push({
      sampleIndex,
      csvRowIndex,
      baseLon: sample.longitude,
      baseLat: sample.latitude,
      displayLon: display.longitude,
      displayLat: display.latitude,
      exportLon: exported.longitude,
      exportLat: exported.latitude,
      displayVsExportMeters,
      exportExtra,
    });
  }

  let pathPointCount = 0;
  for (const path of layer.item.result.paths) {
    pathPointCount += path.points.length;
  }

  return {
    fileName: layer.fileName,
    dataRowCount: logicalPointCount,
    previewSampleCount: sampleCount,
    previewPathPointCount: pathPointCount,
    statsTotalRowsFromPreview: layer.item.result.stats?.totalRows,
    layerOffsetEast: layer.offsetEastMeters,
    layerOffsetNorth: layer.offsetNorthMeters,
    patchCount: correction.patches.length,
    patches: correction.patches,
    rows,
    maxDisplayVsExportMeters,
  };
}

export function buildFileCorrections(
  layers: PathAdjustLayer[]
): FilePathCorrection[] {
  return layers.map((layer) => {
    const patches: PathAdjustPatch[] = [];
    if (layer.shapeSnapPatches?.length) {
      patches.push(...layer.shapeSnapPatches);
    } else {
      for (const [key, off] of Object.entries(layer.pointOffsets)) {
        if (Math.abs(off.east) < 1e-6 && Math.abs(off.north) < 1e-6) continue;
        const base = basePositionForPointKey(layer, key);
        if (!base) continue;
        const segmentKey = segmentKeyForAdjustKey(layer, key) ?? "0:0";
        patches.push({
          kind: base.kind,
          pointIndex: Number(key.split(":")[2]),
          baseLon: base.longitude,
          baseLat: base.latitude,
          dEast: off.east,
          dNorth: off.north,
          radiusMeters: patchRadiusForKind(base.kind),
          segmentKey,
        });
      }
    }
    return {
      fileName: layer.fileName,
      offsetEastMeters: layer.offsetEastMeters,
      offsetNorthMeters: layer.offsetNorthMeters,
      patches,
      segmentTimeline: buildSegmentTimeline(layer),
    };
  });
}

export function distanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mPerDegLat * cosLat;
  const dy = (lat2 - lat1) * mPerDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}
