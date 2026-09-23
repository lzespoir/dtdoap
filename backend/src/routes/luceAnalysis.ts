import { Router } from "express";
import { readMeta } from "../batchStorage.js";
import type { LuceVariant } from "../luceCache.js";
import {
  runGridCellSamples,
  runGridSpreadMapAnalysis,
} from "../luceAnalysis.js";

export const luceAnalysisRouter = Router({ mergeParams: true });

function parseVariant(v: unknown): LuceVariant | "both" {
  if (v === "after") return "after";
  if (v === "both") return "both";
  return "before";
}

function parseGridSizeM(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 200) return undefined;
  return n;
}

async function runForVariant(
  batchId: string,
  variant: LuceVariant,
  gridSizeM?: number
) {
  return runGridSpreadMapAnalysis(batchId, variant, gridSizeM);
}

function parseGridIndex(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isInteger(n)) return undefined;
  return n;
}

luceAnalysisRouter.get("/spatial-rsrp/cell", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  const variant = parseVariant(req.query.variant);
  if (variant === "both") {
    res.status(400).json({ error: "请指定 variant=before 或 after" });
    return;
  }

  const gx = parseGridIndex(req.query.gx);
  const gy = parseGridIndex(req.query.gy);
  if (gx === undefined || gy === undefined) {
    res.status(400).json({ error: "缺少 gx / gy" });
    return;
  }

  const gridSizeM = parseGridSizeM(req.query.gridSizeM);

  try {
    const result = await runGridCellSamples(
      batchId,
      variant,
      gx,
      gy,
      gridSizeM
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "栅格采样点查询失败";
    const status = msg.includes("尚未处理") ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

luceAnalysisRouter.get("/spatial-rsrp", async (req, res) => {
  const batchId = (req.params as { batchId: string }).batchId;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  const variant = parseVariant(req.query.variant);
  const gridSizeM = parseGridSizeM(req.query.gridSizeM);

  try {
    if (variant === "both") {
      const [before, after] = await Promise.all([
        runForVariant(batchId, "before", gridSizeM),
        runForVariant(batchId, "after", gridSizeM),
      ]);
      res.json({ before, after });
      return;
    }
    const result = await runForVariant(batchId, variant, gridSizeM);
    res.json({ result, variant });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "分析失败";
    const status = msg.includes("尚未处理") ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});
