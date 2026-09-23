import type { FilePathCorrection } from "./pathAdjust";

export interface ExportApiDebugReport {
  fileName: string;
  dataRowCount: number;
  sampleCount: number;
  pathSegmentKeyCount: number;
  patchCount: number;
  pathPatchCount: number;
  samplePatchCount: number;
  layerOffsetEast: number;
  layerOffsetNorth: number;
  sampledRows: unknown[];
  maxShiftRow: unknown | null;
  rowsWithShiftOver10m: number;
  rowsWithShiftOver50m: number;
  rowsWithShiftOver100m: number;
}

export async function exportAdjustedCsvFiles(
  files: File[],
  corrections: FilePathCorrection[]
): Promise<{
  files: { fileName: string; csvBase64: string }[];
  debug: ExportApiDebugReport[];
}> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("corrections", JSON.stringify(corrections));

  const res = await fetch("/api/tools/path-adjust/export", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "导出失败");
  }
  return {
    files: data.files as { fileName: string; csvBase64: string }[],
    debug: (data.debug ?? []) as ExportApiDebugReport[],
  };
}

export function downloadCsvBase64(fileName: string, csvBase64: string): void {
  const bin = atob(csvBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `adjusted-${fileName}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDebugJson(
  frontendDiag: unknown,
  serverDiag: unknown
): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          frontend: frontendDiag,
          server: serverDiag,
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `path-adjust-export-debug-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
