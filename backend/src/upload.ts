import path from "node:path";
import multer from "multer";
import type { FileCategory } from "./batchStorage.js";
import {
  GONGCAN_EXTENSIONS,
  LUCE_EXTENSIONS,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  MAX_UPLOAD_FILE_SIZE_MB,
} from "./config.js";

const memoryStorage = multer.memoryStorage();

export const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: 40,
    fieldSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  },
});

export { MAX_UPLOAD_FILE_SIZE_MB };

export function validateExtension(
  filename: string,
  category: FileCategory
): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (category === "gongcan") return GONGCAN_EXTENSIONS.has(ext);
  if (category === "luce" || category === "luce-after") {
    return LUCE_EXTENSIONS.has(ext);
  }
  return false;
}

export function multerErrorMessage(err: multer.MulterError): string {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return `文件过大，单文件不能超过 ${MAX_UPLOAD_FILE_SIZE_MB} MB`;
    case "LIMIT_FILE_COUNT":
      return "上传文件数量过多，请减少后重试";
    case "LIMIT_UNEXPECTED_FILE":
      return "上传字段名不正确";
    default:
      return err.message || "上传失败";
  }
}
