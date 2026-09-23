import { Router } from "express";
import multer from "multer";
import { upload, multerErrorMessage, validateExtension } from "../upload.js";
import { processQuickPathFiles } from "../quickPathPreview.js";
import { decodeUploadFilename } from "../filename.js";
import { applyCorrectionToCsv } from "../pathAdjustExport.js";
import { computeShapeSnapApply } from "../pathShapeSnapCompute.js";
import type { ShapeSnapApplyRequest } from "../types/pathShapeSnap.js";
import type {
  ExportDebugReport,
  FilePathCorrection,
} from "../types/pathAdjustExport.js";

export const toolsRouter = Router();

const previewUpload = upload.array("files", 50);

toolsRouter.post("/quick-path-preview", (req, res, next) => {
  previewUpload(req, res, (err) => {
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
}, async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) {
    res.status(400).json({ error: "请上传至少一个路测 CSV 文件" });
    return;
  }

  const batchId =
    typeof req.body?.batchId === "string" && req.body.batchId.trim()
      ? req.body.batchId.trim()
      : null;

  const errors: string[] = [];
  const valid: Express.Multer.File[] = [];
  for (const f of files) {
    const name = decodeUploadFilename(f.originalname);
    if (!validateExtension(name, "luce")) {
      errors.push(`跳过非 CSV：${name}`);
      continue;
    }
    valid.push(f);
  }

  if (valid.length === 0) {
    res.status(400).json({
      error: errors.join("；") || "没有有效的路测 CSV",
    });
    return;
  }

  const fullSamples =
    req.body?.fullSamples === "1" ||
    req.body?.fullSamples === true ||
    req.body?.fullSamples === "true";
  const shapeSnapPreview =
    req.body?.shapeSnapPreview === "1" ||
    req.body?.shapeSnapPreview === true ||
    req.body?.shapeSnapPreview === "true";

  try {
    const { items, settings } = await processQuickPathFiles(
      valid,
      batchId,
      fullSamples,
      shapeSnapPreview
    );
    res.json({
      items,
      settings,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "快速预览处理失败",
    });
  }
});

const shapeSnapUpload = upload.fields([{ name: "file", maxCount: 1 }]);

toolsRouter.post("/path-shape-snap/apply", (req, res, next) => {
  shapeSnapUpload(req, res, (err) => {
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
}, async (req, res) => {
  const files = req.files as { file?: Express.Multer.File[] } | undefined;
  const uploaded = files?.file?.[0];
  if (!uploaded) {
    res.status(400).json({ error: "请上传原始路测 CSV 文件" });
    return;
  }

  let config: ShapeSnapApplyRequest;
  try {
    const raw = req.body?.config;
    config =
      typeof raw === "string"
        ? (JSON.parse(raw) as ShapeSnapApplyRequest)
        : (raw as ShapeSnapApplyRequest);
  } catch {
    res.status(400).json({ error: "config 格式无效" });
    return;
  }

  if (!config?.layerId || !config?.fileName || !config?.shapes?.length) {
    res.status(400).json({ error: "缺少 layerId、fileName 或 shapes" });
    return;
  }

  try {
    const result = computeShapeSnapApply(uploaded.buffer, {
      ...config,
      fileName: decodeUploadFilename(uploaded.originalname),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "形状附着计算失败",
    });
  }
});

const exportUpload = upload.array("files", 50);

toolsRouter.post("/path-adjust/export", (req, res, next) => {
  exportUpload(req, res, (err) => {
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
}, async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  let corrections: FilePathCorrection[] = [];
  try {
    const raw = req.body?.corrections;
    if (typeof raw === "string") {
      corrections = JSON.parse(raw) as FilePathCorrection[];
    } else if (Array.isArray(raw)) {
      corrections = raw as FilePathCorrection[];
    }
  } catch {
    res.status(400).json({ error: "corrections 格式无效" });
    return;
  }
  if (!files?.length) {
    res.status(400).json({ error: "请上传原始 CSV 文件" });
    return;
  }

  const corrByName = new Map(
    corrections.map((c) => [c.fileName, c])
  );
  const outputs: { fileName: string; buffer: Buffer }[] = [];
  const errors: string[] = [];
  const debugReports: ExportDebugReport[] = [];

  for (const f of files) {
    const name = decodeUploadFilename(f.originalname);
    const corr = corrByName.get(name);
    if (!corr) {
      errors.push(`未找到校正参数：${name}`);
      continue;
    }
    try {
      const { buffer, debug } = await applyCorrectionToCsv(f.buffer, corr);
      outputs.push({ fileName: name, buffer });
      debugReports.push(debug);
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : `${name} 导出失败`
      );
    }
  }

  if (outputs.length === 0) {
    res.status(400).json({
      error: errors.join("；") || "没有可导出的文件",
    });
    return;
  }

  res.json({
    files: outputs.map((o) => ({
      fileName: o.fileName,
      csvBase64: o.buffer.toString("base64"),
    })),
    debug: debugReports,
    errors: errors.length ? errors : undefined,
  });
});
