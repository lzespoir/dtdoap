import { STADIUM_GROUND } from "../constants";

/** 体育场航拍衬底手动对齐参数（实时预览，可持久化到 localStorage） */
export interface StadiumGroundTune {
  /** 0~1，贴图不透明度 */
  opacity: number;
  /** 相对 constants 尺寸的缩放倍数（写入 constants 后应归零为 1） */
  scale: number;
  /** 在 constants 偏移基础上的东向微调 (m)，正=东 */
  offsetEastMeters: number;
  /** 在 constants 偏移基础上的北向微调 (m)，正=北 */
  offsetNorthMeters: number;
}

interface StoredStadiumGroundTune extends StadiumGroundTune {
  layoutRevision?: number;
}

export function defaultStadiumGroundTune(): StadiumGroundTune {
  return {
    opacity: STADIUM_GROUND.opacity,
    scale: 1,
    offsetEastMeters: 0,
    offsetNorthMeters: 0,
  };
}

/** @deprecated use defaultStadiumGroundTune */
export const DEFAULT_STADIUM_GROUND_TUNE = defaultStadiumGroundTune();

const STORAGE_KEY = "netopt-stadium-ground-tune";

export function loadStadiumGroundTune(): StadiumGroundTune {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStadiumGroundTune();
    const parsed = JSON.parse(raw) as Partial<StoredStadiumGroundTune>;
    if (parsed.layoutRevision !== STADIUM_GROUND.layoutRevision) {
      const fresh = defaultStadiumGroundTune();
      saveStadiumGroundTune(fresh);
      return fresh;
    }
    return {
      opacity: clampNum(
        parsed.opacity,
        0.05,
        1,
        STADIUM_GROUND.opacity
      ),
      scale: clampNum(parsed.scale, 0.2, 3, 1),
      offsetEastMeters: numOr(parsed.offsetEastMeters, 0),
      offsetNorthMeters: numOr(parsed.offsetNorthMeters, 0),
    };
  } catch {
    return defaultStadiumGroundTune();
  }
}

export function saveStadiumGroundTune(tune: StadiumGroundTune): void {
  const payload: StoredStadiumGroundTune = {
    ...tune,
    layoutRevision: STADIUM_GROUND.layoutRevision,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/** 清除浏览器内额外偏移/缩放，仅保留透明度；与 constants 对齐时用 */
export function clearStadiumGroundLayoutTune(
  tune: StadiumGroundTune
): StadiumGroundTune {
  return {
    ...tune,
    scale: 1,
    offsetEastMeters: 0,
    offsetNorthMeters: 0,
  };
}

/** 复制到 constants.ts 时可参考的合并后参数（已是最终值，勿再叠加微调） */
export function formatStadiumGroundConstants(tune: StadiumGroundTune): string {
  const east = STADIUM_GROUND.offsetEastMeters + tune.offsetEastMeters;
  const north = STADIUM_GROUND.offsetNorthMeters + tune.offsetNorthMeters;
  const halfW = STADIUM_GROUND.halfWidthMeters * tune.scale;
  const halfL = STADIUM_GROUND.halfLengthMeters * tune.scale;
  return [
    `offsetEastMeters: ${east.toFixed(1)},`,
    `offsetNorthMeters: ${north.toFixed(1)},`,
    `halfWidthMeters: ${halfW.toFixed(1)},`,
    `halfLengthMeters: ${halfL.toFixed(1)},`,
    `opacity: ${tune.opacity.toFixed(2)},`,
    `layoutRevision: ${STADIUM_GROUND.layoutRevision + 1}, // 写入后请 +1`,
  ].join("\n");
}

function clampNum(
  v: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
