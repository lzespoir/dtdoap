import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { batchDir } from "./batchStorage.js";
import { decodeUploadFilename } from "./filename.js";
import {
  buildPathsCache,
  filterSamplesWithAwk,
  syncLuceExtracts,
} from "./luceCache.js";
import { buildLuceGridFromSamples } from "./luceProcessor.js";
import { loadLuceSettings } from "./luceSettings.js";
import type { DrivePath, LuceProcessResult, LuceSettings, RsrpSample } from "./types/luce.js";
import { DEFAULT_LUCE_SETTINGS } from "./types/luce.js";

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

export function quickPreviewSettings(
  base?: Partial<LuceSettings>
): LuceSettings {
  return {
    ...DEFAULT_LUCE_SETTINGS,
    ...base,
    useRegionFilter: false,
    useGrasslandFilter: false,
    showDrivePath: true,
    displayMode: "grid",
    useGrid: true,
    includeServing: true,
    includeNeighbor: false,
    servingPciFilter: [],
    neighborPciFilter: [],
    servingPciExclude: [],
    neighborPciExclude: [],
  };
}

function bboxFrom(
  samples: RsrpSample[],
  paths: DrivePath[]
): QuickPreviewBbox {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;

  const visit = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    lonMin = Math.min(lonMin, lon);
    lonMax = Math.max(lonMax, lon);
    latMin = Math.min(latMin, lat);
    latMax = Math.max(latMax, lat);
  };

  for (const s of samples) visit(s.longitude, s.latitude);
  for (const p of paths) {
    for (const pt of p.points) visit(pt.longitude, pt.latitude);
  }

  if (!Number.isFinite(lonMin)) {
    return {
      lonMin: 0,
      lonMax: 0,
      latMin: 0,
      latMax: 0,
      centerLon: 0,
      centerLat: 0,
    };
  }

  return {
    lonMin,
    lonMax,
    latMin,
    latMax,
    centerLon: (lonMin + lonMax) / 2,
    centerLat: (latMin + latMax) / 2,
  };
}

function slimSamplesForFullPreview(samples: RsrpSample[]): RsrpSample[] {
  return samples.map((s) => ({
    longitude: s.longitude,
    latitude: s.latitude,
    rsrp: s.rsrp,
    pci: s.pci,
    kind: s.kind,
    ...(s.time ? { time: s.time } : {}),
  }));
}

async function processOneUploadedCsv(
  originalName: string,
  buffer: Buffer,
  settings: LuceSettings,
  fullSamples: boolean,
  shapeSnapPreview: boolean
): Promise<QuickPreviewItem> {
  const batchId = `_quick_${randomUUID()}`;
  const root = batchDir(batchId);
  const luceDir = path.join(root, "luce");
  const safeName = decodeUploadFilename(originalName);
  const csvPath = path.join(luceDir, safeName);

  try {
    await fs.mkdir(luceDir, { recursive: true });
    await fs.writeFile(csvPath, buffer);

    const manifest = await syncLuceExtracts(batchId, "before");
    const paths = await buildPathsCache(batchId, "before", manifest);
    const samples = await filterSamplesWithAwk(
      batchId,
      "before",
      manifest,
      settings
    );
    const pathPointCount = paths.reduce((n, p) => n + p.points.length, 0);
    const servingOnly = samples.filter((s) => s.kind === "serving");
    let outputSamples: RsrpSample[];
    if (shapeSnapPreview) {
      const maxDisplay = 2500;
      const step = Math.max(1, Math.ceil(servingOnly.length / maxDisplay));
      outputSamples = servingOnly.filter(
        (_, i) => i % step === 0 || i === servingOnly.length - 1
      );
    } else if (fullSamples) {
      outputSamples = slimSamplesForFullPreview(samples);
    } else {
      outputSamples =
        settings.displayMode !== "points"
          ? samples.slice(0, Math.min(samples.length, 5_000))
          : samples;
    }

    const result: LuceProcessResult = {
      paths: shapeSnapPreview ? [] : paths,
      samples: outputSamples,
      grid:
        fullSamples || shapeSnapPreview
          ? undefined
          : buildLuceGridFromSamples(samples, settings),
      stats: {
        totalRows: manifest.files.reduce((n, f) => n + f.rows, 0),
        skippedNoLocation: 0,
        skippedEmptyRsrp: 0,
        servingSamples: samples.filter((s) => s.kind === "serving").length,
        neighborSamples: samples.filter((s) => s.kind === "neighbor").length,
        outputSamples: shapeSnapPreview
          ? servingOnly.length
          : samples.length,
        pathSegments: paths.length,
        pathPoints: pathPointCount,
      },
      processedAt: new Date().toISOString(),
      settings,
    };

    return {
      id: randomUUID(),
      fileName: safeName,
      bbox: bboxFrom(samples, paths),
      sampleCount: samples.length,
      pathPointCount,
      result,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export async function processQuickPathFiles(
  files: { originalname: string; buffer: Buffer }[],
  batchId?: string | null,
  fullSamples = false,
  shapeSnapPreview = false
): Promise<{ items: QuickPreviewItem[]; settings: LuceSettings }> {
  const base =
    batchId != null ? await loadLuceSettings(batchId) : DEFAULT_LUCE_SETTINGS;
  const settings = quickPreviewSettings(
    fullSamples || shapeSnapPreview
      ? { ...base, displayMode: "points" }
      : base
  );

  const items: QuickPreviewItem[] = [];
  for (const file of files) {
    items.push(
      await processOneUploadedCsv(
        file.originalname,
        file.buffer,
        settings,
        fullSamples,
        shapeSnapPreview
      )
    );
  }

  items.sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-CN"));
  return { items, settings };
}
