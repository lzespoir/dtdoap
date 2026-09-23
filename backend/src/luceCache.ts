import { createHash } from "node:crypto";
import fs from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { batchDir } from "./batchStorage.js";
import {
  countLines,
  runAwkExtract,
  runAwkFilter,
  runAwkPath,
  type AwkFilterEnv,
} from "./luceShell.js";
import type {
  DrivePath,
  LuceProcessEvent,
  LuceSettings,
  PathPoint,
  RsrpSample,
} from "./types/luce.js";
import type { LuceManifest, LuceManifestFile, LucePathsCache } from "./types/luceCache.js";
import {
  PATH_BUILD_VERSION,
  buildDrivePathSegments,
  countPathPoints,
  flattenSegments,
} from "./pathBuilder.js";
import {
  getRegionBboxPresetLabel,
  resolveGrasslandBbox,
} from "./regionBboxPresets.js";

function sampleInRegion(
  lon: number,
  lat: number,
  settings: LuceSettings
): boolean {
  if (settings.useRegionFilter) {
    const mPerDeg = 111_320;
    const cosLat = Math.cos((settings.regionCenterLat * Math.PI) / 180);
    const dx = (lon - settings.regionCenterLon) * mPerDeg * cosLat;
    const dy = (lat - settings.regionCenterLat) * mPerDeg;
    const r = settings.regionRadiusMeters;
    if (dx * dx + dy * dy > r * r) return false;
  }
  if (settings.useGrasslandFilter) {
    const bb = resolveGrasslandBbox(settings);
    if (lon < bb.lonMin || lon > bb.lonMax) return false;
    if (lat < bb.latMin || lat > bb.latMax) return false;
  }
  return true;
}

export type LuceVariant = "before" | "after";

function variantSuffix(v: LuceVariant): string {
  return v === "after" ? "-after" : "";
}

function sourceSubdir(v: LuceVariant): string {
  return v === "after" ? "luce-after" : "luce";
}

function cacheSubdir(v: LuceVariant): string {
  return `luce-cache${variantSuffix(v)}`;
}

function cacheRoot(batchId: string, variant: LuceVariant): string {
  return path.join(batchDir(batchId), cacheSubdir(variant));
}

function manifestPath(batchId: string, variant: LuceVariant): string {
  return path.join(cacheRoot(batchId, variant), "manifest.json");
}

export function pathsCachePath(batchId: string, variant: LuceVariant): string {
  return path.join(cacheRoot(batchId, variant), "paths.json");
}

function extractsDir(batchId: string, variant: LuceVariant): string {
  return path.join(cacheRoot(batchId, variant), "extracts");
}

export function luceSourceDir(batchId: string, variant: LuceVariant): string {
  return path.join(batchDir(batchId), sourceSubdir(variant));
}

function safeExtractName(csvName: string): string {
  const base = path.basename(csvName, path.extname(csvName));
  const hash = createHash("md5").update(csvName).digest("hex").slice(0, 8);
  const safe = base.replace(/[^\w.\-()+]/g, "_").slice(0, 80);
  return `${safe}_${hash}.tsv`;
}

export function manifestKey(manifest: LuceManifest): string {
  return createHash("sha256")
    .update(
      manifest.files
        .map((f) => `${f.name}|${f.size}|${f.mtimeMs}|${f.rows}`)
        .join("\n")
    )
    .digest("hex");
}

async function loadManifest(
  batchId: string,
  variant: LuceVariant
): Promise<LuceManifest | null> {
  try {
    const raw = await fs.promises.readFile(
      manifestPath(batchId, variant),
      "utf-8"
    );
    return JSON.parse(raw) as LuceManifest;
  } catch {
    return null;
  }
}

async function saveManifest(
  batchId: string,
  variant: LuceVariant,
  manifest: LuceManifest
): Promise<void> {
  await fs.promises.mkdir(cacheRoot(batchId, variant), { recursive: true });
  await fs.promises.writeFile(
    manifestPath(batchId, variant),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
}

export async function loadPathsCache(
  batchId: string,
  variant: LuceVariant
): Promise<LucePathsCache | null> {
  try {
    const raw = await fs.promises.readFile(
      pathsCachePath(batchId, variant),
      "utf-8"
    );
    return JSON.parse(raw) as LucePathsCache;
  } catch {
    return null;
  }
}

async function savePathsCache(
  batchId: string,
  variant: LuceVariant,
  cache: LucePathsCache
): Promise<void> {
  await fs.promises.mkdir(cacheRoot(batchId, variant), { recursive: true });
  await fs.promises.writeFile(
    pathsCachePath(batchId, variant),
    JSON.stringify(cache),
    "utf-8"
  );
}

async function readLonLatFile(filePath: string): Promise<PathPoint[]> {
  const points: PathPoint[] = [];
  const rl = createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const [lonS, latS] = line.split(/\s+/);
    const lon = Number(lonS);
    const lat = Number(latS);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      points.push({ longitude: lon, latitude: lat });
    }
  }
  return points;
}

