import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LuceSettings } from "./types/luce.js";

export type RegionBbox = {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
};

export type RegionBboxPreset = {
  id: string;
  label: string;
  bbox: RegionBbox;
};

export type RegionBboxPresetsFile = {
  version: number;
  presets: RegionBboxPreset[];
};

const PRESETS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config",
  "region-bbox-presets.json"
);

function validatePresetsFile(data: unknown): RegionBboxPresetsFile {
  if (!data || typeof data !== "object") {
    throw new Error("region-bbox-presets.json 根节点必须是对象");
  }
  const root = data as Record<string, unknown>;
  if (!Array.isArray(root.presets)) {
    throw new Error(
      "region-bbox-presets.json 缺少 presets 数组（正确结构：{ version, presets: [...] }）"
    );
  }
  for (const [i, item] of root.presets.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`presets[${i}] 必须是对象`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id.trim()) {
      throw new Error(`presets[${i}] 缺少字符串字段 id`);
    }
    if (typeof p.label !== "string" || !p.label.trim()) {
      throw new Error(`presets[${i}]（${p.id}）缺少字符串字段 label`);
    }
    const bbox = p.bbox;
    if (!bbox || typeof bbox !== "object") {
      throw new Error(`presets[${i}]（${p.id}）缺少 bbox 对象`);
    }
    const b = bbox as Record<string, unknown>;
    for (const key of ["lonMin", "lonMax", "latMin", "latMax"] as const) {
      const n = Number(b[key]);
      if (!Number.isFinite(n)) {
        throw new Error(
          `presets[${i}]（${p.id}）bbox.${key} 必须是有效数字`
        );
      }
    }
  }
  return {
    version: Number(root.version) || 1,
    presets: root.presets as RegionBboxPreset[],
  };
}

export function loadRegionBboxPresets(): RegionBboxPresetsFile {
  const raw = fs.readFileSync(PRESETS_PATH, "utf-8");
  try {
    return validatePresetsFile(JSON.parse(raw));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(
        `region-bbox-presets.json JSON 语法错误：${e.message}`
      );
    }
    throw e;
  }
}

export function getRegionBboxPreset(id: string): RegionBboxPreset | undefined {
  return loadRegionBboxPresets().presets.find((p) => p.id === id);
}

export function getRegionBboxPresetLabel(id: string): string | undefined {
  return getRegionBboxPreset(id)?.label;
}

/** 解析「仅草坪区域」实际使用的经纬度框；custom 用手动值，否则读配置文件预设 */
export function resolveGrasslandBbox(settings: LuceSettings): RegionBbox {
  const source = settings.grasslandBboxSource ?? "custom";
  if (source === "custom") return settings.grasslandBbox;
  const preset = getRegionBboxPreset(source);
  return preset?.bbox ?? settings.grasslandBbox;
}
