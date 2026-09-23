import { Router } from "express";
import { readMeta } from "../batchStorage.js";
import {
  computeCompare,
  importAfterFromDir,
  loadSuggestions,
  runOptimizationSuggest,
} from "../optimize.js";
import type { GridMatchMode } from "../types/optimize.js";
import { hasAfterSource, processLuceBatch } from "../luceProcessor.js";

export const optimizeRouter = Router({ mergeParams: true });

optimizeRouter.get("/suggestions", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  const cached = await loadSuggestions(batchId);
  if (cached) {
    res.json({ result: cached, cached: true });
    return;
  }
  try {
    const result = await runOptimizationSuggest(batchId);
    res.json({ result, cached: false });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "建议参数计算失败",
    });
  }
});

optimizeRouter.post("/suggestions", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  try {
    const pcis = Array.isArray(req.body?.pcis)
      ? (req.body.pcis as unknown[])
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n))
      : undefined;
    const result = await runOptimizationSuggest(batchId, {
      pcis,
      force: true,
    });
    res.json({ result, cached: false });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "建议参数计算失败",
    });
  }
});

/** 导入并处理优化后路测数据（SSE，复用 luce 处理流水线） */
optimizeRouter.post("/after/run", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const sourceDir =
      typeof req.body?.sourceDir === "string" && req.body.sourceDir.trim()
        ? (req.body.sourceDir as string)
        : undefined;
    const forceDefaultImport = req.body?.useDefault === true;

    const alreadyHasAfter = await hasAfterSource(batchId);

    if (sourceDir) {
      const { copied, sourceDir: src, targetDir } = await importAfterFromDir(
        batchId,
        sourceDir
      );
      send({ type: "log", message: `导入优化后路测数据：${src}` });
      send({
        type: "log",
        message: `已导入 ${copied} 个新 CSV → ${targetDir}（来源：${src}）`,
      });
    } else if (alreadyHasAfter && !forceDefaultImport) {
      send({
        type: "log",
        message:
          "批次内已有优化后路测 CSV，跳过默认样例目录导入，直接重新处理已上传文件。",
      });
    } else {
      const { copied, sourceDir: src, targetDir } = await importAfterFromDir(
        batchId
      );
      send({ type: "log", message: `导入优化后路测数据：${src}` });
      send({
        type: "log",
        message: `已导入 ${copied} 个新 CSV → ${targetDir}（来源：${src}）`,
      });
    }

    await processLuceBatch(batchId, undefined, send, "after");
    res.end();
  } catch (e) {
    send({
      type: "error",
      message: e instanceof Error ? e.message : "优化后处理失败",
    });
    res.end();
  }
});

optimizeRouter.get("/compare", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  try {
    let pcis: number[] | undefined;
    if (typeof req.query.pcis === "string" && req.query.pcis.trim()) {
      pcis = req.query.pcis
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    }

    const VALID_GRID_MODES: GridMatchMode[] = [
      "default",
      "before",
      "after",
      "intersection",
    ];
    const rawGridMatch = req.query.gridMatch as string | undefined;
    const gridMatch: GridMatchMode =
      rawGridMatch && VALID_GRID_MODES.includes(rawGridMatch as GridMatchMode)
        ? (rawGridMatch as GridMatchMode)
        : "default";

    const result = await computeCompare(batchId, pcis, gridMatch);
    const suggestion = await loadSuggestions(batchId);
    res.json({ result, suggestion });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "对比计算失败",
    });
  }
});
