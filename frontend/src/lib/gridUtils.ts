import type { GridIndexMode, LuceSettings } from "../types/luce";

/** 米/度（纬度），与后端栅格化一致 */
export const M_PER_DEG_LAT = 111_320;

export interface GridIndexOptions {
  mode: GridIndexMode;
  refLat: number;
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

function cosLatDeg(latDeg: number): number {
  return Math.cos((latDeg * Math.PI) / 180);
}

export function gridKeyFromLonLat(
  lon: number,
  lat: number,
  sizeM: number,
  opts: GridIndexOptions
): string {
  let gx: number;
  let gy: number;
  const cosRef = cosLatDeg(opts.refLat);
  if (opts.mode === "dataset") {
    gx = Math.floor(((lon - opts.refLon) * cosRef * M_PER_DEG_LAT) / sizeM);
    gy = Math.floor(((lat - opts.refLat) * M_PER_DEG_LAT) / sizeM);
  } else {
    gx = Math.floor((lon * cosRef * M_PER_DEG_LAT) / sizeM);
    gy = Math.floor((lat * M_PER_DEG_LAT) / sizeM);
  }
  return `${gx},${gy}`;
}

export function cellBoundsFromGridKey(
  key: string,
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
  const [gxStr, gyStr] = key.split(",");
  const gx = Number(gxStr);
  const gy = Number(gyStr);

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

/** 用当前栅格规则重算格边界，保证优化前/后/对比图层对齐 */
export function cellBoundsForDisplay(
  cell: { longitude: number; latitude: number },
  sizeM: number,
  opts: GridIndexOptions
) {
  const key = gridKeyFromCell(cell, sizeM, opts);
  return cellBoundsFromGridKey(key, sizeM, opts);
}

export function gridSettingsAffectKeys(
  a: Pick<
    LuceSettings,
    | "gridIndexMode"
    | "gridSizeMeters"
    | "gridRefLat"
    | "gridRefLon"
    | "regionCenterLat"
  >,
  b: Pick<
    LuceSettings,
    | "gridIndexMode"
    | "gridSizeMeters"
    | "gridRefLat"
    | "gridRefLon"
    | "regionCenterLat"
  >
): boolean {
  const modeA = a.gridIndexMode ?? "global";
  const modeB = b.gridIndexMode ?? "global";
  return (
    modeA !== modeB ||
    a.gridSizeMeters !== b.gridSizeMeters ||
    (a.gridRefLat ?? 0) !== (b.gridRefLat ?? 0) ||
    (a.gridRefLon ?? 0) !== (b.gridRefLon ?? 0) ||
    (modeA === "global" &&
      (a.regionCenterLat ?? 0) !== (b.regionCenterLat ?? 0))
  );
}
