import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { ensureBatchesRoot } from "./batchStorage.js";
import { HOST, PORT, PROJECT_ROOT } from "./config.js";
import { batchesRouter } from "./routes/batches.js";
import { toolsRouter } from "./routes/tools.js";
import { loadRegionBboxPresets } from "./regionBboxPresets.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/region-bbox-presets", (_req, res) => {
  try {
    const file = loadRegionBboxPresets();
    res.json(file);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "读取区域预设失败",
    });
  }
});

app.use("/api/batches", batchesRouter);
app.use("/api/tools", toolsRouter);

const staticDir =
  process.env.STATIC_DIR?.trim() ||
  path.join(PROJECT_ROOT, "frontend", "dist");
const serveFrontend = fs.existsSync(path.join(staticDir, "index.html"));

if (serveFrontend) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "服务器内部错误" });
  }
);

await ensureBatchesRoot();

app.listen(PORT, HOST, () => {
  console.log(`DTDOAP backend listening on http://${HOST}:${PORT}`);
  if (serveFrontend) {
    console.log(`Serving frontend from ${staticDir}`);
  }
});
