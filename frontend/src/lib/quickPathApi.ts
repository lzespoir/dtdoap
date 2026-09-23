import type { LuceProcessResult, LuceSettings } from "../types/luce";

export interface QuickPreviewBbox {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  centerLon: number;
  centerLat: number;
}

export interface QuickPreviewItem {
  id: string;
  fileName: string;
  bbox: QuickPreviewBbox;
  sampleCount: number;
  pathPointCount: number;
  result: LuceProcessResult;
}

export interface QuickPathPreviewState {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: QuickPreviewItem[];
  settings: LuceSettings | null;
  activeId: string | null;
  metric: "rsrp" | "sinr" | "pci";
  sameRegionOnly: boolean;
  regionRadiusM: number;
}

export function initialQuickPathState(): QuickPathPreviewState {
  return {
    open: false,
    loading: false,
    error: null,
    items: [],
    settings: null,
    activeId: null,
    metric: "rsrp",
    sameRegionOnly: false,
    regionRadiusM: 300,
  };
}

export async function fetchQuickPathPreview(
  files: File[],
  batchId?: string | null,
  options?: { fullSamples?: boolean; shapeSnapPreview?: boolean }
): Promise<{
  items: QuickPreviewItem[];
  settings: LuceSettings;
  errors?: string[];
}> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  if (batchId) form.append("batchId", batchId);
  if (options?.fullSamples) form.append("fullSamples", "1");
  if (options?.shapeSnapPreview) form.append("shapeSnapPreview", "1");

  const res = await fetch("/api/tools/quick-path-preview", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "快速预览失败");
  }
  return data;
}

export function distanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mPerDegLat * cosLat;
  const dy = (lat2 - lat1) * mPerDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}

export function filterItemsByRegion(
  items: QuickPreviewItem[],
  anchor: QuickPreviewItem | null,
  radiusM: number
): QuickPreviewItem[] {
  if (!anchor) return items;
  const { centerLon, centerLat } = anchor.bbox;
  return items.filter(
    (item) =>
      distanceMeters(
        centerLon,
        centerLat,
        item.bbox.centerLon,
        item.bbox.centerLat
      ) <= radiusM
  );
}
