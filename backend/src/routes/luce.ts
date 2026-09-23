import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Router } from "express";
import { batchDir, readMeta } from "../batchStorage.js";
import {
  hasAfterSource,
  loadLuceResult,
  processLuceBatch,
} from "../luceProcessor.js";
import {
  loadLuceSettings,
  saveLuceSettings,
} from "../luceSettings.js";
import type { LuceSettings } from "../types/luce.js";
import type { LuceVariant } from "../luceCache.js";

export const luceRouter = Router({ mergeParams: true });

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/** 生成逐栅格对比 log（见 scripts/grid-cell-compare-log.py） */
luceRouter.get("/debug/grid-compare-log", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  const script = path.join(projectRoot, "scripts", "grid-cell-compare-log.py");
  try {
    await execFileAsync("python3", [script, batchId], {
      cwd: projectRoot,
      timeout: 300_000,
    });
    const logPath = path.join(batchDir(batchId), "grid-compare-debug.log");
    res.json({
      ok: true,
      logPath,
      hint: "查看批次目录下 grid-compare-debug.log；bounds_mismatch=0 表示位置一致",
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "生成对比 log 失败",
    });
  }
});

function parseVariant(v: unknown): LuceVariant {
  return v === "after" ? "after" : "before";
}

luceRouter.get("/settings", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  res.json({ settings: await loadLuceSettings(batchId) });
});

luceRouter.put("/settings", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  const settings = req.body as LuceSettings;
  await saveLuceSettings(batchId, settings);
  res.json({ settings });
});

luceRouter.get("/result", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  const variant = parseVariant(req.query.variant);
  const result = await loadLuceResult(batchId, variant);
  if (!result) {
    res.status(404).json({ error: "尚未处理路测数据" });
    return;
  }
  res.json({ result, variant });
});

luceRouter.get("/after/available", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  res.json({ available: await hasAfterSource(batchId) });
});

luceRouter.post("/process", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  const variant = parseVariant(
    req.body?.variant ?? (req.query.variant as string | undefined)
  );

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const override = req.body?.settings as Partial<LuceSettings> | undefined;
    await processLuceBatch(batchId, override, send, variant);
    res.end();
  } catch (e) {
    send({
      type: "error",
      message: e instanceof Error ? e.message : "路测处理失败",
    });
    res.end();
  }
});
