import fs from "node:fs/promises";
import { Router } from "express";
import {
  createBatch,
  deleteBatch,
  listBatches,
  readMeta,
  saveBatchFile,
  updateBatchAlias,
  type FileCategory,
} from "../batchStorage.js";
import { loadCells } from "../cellStorage.js";
import { decodeUploadFilename } from "../filename.js";
import { saveCells } from "../cellStorage.js";
import { parseGongcanBatch } from "../gongcanParser.js";
import { seedRegionFromCellsIfNeeded } from "../luceSettings.js";
import {
  upload,
  validateExtension,
  multerErrorMessage,
} from "../upload.js";
import type { RequestHandler } from "express";
import multer from "multer";
import { luceRouter } from "./luce.js";
import { luceAnalysisRouter } from "./luceAnalysis.js";
import { optimizeRouter } from "./optimize.js";
import { luceSourceDir } from "../luceCache.js";
import {
  getLuceDefaultSources,
  importLuceFromDir,
} from "../luceSampleDirs.js";
import type { LuceVariant } from "../luceCache.js";

const uploadFields: RequestHandler = (req, res, next) => {
  upload.fields([
    { name: "gongcan", maxCount: 20 },
    { name: "luce", maxCount: 20 },
    { name: "luceAfter", maxCount: 20 },
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      res.status(413).json({ error: multerErrorMessage(err) });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
};

export const batchesRouter = Router();

async function countLuceCsvInBatch(
  batchId: string,
  variant: LuceVariant
): Promise<number> {
  try {
    const names = await fs.readdir(luceSourceDir(batchId, variant));
    return names.filter((n) => n.toLowerCase().endsWith(".csv")).length;
  } catch {
    return 0;
  }
}

batchesRouter.get("/luce-default-sources", async (_req, res) => {
  try {
    const sources = await getLuceDefaultSources();
    res.json(sources);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "读取默认路测目录失败",
    });
  }
});

batchesRouter.get("/", async (_req, res) => {
  const batches = await listBatches();
  const summaries = await Promise.all(
    batches.map(async (b) => {
      const gongcan = b.files.filter((f) => f.category === "gongcan");
      const luce = b.files.filter((f) => f.category === "luce");
      const luceAfterMeta = b.files.filter((f) => f.category === "luce-after");
      const cached = await loadCells(b.id);
      const [luceCsvCount, luceAfterCsvCount] = await Promise.all([
        countLuceCsvInBatch(b.id, "before"),
        countLuceCsvInBatch(b.id, "after"),
      ]);
      return {
        ...b,
        gongcanNames: gongcan.map((f) => decodeUploadFilename(f.name)),
        luceCount: Math.max(luce.length, luceCsvCount),
        luceAfterCount: Math.max(luceAfterMeta.length, luceAfterCsvCount),
        cellsCount: cached?.length ?? null,
      };
    })
  );
  res.json({ batches: summaries });
});

batchesRouter.delete("/:batchId", async (req, res) => {
  const ok = await deleteBatch(req.params.batchId);
  if (!ok) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  res.json({ ok: true });
});

batchesRouter.post("/", async (req, res) => {
  const alias = typeof req.body?.alias === "string" ? req.body.alias : undefined;
  const batch = await createBatch(alias);
  res.status(201).json({ batch });
});

batchesRouter.get("/:batchId", async (req, res) => {
  const meta = await readMeta(req.params.batchId);
  if (!meta) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json({ batch: meta });
});

batchesRouter.patch("/:batchId", async (req, res) => {
  const { alias } = req.body ?? {};
  if (typeof alias !== "string") {
    res.status(400).json({ error: "alias 必须为字符串" });
    return;
  }
  const batch = await updateBatchAlias(req.params.batchId, alias);
  if (!batch) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }
  res.json({ batch });
});

batchesRouter.post("/:batchId/import-luce", async (req, res) => {
  const { batchId } = req.params;
  if (!(await readMeta(batchId))) {
    res.status(404).json({ error: "批次不存在" });
    return;
  }

  const variant: LuceVariant =
    req.body?.variant === "after" ? "after" : "before";
  const useDefault = req.body?.useDefault !== false;
  const sourceDir =
    typeof req.body?.sourceDir === "string" ? req.body.sourceDir : undefined;

  try {
    const result = useDefault
      ? await importLuceFromDir(batchId, variant)
      : await importLuceFromDir(batchId, variant, sourceDir);
    res.json(result);
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "导入路测数据失败",
    });
  }
});

batchesRouter.post("/:batchId/upload", uploadFields, async (req, res) => {
    const { batchId } = req.params;
    const meta = await readMeta(batchId);
    if (!meta) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    const saved: Awaited<ReturnType<typeof saveBatchFile>>[] = [];
    const errors: string[] = [];

    const uploaded = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;

    const fieldCategory = (field: string): FileCategory | null => {
      if (field === "gongcan") return "gongcan";
      if (field === "luce") return "luce";
      if (field === "luceAfter") return "luce-after";
      return null;
    };

    const groups: { field: string; files: Express.Multer.File[] }[] = [
      { field: "gongcan", files: uploaded?.gongcan ?? [] },
      { field: "luce", files: uploaded?.luce ?? [] },
      { field: "luceAfter", files: uploaded?.luceAfter ?? [] },
    ];

    for (const { field, files } of groups) {
      const category = fieldCategory(field);
      if (!category) continue;
      for (const file of files) {
        if (!validateExtension(file.originalname, category)) {
          const label =
            category === "gongcan"
              ? "工参"
              : category === "luce-after"
                ? "优化后路测"
                : "优化前路测";
          errors.push(
            `${file.originalname}: invalid extension for ${label}`
          );
          continue;
        }
        const info = await saveBatchFile(
          batchId,
          category,
          file.originalname,
          file.buffer
        );
        saved.push(info);
      }
    }

    if (saved.length === 0 && errors.length > 0) {
      res.status(400).json({ error: "No files saved", details: errors });
      return;
    }

    let cellsCount = 0;
    const hasGongcan = (await readMeta(batchId))?.files.some(
      (f) => f.category === "gongcan"
    );
    if (hasGongcan) {
      const cells = await parseGongcanBatch(batchId);
      await saveCells(batchId, cells);
      cellsCount = cells.length;
      await seedRegionFromCellsIfNeeded(batchId, cells);
    }

    const batch = await readMeta(batchId);
    res.json({
      batch,
      saved,
      cellsCount,
      errors: errors.length ? errors : undefined,
    });
  }
);

batchesRouter.use("/:batchId/luce", luceRouter);
batchesRouter.use("/:batchId/luce/analysis", luceAnalysisRouter);
batchesRouter.use("/:batchId/optimize", optimizeRouter);

batchesRouter.get("/:batchId/cells", async (req, res) => {
  const { batchId } = req.params;
  const meta = await readMeta(batchId);
  if (!meta) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const cells = await parseGongcanBatch(batchId);
  await saveCells(batchId, cells);

  res.json({ cells, count: cells.length });
});
