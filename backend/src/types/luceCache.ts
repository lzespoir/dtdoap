import type { DrivePath } from "./luce.js";

/** JSONL 中一行（仅关键列） */
export interface LuceExtractRow {
  lon: number;
  lat: number;
  t: number;
  sp?: number;
  sr?: number;
  lp?: string;
  lr?: string;
  dp?: string;
  dr?: string;
}

export interface LuceManifestFile {
  name: string;
  size: number;
  mtimeMs: number;
  extract: string;
  rows: number;
}

export interface LuceManifest {
  version: 1;
  /** AWK 提取脚本格式版本，变更时自动重新提取 */
  extractVersion?: number;
  files: LuceManifestFile[];
}

export interface LucePathsCache {
  manifestKey: string;
  paths: DrivePath[];
  builtAt: string;
}
