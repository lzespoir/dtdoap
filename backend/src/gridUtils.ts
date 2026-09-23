import type { GridIndexMode, LuceSettings } from "./types/luce.js";

/** 米/度（纬度方向），与 luceProcessor 栅格化一致 */
export const M_PER_DEG_LAT = 111_320;

export interface GridIndexOptions {
  mode: GridIndexMode;
  /** global：cos(参考纬) 用于经度米制换算；dataset：原点纬 + cos */
  refLat: number;
  /** dataset 模式下的原点经度 */
  refLon: number;
}

export function gridIndexOptionsFromSettings(
  settings: Pick<
    LuceSettings,
    | "gridIndexMode"
    | "regionCenterLat"
    | "regionCenterLon"
    | "gridRefLat"
    | "gridRefLon"
  >
): GridIndexOptions {
  const mode = settings.gridIndexMode ?? "global";
  if (mode === "dataset") {
    const refLat = Number.isFinite(settings.gridRefLat)
      ? settings.gridRefLat!
      : settings.regionCenterLat;
    const refLon = Number.isFinite(settings.gridRefLon)
      ? settings.gridRefLon!
      : settings.regionCenterLon;
    return { mode: "dataset", refLat, refLon };
  }
  return {
    mode: "global",
    refLat: settings.regionCenterLat,
    refLon: settings.regionCenterLon,
  };
}

export function medianLonLatFromSamples(
  samples: { longitude: number; latitude: number }[]
): { lon: number; lat: number } {
  if (samples.length === 0) {
    return { lon: 114.212309, lat: 22.697092 };
  }
  const lons = samples.map((s) => s.longitude).sort((a, b) => a - b);
  const lats = samples.map((s) => s.latitude).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median = (arr: number[]) =>
    samples.length % 2 === 1
      ? arr[mid]
      : (arr[mid - 1] + arr[mid]) / 2;
  return { lon: median(lons), lat: median(lats) };
}

function cosLatDeg(latDeg: number): number {
  return Math.cos((latDeg * Math.PI) / 180);
}

/**
 * 经纬度 → 栅格下标。
 * global：floor(经度×cos(refLat)×111320/边长)，refLat=regionCenterLat，行列对齐；
 * dataset：相对数据集中位原点（Notebook 对齐）。
 */
export function gridIndicesFromLonLat(
  lon: number,
  lat: number,
  sizeM: number,
  opts: GridIndexOptions
): { gx: number; gy: number } {
  const cosRef = cosLatDeg(opts.refLat);
  if (opts.mode === "dataset") {
    return {
      gx: Math.floor(
        ((lon - opts.refLon) * cosRef * M_PER_DEG_LAT) / sizeM
      ),
      gy: Math.floor(((lat - opts.refLat) * M_PER_DEG_LAT) / sizeM),
    };
  }

  return {
    gx: Math.floor((lon * cosRef * M_PER_DEG_LAT) / sizeM),
    gy: Math.floor((lat * M_PER_DEG_LAT) / sizeM),
  };
}

export function gridKeyFromLonLat(
  lon: number,
  lat: number,
  sizeM: number,
  opts: GridIndexOptions
): string {
  const { gx, gy } = gridIndicesFromLonLat(lon, lat, sizeM, opts);
  return `${gx},${gy}`;
}

export function cellBoundsFromIndices(
  gx: number,
  gy: number,
  sizeM: number,
  opts: GridIndexOptions
): {
  west: number;
  south: number;
  east: number;
  north: number;
  longitude: number;
  latitude: number;
} {
  if (opts.mode === "dataset") {
    const cosRef = cosLatDeg(opts.refLat);
    const west = opts.refLon + (gx * sizeM) / (M_PER_DEG_LAT * cosRef);
    const south = opts.refLat + (gy * sizeM) / M_PER_DEG_LAT;
    const east = west + sizeM / (M_PER_DEG_LAT * cosRef);
    const north = south + sizeM / M_PER_DEG_LAT;
    return {
      west,
      south,
      east,
      north,
      longitude: (west + east) / 2,
      latitude: (south + north) / 2,
    };
  }

  const cosRef = cosLatDeg(opts.refLat);
  const south = (gy * sizeM) / M_PER_DEG_LAT;
  const north = ((gy + 1) * sizeM) / M_PER_DEG_LAT;
  const west = (gx * sizeM) / (M_PER_DEG_LAT * cosRef);
  const east = ((gx + 1) * sizeM) / (M_PER_DEG_LAT * cosRef);
  return {
    west,
    south,
    east,
    north,
    longitude: (west + east) / 2,
    latitude: (south + north) / 2,
  };
}

export function gridKeyFromCell(
  cell: { longitude: number; latitude: number },
  sizeM: number,
  opts: GridIndexOptions
): string {
  return gridKeyFromLonLat(cell.longitude, cell.latitude, sizeM, opts);
}
