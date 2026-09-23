import type { DrivePath, LuceProcessResult, PathPoint } from "../types/luce";

/** 兼容旧版仅含 path 的结果 */
/** 单文件内可绘制的轨迹段（≥2 点） */
export function getDrivePathPolylines(
  path: DrivePath
): { fileName: string; segmentIndex: number; points: PathPoint[] }[] {
  if (path.segments?.length) {
    return path.segments
      .map((points, segmentIndex) => ({
        fileName: path.fileName,
        segmentIndex,
        points,
      }))
      .filter((s) => s.points.length >= 2);
  }
  if (path.points.length >= 2) {
    return [{ fileName: path.fileName, segmentIndex: 0, points: path.points }];
  }
  return [];
}

export function getDrivePaths(luce: LuceProcessResult): DrivePath[] {
  if (luce.paths?.length) return luce.paths;
  if (luce.path?.length) {
    return [{ fileName: "路测轨迹", points: luce.path }];
  }
  return [];
}

export function countDrivePathPoints(luce: LuceProcessResult): number {
  let n = 0;
  for (const p of getDrivePaths(luce)) {
    n += getDrivePathPolylines(p).reduce((s, seg) => s + seg.points.length, 0);
  }
  return n;
}

export const PATH_LINE_COLORS = [
  "#00bcd4",
  "#ff9800",
  "#9c27b0",
  "#4caf50",
  "#e91e63",
  "#3f51b5",
  "#cddc39",
  "#795548",
];
