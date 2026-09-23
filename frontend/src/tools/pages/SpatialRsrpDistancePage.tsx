import { useCallback, useEffect, useState } from "react";
import { listBatches, type BatchSummary } from "../../lib/api";
import { fetchAfterLuceAvailable } from "../../lib/luceApi";
import {
  fetchGridSpreadMap,
  type GridSpreadMapResult,
  type ToolDatasetVariant,
} from "../../lib/toolsApi";
import GridSpreadMapView from "../GridSpreadMapView";
import ToolsLayout from "../ToolsLayout";

type ViewSlice = "before" | "after";

export default function SpatialRsrpDistancePage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchId, setBatchId] = useState(
    () => new URLSearchParams(window.location.search).get("batch") ?? ""
  );
  const [dataset, setDataset] = useState<ToolDatasetVariant>("before");
  const [gridSizeM, setGridSizeM] = useState(5);
  const [viewSlice, setViewSlice] = useState<ViewSlice>("before");
  const [afterAvail, setAfterAvail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [beforeData, setBeforeData] = useState<GridSpreadMapResult | null>(
    null
  );
  const [afterData, setAfterData] = useState<GridSpreadMapResult | null>(null);
  const [singleData, setSingleData] = useState<GridSpreadMapResult | null>(
    null
  );

  useEffect(() => {
    void listBatches().then(setBatches).catch(() => setBatches([]));
  }, []);

  useEffect(() => {
    if (!batchId) {
      setAfterAvail(false);
      return;
    }
    void fetchAfterLuceAvailable(batchId).then(setAfterAvail);
  }, [batchId]);

  const runAnalysis = useCallback(async () => {
    if (!batchId) {
      setError("请选择批次");
      return;
    }
    const size = Math.min(200, Math.max(1, gridSizeM || 5));
    setLoading(true);
    setError(null);
    setBeforeData(null);
    setAfterData(null);
    setSingleData(null);
    try {
      const res = await fetchGridSpreadMap(batchId, dataset, size);
      if (res.kind === "both") {
        setBeforeData(res.before);
        setAfterData(res.after);
        setViewSlice("before");
      } else {
        setSingleData(res.result);
        setViewSlice(res.variant);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }, [batchId, dataset, gridSizeM]);

  const activeData =
    dataset === "both"
      ? viewSlice === "before"
        ? beforeData
        : afterData
      : singleData;

  return (
    <ToolsLayout title="主区栅格 · RSRP / SINR 极差">
      <div className="tools-card">
        <h2>数据选择</h2>
        <div className="tools-controls">
          <label>
            批次
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">— 选择 —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.alias?.trim() || b.id.slice(0, 8)} ({b.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </label>
          <label>
            数据集（不混合）
            <select
              value={dataset}
              onChange={(e) =>
                setDataset(e.target.value as ToolDatasetVariant)
              }
            >
              <option value="before">仅优化前</option>
              <option value="after" disabled={!afterAvail}>
                仅优化后{afterAvail ? "" : "（无数据）"}
              </option>
              <option value="both" disabled={!afterAvail}>
                优化前 + 优化后（分开展示）
                {afterAvail ? "" : "（无优化后）"}
              </option>
            </select>
          </label>
          <label>
            栅格边长 (m)
            <input
              type="number"
              min={1}
              max={200}
              value={gridSizeM}
              onChange={(e) => setGridSizeM(Number(e.target.value) || 5)}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={loading || !batchId}
            onClick={() => void runAnalysis()}
          >
            {loading ? "计算中…" : "生成栅格图"}
          </button>
        </div>
        {error && <p className="tools-error">{error}</p>}
      </div>

      {dataset === "both" && (beforeData || afterData) && (
        <div className="tools-variant-tabs">
          <button
            type="button"
            className={viewSlice === "before" ? "active" : ""}
            onClick={() => setViewSlice("before")}
          >
            优化前
          </button>
          <button
            type="button"
            className={viewSlice === "after" ? "active" : ""}
            onClick={() => setViewSlice("after")}
          >
            优化后
          </button>
        </div>
      )}

      {activeData && (
        <GridSpreadMapView
          title={
            dataset === "both"
              ? viewSlice === "before"
                ? "优化前"
                : "优化后"
              : dataset === "after"
                ? "优化后"
                : "优化前"
          }
          data={activeData}
          batchId={batchId}
        />
      )}
    </ToolsLayout>
  );
}
