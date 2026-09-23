import { STADIUM_GLB } from "../constants";

export interface StadiumGlbTune {
  /** 南北方向缩放（ENU 北向 Y），1=不变 */
  northSouthScale: number;
}

const STORAGE_KEY = "netopt-stadium-glb-tune";

export function defaultStadiumGlbTune(): StadiumGlbTune {
  return { northSouthScale: STADIUM_GLB.northSouthScale };
}

export function loadStadiumGlbTune(): StadiumGlbTune {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStadiumGlbTune();
    const parsed = JSON.parse(raw) as Partial<
      StadiumGlbTune & { verticalScale?: number }
    >;
    const n = Number(parsed.northSouthScale ?? parsed.verticalScale);
    return {
      northSouthScale: Number.isFinite(n) ? Math.min(3, Math.max(0.3, n)) : 1,
    };
  } catch {
    return defaultStadiumGlbTune();
  }
}

export function saveStadiumGlbTune(tune: StadiumGlbTune): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tune));
}

export function formatStadiumGlbConstants(tune: StadiumGlbTune): string {
  return `northSouthScale: ${tune.northSouthScale.toFixed(3)},`;
}
