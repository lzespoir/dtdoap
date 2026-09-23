import fs from "node:fs";
import path from "node:path";
import type { LuceVariant } from "./luceCache.js";
import { luceSourceDir } from "./luceCache.js";
import {
  DEFAULT_LUCE_AFTER_SAMPLE_REL,
  DEFAULT_LUCE_BEFORE_SAMPLE_REL,
  PROJECT_ROOT,
} from "./config.js";

export interface LuceSampleDirInfo {
  variant: LuceVariant;
  /** 相对项目根目录，便于配置与日志 */
  relativePath: string;
  /** 解析后的绝对路径，仅用于界面提示 */
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  csvCount: number;
  empty: boolean;
}

function resolveDefaultDir(
  variant: LuceVariant,
  envOverride?: string
): { absolutePath: string; relativePath: string } {
  if (envOverride?.trim()) {
    const raw = envOverride.trim();
    const absolutePath = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(PROJECT_ROOT, raw);
    const relativePath = path.relative(PROJECT_ROOT, absolutePath) || raw;
    return { absolutePath, relativePath };
  }

  const relativePath =
    variant === "after"
      ? DEFAULT_LUCE_AFTER_SAMPLE_REL
      : DEFAULT_LUCE_BEFORE_SAMPLE_REL;
  return {
    relativePath,
    absolutePath: path.resolve(PROJECT_ROOT, relativePath),
  };
}

export function defaultLuceSampleDir(variant: LuceVariant): {
  absolutePath: string;
  relativePath: string;
} {
  const env =
    variant === "after"
      ? process.env.LUCE_AFTER_DEFAULT_DIR
      : process.env.LUCE_BEFORE_DEFAULT_DIR;
  return resolveDefaultDir(variant, env);
}

export async function collectCsvFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

export async function inspectLuceSampleDir(
  variant: LuceVariant
): Promise<LuceSampleDirInfo> {
  const { absolutePath, relativePath } = defaultLuceSampleDir(variant);
  let exists = false;
  let isDirectory = false;
  let csvCount = 0;

  try {
    const st = await fs.promises.stat(absolutePath);
    exists = true;
    isDirectory = st.isDirectory();
    if (isDirectory) {
      csvCount = (await collectCsvFiles(absolutePath)).length;
    }
  } catch {
    exists = false;
  }

  return {
    variant,
    relativePath,
    absolutePath,
    exists,
    isDirectory,
    csvCount,
    empty: !exists || !isDirectory || csvCount === 0,
  };
}

export async function getLuceDefaultSources(): Promise<{
  before: LuceSampleDirInfo;
  after: LuceSampleDirInfo;
}> {
  const [before, after] = await Promise.all([
    inspectLuceSampleDir("before"),
    inspectLuceSampleDir("after"),
  ]);
  return { before, after };
}

/** 把外部目录里的 csv（含子目录）拷贝进 batch/luce 或 luce-after */
export async function importLuceFromDir(
  batchId: string,
  variant: LuceVariant,
  sourceDir?: string
): Promise<{
  copied: number;
  total: number;
  sourceDir: string;
  targetDir: string;
}> {
  const resolved = sourceDir?.trim()
    ? path.isAbsolute(sourceDir.trim())
      ? path.resolve(sourceDir.trim())
      : path.resolve(PROJECT_ROOT, sourceDir.trim())
    : defaultLuceSampleDir(variant).absolutePath;

  const target = luceSourceDir(batchId, variant);
  await fs.promises.mkdir(target, { recursive: true });

  let srcStat: fs.Stats;
  try {
    srcStat = await fs.promises.stat(resolved);
  } catch (e) {
    throw new Error(
      `读取${variant === "after" ? "优化后" : "优化前"}数据源失败：${resolved}（${e instanceof Error ? e.message : String(e)}）`
    );
  }
  if (!srcStat.isDirectory()) {
    throw new Error(`源路径不是目录：${resolved}`);
  }

  const csvAbsPaths = await collectCsvFiles(resolved);
  if (csvAbsPaths.length === 0) {
    throw new Error(`目录中没有 csv 文件：${resolved}`);
  }

  let copied = 0;
  const usedNames = new Set<string>();
  for (const src of csvAbsPaths) {
    const rel = path.relative(resolved, src);
    let safeName = rel.replace(/[\\/]+/g, "__");
    if (usedNames.has(safeName)) {
      const ext = path.extname(safeName);
      const base = safeName.slice(0, safeName.length - ext.length);
      let i = 1;
      while (usedNames.has(`${base}_${i}${ext}`)) i++;
      safeName = `${base}_${i}${ext}`;
    }
    usedNames.add(safeName);
    const dst = path.join(target, safeName);
    const stat = await fs.promises.stat(src);
    let needCopy = true;
    try {
      const dstStat = await fs.promises.stat(dst);
      if (
        dstStat.size === stat.size &&
        Math.abs(dstStat.mtimeMs - stat.mtimeMs) < 2_000
      ) {
        needCopy = false;
      }
    } catch {
      needCopy = true;
    }
    if (needCopy) {
      await fs.promises.copyFile(src, dst);
      copied++;
    }
  }
  return {
    copied,
    total: csvAbsPaths.length,
    sourceDir: resolved,
    targetDir: target,
  };
}
