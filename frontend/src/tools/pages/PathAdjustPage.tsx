import { useCallback, useRef, useState } from "react";
import { fetchQuickPathPreview } from "../../lib/quickPathApi";
import {
  buildFileCorrections,
  buildFrontendExportDiagnostics,
  countCsvDataRows,
  layerFromPreview,
  moveActiveLayers,
  moveSelectedPoints,
  type PathAdjustDisplay,
  type PathAdjustLayer,
  type PathFollowAnchor,
} from "../../lib/pathAdjust";
import {
  downloadCsvBase64,
  downloadDebugJson,
  exportAdjustedCsvFiles,
} from "../../lib/pathAdjustExport";
import PathAdjustMap from "../PathAdjustMap";
import PathAdjustSidebar from "../PathAdjustSidebar";
import ToolsLayout from "../ToolsLayout";

export default function PathAdjustPage() {
  const [theme] = useState<"light" | "dark">("light");
  const [layers, setLayers] = useState<PathAdjustLayer[]>([]);
  const [fileMap] = useState(() => new Map<string, File>());
  const [display, setDisplay] = useState<PathAdjustDisplay>("both");
  const [mode, setMode] = useState<"navigate" | "edit">("navigate");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [followAnchor, setFollowAnchor] = useState<PathFollowAnchor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleImport = () => inputRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setLoading(true);
    setError(null);
    try {
      const list = [...files];
      const { items, errors } = await fetchQuickPathPreview(list);
      const newLayers = items.map((item, i) =>
        layerFromPreview(item, layers.length + i)
      );
      for (let i = 0; i < list.length; i++) {
        const item = items[i];
        if (item) fileMap.set(item.fileName, list[i]);
      }
      setLayers((prev) => [...prev, ...newLayers]);
      if (errors?.length) setError(errors.join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onMoveDelta = useCallback(
    (dEast: number, dNorth: number, target: "selection" | "layers") => {
      if (target === "selection" && selectedKeys.size > 0) {
        setLayers((prev) => moveSelectedPoints(prev, selectedKeys, dEast, dNorth));
      } else {
        setLayers((prev) => moveActiveLayers(prev, dEast, dNorth));
      }
    },
    [selectedKeys]
  );

  const onFollowCommit = useCallback((next: PathAdjustLayer[]) => {
    setLayers(next);
  }, []);

  const resetLayer = (id: string) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              offsetEastMeters: 0,
              offsetNorthMeters: 0,
              pointOffsets: {},
            }
          : l
      )
    );
  };

  const removeLayer = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer) fileMap.delete(layer.fileName);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (!key.startsWith(`${id}:`)) next.add(key);
      }
      return next;
    });
    setFollowAnchor((prev) => (prev?.layerId === id ? null : prev));
  };

  const activeLayers = layers.filter((l) => l.active);

  const exportJson = () => {
    const payload = buildFileCorrections(activeLayers);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "path-adjust-corrections.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = async () => {
    setLoading(true);
    setError(null);
    try {
      const corrections = buildFileCorrections(activeLayers);
      if (corrections.length === 0) {
        throw new Error("请勾选需要导出的文件");
      }
      const files: File[] = [];
      const frontendDiag = [];
      for (const c of corrections) {
        const f = fileMap.get(c.fileName);
        if (f) {
          files.push(f);
          const dataRowCount = await countCsvDataRows(f);
          const layer = activeLayers.find((l) => l.fileName === c.fileName);
          if (layer) {
            const logicalPointCount =
              layer.item.result.stats?.servingSamples ??
              layer.item.result.stats?.outputSamples ??
              layer.item.result.samples.length;
            const diag = buildFrontendExportDiagnostics(
              layer,
              logicalPointCount
            );
            frontendDiag.push(diag);
            console.group(`[path-adjust] 前端导出诊断 · ${c.fileName}`);
            console.log("CSV 有效经纬度行", dataRowCount);
            console.log("主区逻辑点数 servingSamples", logicalPointCount);
            console.log("预览采样数", diag.previewSampleCount);
            console.log("预览 stats.totalRows", diag.statsTotalRowsFromPreview);
            console.log("补丁数", diag.patchCount, diag.patches);
            console.log("地图 vs 导出最大偏差(m)", diag.maxDisplayVsExportMeters);
            console.table(
              diag.rows.map((r) => ({
                sampleIdx: r.sampleIndex,
                csvRow: r.csvRowIndex,
                displayVsExportM: r.displayVsExportMeters.toFixed(2),
                pathPatches: r.exportExtra.matchedPathPatches.length,
                pathMappedIdx: r.exportExtra.pathMappedIndex,
                pathMappedE: r.exportExtra.pathMappedEast.toFixed(2),
                pathMappedN: r.exportExtra.pathMappedNorth.toFixed(2),
                sampleDirectE: r.exportExtra.sampleDirectEast.toFixed(2),
              }))
            );
            if (diag.maxDisplayVsExportMeters > 5) {
              console.warn(
                "地图显示与导出计算偏差较大，详见 rows:",
                diag.rows.filter((r) => r.displayVsExportMeters > 5)
              );
            }
            console.groupEnd();
          }
        }
      }
      if (files.length === 0) {
        throw new Error("找不到原始 CSV，请重新导入对应文件");
      }
      const { files: out, debug: serverDiag } = await exportAdjustedCsvFiles(
        files,
        corrections
      );
      console.group("[path-adjust] 服务端导出诊断");
      for (const d of serverDiag) {
        console.log(d.fileName, {
          dataRowCount: d.dataRowCount,
          sampleCount: d.sampleCount,
          patchCount: d.patchCount,
          rowsOver50m: d.rowsWithShiftOver50m,
          rowsOver100m: d.rowsWithShiftOver100m,
          maxShiftRow: d.maxShiftRow,
          sampledRows: d.sampledRows,
        });
      }
      console.groupEnd();
      downloadDebugJson(frontendDiag, serverDiag);
      for (const o of out) {
        downloadCsvBase64(o.fileName, o.csvBase64);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ToolsLayout title="路测轨迹手工校正">
      <p className="tools-note path-adjust-intro">
        独立工具页，不影响主界面。导入多个路测 CSV
        后按图层查看轨迹；可框选漂移或重叠的区段，单独拖动修正，也可多图层一起平移。校正完成后导出
        CSV 再回主平台分析。
      </p>
      {error && <p className="path-adjust-error">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="path-adjust-file-input"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <div className="path-adjust-layout">
        <PathAdjustSidebar
          layers={layers}
          display={display}
          selectedCount={selectedKeys.size}
          mode={mode}
          loading={loading}
          onModeChange={setMode}
          onDisplayChange={setDisplay}
          onLayersChange={setLayers}
          onClearSelection={() => setSelectedKeys(new Set())}
          onImport={handleImport}
          onExportJson={exportJson}
          onExportCsv={() => void exportCsv()}
          onResetLayer={resetLayer}
          onRemoveLayer={removeLayer}
          exportableCount={activeLayers.length}
        />
        <PathAdjustMap
          theme={theme}
          layers={layers}
          display={display}
          selectedKeys={selectedKeys}
          mode={mode}
          followAnchor={followAnchor}
          onFollowAnchorChange={setFollowAnchor}
          onSelectionChange={setSelectedKeys}
          onMoveDelta={onMoveDelta}
          onFollowCommit={onFollowCommit}
        />
      </div>
    </ToolsLayout>
  );
}