async function listLuceCsvFiles(
  batchId: string,
  variant: LuceVariant
): Promise<string[]> {
  const dir = luceSourceDir(batchId, variant);
  try {
    const names = await fs.promises.readdir(dir);
    return names
      .filter((n) => n.toLowerCase().endsWith(".csv"))
      .map((n) => path.join(dir, n))
      .sort();
  } catch {
    return [];
  }
}

function entryValid(
  entry: LuceManifestFile,
  stat: fs.Stats,
  extractAbs: string
): boolean {
  return (
    entry.extract.endsWith(".tsv") &&
    entry.size === stat.size &&
    entry.mtimeMs === stat.mtimeMs &&
    fs.existsSync(extractAbs)
  );
}

const EXTRACT_VERSION = 2;

/** awk 提取关键列 → TSV 缓存 */
export async function syncLuceExtracts(
  batchId: string,
  variant: LuceVariant = "before",
  emit?: (e: LuceProcessEvent) => void
): Promise<LuceManifest> {
  const csvFiles = await listLuceCsvFiles(batchId, variant);
  if (csvFiles.length === 0) {
    throw new Error(
      variant === "after"
        ? "尚未导入优化后路测 CSV"
        : "该批次无路测 CSV 文件"
    );
  }

  const prev = await loadManifest(batchId, variant);
  const versionChanged = (prev?.extractVersion ?? 1) !== EXTRACT_VERSION;
  const prevByName = versionChanged
    ? new Map<string, LuceManifestFile>()
    : new Map(prev?.files.map((f) => [f.name, f]) ?? []);
  const extDir = extractsDir(batchId, variant);
  await fs.promises.mkdir(extDir, { recursive: true });

  if (versionChanged) {
    emit?.({
      type: "log",
      message: "TSV 提取格式已升级，重新提取全部文件…",
    });
  }

  const files: LuceManifestFile[] = [];
  let extractCount = 0;

  for (const csvPath of csvFiles) {
    const name = path.basename(csvPath);
    const stat = await fs.promises.stat(csvPath);
    const extractRel = path.relative(
      batchDir(batchId),
      path.join(extDir, safeExtractName(name))
    );
    const extractAbs = path.join(batchDir(batchId), extractRel);
    const prevEntry = prevByName.get(name);

    if (prevEntry && entryValid(prevEntry, stat, extractAbs)) {
      files.push(prevEntry);
      continue;
    }

    extractCount++;
    const fileSize = stat.size;
    emit?.({
      type: "log",
      message: `awk 提取关键列：${name}（${(fileSize / 1024 / 1024).toFixed(1)} MB）`,
    });

    await runAwkExtract(csvPath, extractAbs);
    const rows = await countLines(extractAbs);

    emit?.({
      type: "log",
      message: `${name} 提取完成 → 缓存 ${rows.toLocaleString()} 行`,
    });

    files.push({
      name,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      extract: extractRel,
      rows,
    });
  }

  const manifest: LuceManifest = { version: 1, extractVersion: EXTRACT_VERSION, files };
  await saveManifest(batchId, variant, manifest);

  if (extractCount === 0) {
    emit?.({
      type: "log",
      message: `TSV 缓存有效（${files.length} 个文件），跳过 CSV 读取`,
    });
  } else {
    emit?.({
      type: "log",
      message: `awk 已更新 ${extractCount} 个文件的精简缓存`,
    });
  }

  return manifest;
}

