import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { BATCHES_DIR } from "./config.js";
import { decodeUploadFilename } from "./filename.js";

export type FileCategory = "gongcan" | "luce" | "luce-after";

export interface BatchFileInfo {
  name: string;
  category: FileCategory;
  size: number;
  savedAt: string;
}

export interface BatchMeta {
  id: string;
  alias?: string;
  createdAt: string;
  files: BatchFileInfo[];
}

export function batchDir(batchId: string): string {
  return path.join(BATCHES_DIR, batchId);
}

export function categoryDir(batchId: string, category: FileCategory): string {
  const sub =
    category === "luce-after"
      ? "luce-after"
      : category === "luce"
        ? "luce"
        : "gongcan";
  return path.join(batchDir(batchId), sub);
}

export async function ensureBatchesRoot(): Promise<void> {
  await fs.mkdir(BATCHES_DIR, { recursive: true });
}

export async function createBatch(alias?: string): Promise<BatchMeta> {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  await fs.mkdir(categoryDir(id, "gongcan"), { recursive: true });
  await fs.mkdir(categoryDir(id, "luce"), { recursive: true });
  await fs.mkdir(categoryDir(id, "luce-after"), { recursive: true });
  const meta: BatchMeta = { id, createdAt, files: [] };
  if (alias?.trim()) meta.alias = alias.trim();
  await writeMeta(meta);
  return meta;
}

function metaPath(batchId: string): string {
  return path.join(batchDir(batchId), "meta.json");
}

export async function readMeta(batchId: string): Promise<BatchMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(batchId), "utf-8");
    return JSON.parse(raw) as BatchMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: BatchMeta): Promise<void> {
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), "utf-8");
}

export async function saveBatchFile(
  batchId: string,
  category: FileCategory,
  originalName: string,
  buffer: Buffer
): Promise<BatchFileInfo> {
  const meta = await readMeta(batchId);
  if (!meta) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  const safeName = path.basename(decodeUploadFilename(originalName));
  const dest = path.join(categoryDir(batchId, category), safeName);
  await fs.writeFile(dest, buffer);

  const info: BatchFileInfo = {
    name: safeName,
    category,
    size: buffer.length,
    savedAt: new Date().toISOString(),
  };

  const existing = meta.files.findIndex(
    (f) => f.category === category && f.name === safeName
  );
  if (existing >= 0) {
    meta.files[existing] = info;
  } else {
    meta.files.push(info);
  }

  await writeMeta(meta);
  return info;
}

export async function listBatches(): Promise<BatchMeta[]> {
  await ensureBatchesRoot();
  const entries = await fs.readdir(BATCHES_DIR, { withFileTypes: true });
  const metas: BatchMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readMeta(entry.name);
    if (meta) metas.push(meta);
  }
  return metas.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function updateBatchAlias(
  batchId: string,
  alias: string
): Promise<BatchMeta | null> {
  const meta = await readMeta(batchId);
  if (!meta) return null;
  meta.alias = alias.trim() || undefined;
  await writeMeta(meta);
  return meta;
}

export async function deleteBatch(batchId: string): Promise<boolean> {
  const meta = await readMeta(batchId);
  if (!meta) return false;
  await fs.rm(batchDir(batchId), { recursive: true, force: true });
  return true;
}
