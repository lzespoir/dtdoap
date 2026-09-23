import fs from "node:fs/promises";
import path from "node:path";
import { batchDir } from "./batchStorage.js";
import {
  DEFAULT_LUCE_SETTINGS,
  type LuceSettings,
} from "./types/luce.js";

const SETTINGS_FILE = "luce-settings.json";

function normalizeMetricRange(
  min: number,
  max: number,
  defaultMin: number,
  defaultMax: number
): { min: number; max: number } {
  const lo = Number.isFinite(min) ? min : defaultMin;
  const hi = Number.isFinite(max) ? max : defaultMax;
  if (lo >= hi) return { min: defaultMin, max: defaultMax };
  return { min: lo, max: hi };
}

function normalizeLuceSettings(raw: Partial<LuceSettings>): LuceSettings {
  const legacy = raw as Partial<LuceSettings> & { afterRsrpMinus10Db?: boolean };
  const s: LuceSettings = { ...DEFAULT_LUCE_SETTINGS, ...raw };
  s.comparisonGroupName =
    typeof s.comparisonGroupName === "string" && s.comparisonGroupName.trim()
      ? s.comparisonGroupName.trim()
      : DEFAULT_LUCE_SETTINGS.comparisonGroupName;
  s.comparisonTargetPcis = Array.isArray(s.comparisonTargetPcis)
    ? [
        ...new Set(
          s.comparisonTargetPcis
            .map(Number)
            .filter((pci) => Number.isFinite(pci))
        ),
      ]
    : [];
  if (!s.grasslandBboxSource) s.grasslandBboxSource = "custom";
  if (!s.gridIndexMode) s.gridIndexMode = "global";
  if (!s.gridRefOrigin) s.gridRefOrigin = "before";
  if (!s.gridAggMode) s.gridAggMode = "dominant_pci";
  if (s.gridRefOrigin === "notebook-combined" && s.gridIndexMode !== "dataset") {
    s.gridRefOrigin = "before";
  }
  const rsrp = normalizeMetricRange(
    s.rsrpRangeMin,
    s.rsrpRangeMax,
    DEFAULT_LUCE_SETTINGS.rsrpRangeMin,
    DEFAULT_LUCE_SETTINGS.rsrpRangeMax
  );
  s.rsrpRangeMin = rsrp.min;
  s.rsrpRangeMax = rsrp.max;
  const sinr = normalizeMetricRange(
    s.sinrRangeMin,
    s.sinrRangeMax,
    DEFAULT_LUCE_SETTINGS.sinrRangeMin,
    DEFAULT_LUCE_SETTINGS.sinrRangeMax
  );
  s.sinrRangeMin = sinr.min;
  s.sinrRangeMax = sinr.max;
  if (!s.pciColorOverrides || typeof s.pciColorOverrides !== "object") {
    s.pciColorOverrides = {};
  }
  if (Number.isFinite(s.afterRsrpOffsetDb)) {
    s.afterRsrpOffsetDb = Number(s.afterRsrpOffsetDb);
  } else if (legacy.afterRsrpMinus10Db === true) {
    s.afterRsrpOffsetDb = -10;
  } else {
    s.afterRsrpOffsetDb = 0;
  }
  s.afterSinrOffsetDb = Number.isFinite(s.afterSinrOffsetDb)
    ? Number(s.afterSinrOffsetDb)
    : 0;
  s.qualityRsrpThresholdDb = Number.isFinite(s.qualityRsrpThresholdDb)
    ? Number(s.qualityRsrpThresholdDb)
    : DEFAULT_LUCE_SETTINGS.qualityRsrpThresholdDb;
  s.qualitySinrThresholdDb = Number.isFinite(s.qualitySinrThresholdDb)
    ? Number(s.qualitySinrThresholdDb)
    : DEFAULT_LUCE_SETTINGS.qualitySinrThresholdDb;
  return s;
}

export function settingsPath(batchId: string): string {
  return path.join(batchDir(batchId), SETTINGS_FILE);
}

export async function loadLuceSettings(
  batchId: string
): Promise<LuceSettings> {
  try {
    const raw = await fs.readFile(settingsPath(batchId), "utf-8");
    return normalizeLuceSettings(JSON.parse(raw) as LuceSettings);
  } catch {
    return { ...DEFAULT_LUCE_SETTINGS };
  }
}

export async function saveLuceSettings(
  batchId: string,
  settings: LuceSettings
): Promise<void> {
  const normalized = normalizeLuceSettings(settings);
  await fs.writeFile(
    settingsPath(batchId),
    JSON.stringify(normalized, null, 2),
    "utf-8"
  );
}

const LEGACY_DAYUN_LON = 114.212309;
const LEGACY_DAYUN_LAT = 22.697092;

function isLegacyDayunRegion(settings: LuceSettings): boolean {
  return (
    Math.abs(settings.regionCenterLon - LEGACY_DAYUN_LON) < 1e-6 &&
    Math.abs(settings.regionCenterLat - LEGACY_DAYUN_LAT) < 1e-6
  );
}

/** 用工参小区质心更新区域中心；仅在首次或仍为遗留大运默认中心时写入 */
export async function seedRegionFromCellsIfNeeded(
  batchId: string,
  cells: Array<{ longitude: number; latitude: number }>
): Promise<LuceSettings | null> {
  if (cells.length === 0) return null;

  let hadFile = true;
  try {
    await fs.access(settingsPath(batchId));
  } catch {
    hadFile = false;
  }

  const settings = await loadLuceSettings(batchId);
  if (hadFile && !isLegacyDayunRegion(settings)) {
    return null;
  }

  const lon =
    cells.reduce((sum, c) => sum + c.longitude, 0) / cells.length;
  const lat =
    cells.reduce((sum, c) => sum + c.latitude, 0) / cells.length;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let maxR = 0;
  for (const c of cells) {
    const dx = (c.longitude - lon) * 111320 * cosLat;
    const dy = (c.latitude - lat) * 110540;
    maxR = Math.max(maxR, Math.hypot(dx, dy));
  }

  const next: LuceSettings = {
    ...settings,
    regionCenterLon: Number(lon.toFixed(6)),
    regionCenterLat: Number(lat.toFixed(6)),
    regionRadiusMeters: Math.max(80, Math.ceil(maxR + 40)),
  };
  await saveLuceSettings(batchId, next);
  return next;
}
