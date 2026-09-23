/** 修复 multipart 上传时 UTF-8 中文文件名被误读为 latin1 的乱码 */
export function decodeUploadFilename(name: string): string {
  if (!name) return name;
  if (/[\u3400-\u9fff]/.test(name)) return name;

  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (decoded && !decoded.includes("\uFFFD")) return decoded;
  } catch {
    /* ignore */
  }
  return name;
}
