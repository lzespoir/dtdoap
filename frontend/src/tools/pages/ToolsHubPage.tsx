import { useEffect, useState } from "react";
import { listBatches, type BatchSummary } from "../../lib/api";
import ToolsLayout from "../ToolsLayout";

export default function ToolsHubPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);

  useEffect(() => {
    void listBatches().then(setBatches).catch(() => setBatches([]));
  }, []);

  const initialBatch =
    new URLSearchParams(window.location.search).get("batch") ?? "";

  return (
    <ToolsLayout title="分析工具">
      <p className="tools-note" style={{ marginTop: 0 }}>
        以下工具在独立页面运行，不占用主地图。请先在主页上传并处理路测，再在此选择批次分析。
      </p>
      <div className="tool-list-grid">
        <a
          className="tool-list-item"
          href="/tools/path-adjust"
        >
          <strong>路测轨迹手工校正</strong>
          <span>
            多文件图层、框选漂移区段并拖动修正 GPS 轨迹，结合底图对齐后导出 CSV。
          </span>
        </a>
        <a
          className="tool-list-item"
          href="/tools/path-shape-snap"
        >
          <strong>路测轨迹形状附着</strong>
          <span>
            在地图上绘制参考线/椭圆/矩形，按时间段将采样点有序投影附着到目标形状，导出校正 CSV。
          </span>
        </a>
        <a
          className="tool-list-item"
          href={`/tools/spatial-rsrp${initialBatch ? `?batch=${encodeURIComponent(initialBatch)}` : ""}`}
        >
          <strong>主区栅格 · RSRP / SINR 极差</strong>
          <span>
            按栅格边长划分，单色表示格内极差；可切换 RSRP 或 SINR，图例拖动筛选。
          </span>
        </a>
      </div>
      {batches.length > 0 && (
        <div className="tools-card" style={{ marginTop: "1rem" }}>
          <h2>已有批次</h2>
          <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
            {batches.map((b) => (
              <li key={b.id} style={{ marginBottom: "0.35rem" }}>
                <a
                  href={`/tools/spatial-rsrp?batch=${encodeURIComponent(b.id)}`}
                  style={{ color: "#67a9cf" }}
                >
                  {b.alias?.trim() || b.id.slice(0, 8)}
                </a>
                <span style={{ color: "#7a828e" }}> — {b.id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolsLayout>
  );
}