/** sort + awk 按文件生成轨迹（仅缓存失效时重算） */
export async function buildPathsCache(
  batchId: string,
  variant: LuceVariant,
  manifest: LuceManifest,
  emit?: (e: LuceProcessEvent) => void
): Promise<DrivePath[]> {
  const key = manifestKey(manifest);
  const cacheKey = `${key}:${PATH_BUILD_VERSION}`;
  const cached = await loadPathsCache(batchId, variant);
  if (cached && cached.manifestKey === cacheKey) {
    emit?.({
      type: "log",
      message: `轨迹缓存有效（${cached.paths.length} 条），跳过路径重算`,
    });
    return cached.paths;
  }

  emit?.({
    type: "log",
    message:
      "awk 按时间排序提取轨迹点，Node 按距离去重并分段（避免跨场直线）…",
  });

  const tmpDir = path.join(cacheRoot(batchId, variant), "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const paths: DrivePath[] = [];

  for (const f of manifest.files) {
    const tsvAbs = path.join(batchDir(batchId), f.extract);
    const pathTmp = path.join(tmpDir, `${createHash("md5").update(f.name).digest("hex")}.path`);

    await runAwkPath(tsvAbs, pathTmp);
    const rawPoints = await readLonLatFile(pathTmp);
    await fs.promises.unlink(pathTmp).catch(() => {});

    const segments = buildDrivePathSegments(rawPoints);
    const pointCount = countPathPoints(segments);

    if (pointCount > 0) {
      paths.push({
        fileName: f.name,
        points: flattenSegments(segments),
        segments,
      });
    }
    emit?.({
      type: "log",
      message: `${f.name}：轨迹 ${segments.length} 段、${pointCount} 点（原始 ${rawPoints.length}）`,
    });
  }

  await savePathsCache(batchId, variant, {
    manifestKey: cacheKey,
    paths,
    builtAt: new Date().toISOString(),
  });

  return paths;
}

export async function filterSamplesWithAwk(
  batchId: string,
  variant: LuceVariant,
  manifest: LuceManifest,
  settings: LuceSettings,
  emit?: (e: LuceProcessEvent) => void
): Promise<RsrpSample[]> {
  const tmpDir = path.join(cacheRoot(batchId, variant), "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const env: AwkFilterEnv = {
    servingPci: settings.servingPciFilter,
    neighborPci: settings.neighborPciFilter,
    servingPciExclude: settings.servingPciExclude ?? [],
    neighborPciExclude: settings.neighborPciExclude ?? [],
    includeServing: settings.includeServing,
    includeNeighbor: settings.includeNeighbor,
    neighborSource: settings.neighborSource,
    maxSamples: 0,
    useRegionFilter: settings.useRegionFilter,
    regionCenterLon: settings.regionCenterLon,
    regionCenterLat: settings.regionCenterLat,
    regionRadiusMeters: settings.regionRadiusMeters,
    useGrasslandFilter: settings.useGrasslandFilter,
    grasslandBbox: resolveGrasslandBbox(settings),
  };

  const regionParts: string[] = [];
  if (settings.useRegionFilter)
    regionParts.push(`仅中场半径 ${settings.regionRadiusMeters}m`);
  if (settings.useGrasslandFilter) {
    const src = settings.grasslandBboxSource ?? "custom";
    if (src === "custom") {
      regionParts.push("仅草坪区域（自定义）");
    } else {
      const label = getRegionBboxPresetLabel(src) ?? src;
      regionParts.push(`仅草坪区域（${label}）`);
    }
  }

  emit?.({
    type: "log",
    message:
      "awk 从 TSV 缓存过滤 RSRP…" +
      (regionParts.length ? `（${regionParts.join(" + ")}）` : "") +
      (settings.includeNeighbor ? "，含邻区" : "，仅主区"),
  });

  const samples: RsrpSample[] = [];
  let fileIdx = 0;

  for (const f of manifest.files) {
    fileIdx++;
    const tsvAbs = path.join(batchDir(batchId), f.extract);
    const outTmp = path.join(
      tmpDir,
      `samples-${createHash("md5").update(f.name).digest("hex")}.tsv`
    );

    await runAwkFilter(tsvAbs, outTmp, env);

    const rl = createInterface({
      input: fs.createReadStream(outTmp, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      const rsrp = Number(parts[2]);
      const pci = Number(parts[3]);
      const kind = parts[4];
      const sinrRaw = parts[5]?.trim();
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (!sampleInRegion(lon, lat, settings)) continue;
      const sinr = sinrRaw ? Number(sinrRaw) : NaN;
      samples.push({
        longitude: lon,
        latitude: lat,
        rsrp,
        pci,
        kind: kind === "neighbor" ? "neighbor" : "serving",
        sinr: Number.isFinite(sinr) ? sinr : undefined,
      });
      if (env.maxSamples > 0 && samples.length >= env.maxSamples) break;
    }

    await fs.promises.unlink(outTmp).catch(() => {});

    const pct = Math.min(
      99,
      Math.round((fileIdx / manifest.files.length) * 100)
    );
    emit?.({
      type: "progress",
      percent: pct,
      message: `${f.name}：awk 过滤完成（累计 ${samples.length.toLocaleString()} 采样）`,
    });

    if (env.maxSamples > 0 && samples.length >= env.maxSamples) break;
  }

  return samples;
}
