import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../..");

export const HOST = process.env.HOST ?? "0.0.0.0";
export const PORT = Number(process.env.PORT) || 3001;
export const BATCHES_DIR = path.join(PROJECT_ROOT, "data", "batches");

/** 相对项目根目录的默认优化前路测样例目录（合成数据，可入库） */
export const DEFAULT_LUCE_BEFORE_SAMPLE_REL = path.join(
  "data",
  "synthetic",
  "hangzhou-huanglong",
  "before"
);

/** 相对项目根目录的默认优化后路测样例目录（合成数据，可入库） */
export const DEFAULT_LUCE_AFTER_SAMPLE_REL = path.join(
  "data",
  "synthetic",
  "hangzhou-huanglong",
  "after"
);

/** 单文件上传上限（MB），工参 xlsx / 路测 csv 可能较大 */
export const MAX_UPLOAD_FILE_SIZE_MB =
  Number(process.env.MAX_UPLOAD_FILE_SIZE_MB) || 1024;
export const MAX_UPLOAD_FILE_SIZE_BYTES =
  MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;

export const GONGCAN_EXTENSIONS = new Set([".xls", ".xlsx", ".csv"]);
export const LUCE_EXTENSIONS = new Set([".csv"]);

/** 大运体育场中心 (WGS84)，用于中场区域过滤 */
export const DAYUN_STADIUM_CENTER = {
  longitude: 114.212309,
  latitude: 22.697092,
  /** 中场半径 (m)，过滤路测采样与栅格 */
  midfieldRadiusM: 55,
} as const;
