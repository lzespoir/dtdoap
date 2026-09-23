import type { PathPoint } from "./types/luce.js";

/** 轨迹构建算法版本（变更后需重算 paths 缓存） */
export const PATH_BUILD_VERSION = "v2-segment-dedup";

export interface PathBuildOptions {
  /** 与上一保留点距离小于此值则跳过（去重静止抖动） */
  minStepMeters: number;
  /** 相邻点时间序跳变超过此值则断开为新线段，避免跨场直线 */
  maxJumpMeters: number;
  /** 道格拉斯-普克简化容差 (m)，0 表示不简化 */
  simplifyToleranceMeters: number;
}

export const DEFAULT_PATH_BUILD_OPTIONS: PathBuildOptions = {
  minStepMeters: 1.5,
  maxJumpMeters: 45,
  simplifyToleranceMeters: 0,
};

const M_PER_DEG_LAT = 111_320;

function distM(a: PathPoint, b: PathPoint): number {
  const cosLat = Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  const dx = (b.longitude - a.longitude) * M_PER_DEG_LAT * cosLat;
  const dy = (b.latitude - a.latitude) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

function perpDistanceM(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const cosLat = Math.cos((p.latitude * Math.PI) / 180);
  const ax = a.longitude * M_PER_DEG_LAT * cosLat;
  const ay = a.latitude * M_PER_DEG_LAT;
  const bx = b.longitude * M_PER_DEG_LAT * cosLat;
  const by = b.latitude * M_PER_DEG_LAT;
  const px = p.longitude * M_PER_DEG_LAT * cosLat;
  const py = p.latitude * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return distM(p, a);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
}

function douglasPeucker(points: PathPoint[], eps: number): PathPoint[] {
  if (points.length <= 2) return points;
  let maxD = 0;
  let idx = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDistanceM(points[i], points[0], points[end]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [points[0], points[end]];
  const left = douglasPeucker(points.slice(0, idx + 1), eps);
  const right = douglasPeucker(points.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

function simplifySegment(
  points: PathPoint[],
  opts: PathBuildOptions
): PathPoint[] {
  if (points.length <= 2) return points;
  if (opts.simplifyToleranceMeters > 0) {
    return douglasPeucker(points, opts.simplifyToleranceMeters);
  }
  return points;
}

/**
 * 按时间序点列构建轨迹：距离去重 + 大跳变分段。
 */
export function buildDrivePathSegments(
  raw: PathPoint[],
  opts: PathBuildOptions = DEFAULT_PATH_BUILD_OPTIONS
): PathPoint[][] {
  const valid = raw.filter(
    (p) =>
      Number.isFinite(p.longitude) &&
      Number.isFinite(p.latitude) &&
      Math.abs(p.latitude) <= 90
  );
  if (valid.length === 0) return [];

  const segments: PathPoint[][] = [];
  let current: PathPoint[] = [valid[0]];

  for (let i = 1; i < valid.length; i++) {
    const p = valid[i];
    const last = current[current.length - 1];
    const d = distM(last, p);

    if (d > opts.maxJumpMeters) {
      if (current.length >= 2) {
        segments.push(simplifySegment(current, opts));
      }
      current = [p];
      continue;
    }

    if (d < opts.minStepMeters) continue;

    current.push(p);
  }

  if (current.length >= 2) {
    segments.push(simplifySegment(current, opts));
  } else if (current.length === 1 && segments.length === 0) {
    /* 全程几乎静止：保留单点线段，前端不绘制 */
  }

  return segments;
}

export function flattenSegments(segments: PathPoint[][]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const seg of segments) {
    if (out.length > 0 && seg.length > 0) {
      const a = out[out.length - 1];
      const b = seg[0];
      if (a.longitude === b.longitude && a.latitude === b.latitude) {
        out.push(...seg.slice(1));
        continue;
      }
    }
    out.push(...seg);
  }
  return out;
}

export function countPathPoints(segments: PathPoint[][]): number {
  return segments.reduce((n, s) => n + s.length, 0);
}
