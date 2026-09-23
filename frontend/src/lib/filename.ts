/** 显示用：修复已存储的 latin1 乱码文件名 */
export function displayFilename(name: string): string {
  if (!name) return name;
  if (/[\u3400-\u9fff]/.test(name)) return name;
  try {
    const bytes = new Uint8Array(name.length);
    for (let i = 0; i < name.length; i++) {
      bytes[i] = name.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && !decoded.includes("\uFFFD")) return decoded;
  } catch {
    /* ignore */
  }
  return name;
}
