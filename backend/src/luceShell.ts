import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

export async function runAwkExtract(
  csvPath: string,
  outTsv: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outTsv), { recursive: true });
  const awk = path.join(SCRIPTS_DIR, "luce-extract.awk");
  const cmd = `awk -f ${shellQuote(awk)} ${shellQuote(csvPath)} > ${shellQuote(outTsv)}`;
  await execFileAsync("bash", ["-c", cmd], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

export async function runAwkPath(
  tsvPath: string,
  outLonLat: string
): Promise<void> {
  const pathAwk = path.join(SCRIPTS_DIR, "luce-path.awk");
  const cmd = `sort -t$'\\t' -k3,3 ${shellQuote(tsvPath)} | awk -f ${shellQuote(pathAwk)} > ${shellQuote(outLonLat)}`;
  await execFileAsync("bash", ["-c", cmd], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

export interface AwkFilterEnv {
  servingPci: number[];
  neighborPci: number[];
  servingPciExclude: number[];
  neighborPciExclude: number[];
  includeServing: boolean;
  includeNeighbor: boolean;
  neighborSource: string;
  maxSamples: number;
  useRegionFilter: boolean;
  regionCenterLon: number;
  regionCenterLat: number;
  regionRadiusMeters: number;
  useGrasslandFilter: boolean;
  grasslandBbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
}

export async function runAwkFilter(
  tsvPath: string,
  outSamples: string,
  env: AwkFilterEnv
): Promise<void> {
  const filterAwk = path.join(SCRIPTS_DIR, "luce-filter.awk");
  const awkEnv = {
    ...process.env,
    LUCE_SERVING_PCI: env.servingPci.join(","),
    LUCE_NEIGHBOR_PCI: env.neighborPci.join(","),
    LUCE_SERVING_PCI_EXCLUDE: env.servingPciExclude.join(","),
    LUCE_NEIGHBOR_PCI_EXCLUDE: env.neighborPciExclude.join(","),
    LUCE_INCLUDE_SERVING: env.includeServing ? "1" : "0",
    LUCE_INCLUDE_NEIGHBOR: env.includeNeighbor ? "1" : "0",
    LUCE_NEIGHBOR_SOURCE: env.neighborSource,
    LUCE_MAX_SAMPLES: String(env.maxSamples),
    LUCE_USE_REGION: env.useRegionFilter ? "1" : "0",
    LUCE_CENTER_LON: String(env.regionCenterLon),
    LUCE_CENTER_LAT: String(env.regionCenterLat),
    LUCE_RADIUS_M: String(env.regionRadiusMeters),
    LUCE_USE_GRASSLAND: env.useGrasslandFilter ? "1" : "0",
    LUCE_GRASS_LON_MIN: String(env.grasslandBbox.lonMin),
    LUCE_GRASS_LON_MAX: String(env.grasslandBbox.lonMax),
    LUCE_GRASS_LAT_MIN: String(env.grasslandBbox.latMin),
    LUCE_GRASS_LAT_MAX: String(env.grasslandBbox.latMax),
  };
  const cmd = `awk -f ${shellQuote(filterAwk)} ${shellQuote(tsvPath)} > ${shellQuote(outSamples)}`;
  await execFileAsync("bash", ["-c", cmd], {
    env: awkEnv,
    maxBuffer: 128 * 1024 * 1024,
  });
}

export async function countLines(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("wc", ["-l", filePath], {
    maxBuffer: 1024 * 1024,
  });
  const n = parseInt(stdout.trim().split(/\s+/)[0], 10);
  return Number.isFinite(n) ? n : 0;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
