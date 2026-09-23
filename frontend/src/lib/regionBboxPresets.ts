import presetsFile from "@netopt-config/region-bbox-presets.json";
import type { LuceSettings } from "../types/luce";

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

/** 构建时打包的兜底预设（JSON 损坏或 API 不可用时） */
export const REGION_BBOX_PRESETS: RegionBboxPreset[] = (
  presetsFile as { presets: RegionBboxPreset[] }
).presets;

export async function fetchRegionBboxPresets(): Promise<RegionBboxPreset[]> {
  try {
    const res = await fetch("/api/region-bbox-presets");
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "加载区域预设失败");
    }
    if (!Array.isArray(data.presets)) {
      throw new Error("区域预设响应格式错误");
    }
    return data.presets as RegionBboxPreset[];
  } catch {
    return REGION_BBOX_PRESETS;
  }
}

export function getRegionBboxPreset(
  id: string,
  presets: RegionBboxPreset[] = REGION_BBOX_PRESETS
): RegionBboxPreset | undefined {
  return presets.find((p) => p.id === id);
}

export function resolveGrasslandBbox(
  settings: LuceSettings,
  presets: RegionBboxPreset[] = REGION_BBOX_PRESETS
): RegionBbox {
  const source = settings.grasslandBboxSource ?? "custom";
  if (source === "custom") return settings.grasslandBbox;
  const preset = getRegionBboxPreset(source, presets);
  return preset?.bbox ?? settings.grasslandBbox;
}
