import type { GridCell, LuceSettings } from "../types/luce";
import {
  cellBoundsForDisplay,
  gridIndexOptionsFromSettings,
  gridKeyFromCell,
} from "./gridUtils";

/** 共同栅格上的优化前后差值（after − before） */
export interface GridDeltaCell {
  longitude: number;
  latitude: number;
  west: number;
  south: number;
  east: number;
  north: number;
  deltaRsrp: number;
  deltaSinr: number;
  count: number;
}

/** 仅保留优化前后均存在的栅格，计算 RSRP/SINR 增量 */
export function buildGridDeltaCells(
  beforeGrid: GridCell[],
  afterGrid: GridCell[],
  settings: Pick<
    LuceSettings,
    | "gridSizeMeters"
    | "gridIndexMode"
    | "regionCenterLat"
    | "regionCenterLon"
    | "gridRefLat"
    | "gridRefLon"
  >
): GridDeltaCell[] {
  const sizeM = settings.gridSizeMeters;
  const gridOpts = gridIndexOptionsFromSettings(settings);
  const beforeMap = new Map<string, GridCell>();
  const afterMap = new Map<string, GridCell>();
  for (const c of beforeGrid) {
    beforeMap.set(gridKeyFromCell(c, sizeM, gridOpts), c);
  }
  for (const c of afterGrid) {
    afterMap.set(gridKeyFromCell(c, sizeM, gridOpts), c);
  }

  const out: GridDeltaCell[] = [];
  for (const [key, bCell] of beforeMap) {
    const aCell = afterMap.get(key);
    if (!aCell) continue;

    const bSinr = Number.isFinite(bCell.sinr) ? bCell.sinr : NaN;
    const aSinr = Number.isFinite(aCell.sinr) ? aCell.sinr : NaN;
    const deltaSinr =
      Number.isFinite(bSinr) && Number.isFinite(aSinr) ? aSinr - bSinr : NaN;

    // 按当前栅格规则重算边界，使对比层与优化前/后视图对齐
    const bounds = cellBoundsForDisplay(bCell, sizeM, gridOpts);

    out.push({
      longitude: bounds.longitude,
      latitude: bounds.latitude,
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
      deltaRsrp: aCell.rsrp - bCell.rsrp,
      deltaSinr,
      count: Math.max(bCell.count, aCell.count),
    });
  }
  return out;
}
