import type { CellSite } from "../types/cell";

export interface BatchFileInfo {
  name: string;
  category: "gongcan" | "luce" | "luce-after";
  size: number;
  savedAt: string;
}

export interface LuceSampleDirInfo {
  variant: "before" | "after";
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  csvCount: number;
  empty: boolean;
}

export interface LuceDefaultSources {
  before: LuceSampleDirInfo;
  after: LuceSampleDirInfo;
}

export interface BatchMeta {
  id: string;
  alias?: string;
  createdAt: string;
  files: BatchFileInfo[];
}

export interface BatchSummary extends BatchMeta {
  gongcanNames: string[];
  luceCount: number;
  luceAfterCount: number;
  cellsCount: number | null;
}

export async function fetchLuceDefaultSources(): Promise<LuceDefaultSources> {
  const res = await fetch("/api/batches/luce-default-sources");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "读取默认路测目录失败");
  return data;
}

export async function importLuceFromDefault(
  batchId: string,
  variant: "before" | "after"
): Promise<{
  copied: number;
  total: number;
  sourceDir: string;
  targetDir: string;
}> {
  const res = await fetch(`/api/batches/${batchId}/import-luce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant, useDefault: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "导入路测数据失败");
  return data;
}

export async function listBatches(): Promise<BatchSummary[]> {
  const res = await fetch("/api/batches");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "加载批次列表失败");
  return data.batches;
}

export async function createBatch(alias?: string): Promise<BatchMeta> {
  const res = await fetch("/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias }),
  });
  if (!res.ok) throw new Error("创建批次失败");
  const data = (await res.json()) as { batch: BatchMeta };
  return data.batch;
}

export async function updateBatchAlias(
  batchId: string,
  alias: string
): Promise<BatchMeta> {
  const res = await fetch(`/api/batches/${batchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias }),
  });
  if (!res.ok) throw new Error("更新别名失败");
  const data = (await res.json()) as { batch: BatchMeta };
  return data.batch;
}

export async function deleteBatch(batchId: string): Promise<void> {
  const res = await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "删除批次失败");
}

export async function uploadBatchFiles(
  batchId: string,
  gongcan: File[],
  luceBefore: File[],
  luceAfter: File[] = []
): Promise<{
  batch: BatchMeta;
  saved: BatchFileInfo[];
  cellsCount?: number;
  errors?: string[];
}> {
  const form = new FormData();
  gongcan.forEach((f) => form.append("gongcan", f));
  luceBefore.forEach((f) => form.append("luce", f));
  luceAfter.forEach((f) => form.append("luceAfter", f));

  const res = await fetch(`/api/batches/${batchId}/upload`, {
    method: "POST",
    body: form,
  });

  let data: {
    error?: string;
    batch?: BatchMeta;
    saved?: BatchFileInfo[];
    cellsCount?: number;
    errors?: string[];
  };
  try {
    data = await res.json();
  } catch {
    throw new Error(
      res.status === 413 ? "文件过大，请压缩或拆分后重试" : "上传失败"
    );
  }
  if (!res.ok) {
    throw new Error(data.error ?? "上传失败");
  }
  if (!data.batch || !data.saved) {
    throw new Error("上传响应格式异常");
  }
  return {
    batch: data.batch,
    saved: data.saved,
    cellsCount: data.cellsCount,
    errors: data.errors,
  };
}

export async function fetchBatchCells(
  batchId: string
): Promise<{ cells: CellSite[]; count: number }> {
  const res = await fetch(`/api/batches/${batchId}/cells`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "加载小区数据失败");
  }
  return data;
}
