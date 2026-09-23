import { useEffect, useMemo, useState } from "react";
import {
  fetchGridCellSamples,
  type GridCellSamplePoint,
  type GridSpreadMapCell,
  type SpreadMetric,
} from "../lib/toolsApi";
import { rsrpToHex, sinrToHex } from "../lib/rsrpHex";

interface Props {
  batchId: string;
  variant: "before" | "after";
  cell: GridSpreadMapCell;
  metric: SpreadMetric;
  gridSizeM: number;
  onClose: () => void;
}

function metricHex(metric: SpreadMetric, p: GridCellSamplePoint): string {
  if (metric === "sinr") {
    if (p.sinr === null) return "#555";
    return sinrToHex(p.sinr);
  }
  return rsrpToHex(p.rsrp);
}

export default function GridCellDetailPanel({
  batchId,
  variant,
  cell,
  metric,
  gridSizeM,
  onClose,
}: Props) {
  const [points, setPoints] = useState<GridCellSamplePoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setPoints(null);
    void fetchGridCellSamples(batchId, variant, cell.gx, cell.gy, gridSizeM)
      .then((res) => {
        if (ac.signal.aborted) return;
        setPoints(res.points);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [batchId, variant, cell.gx, cell.gy, gridSizeM]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayPoints = useMemo(() => {
    if (!points) return [];
    if (metric === "sinr") return points.filter((p) => p.sinr !== null);
    return points;
  }, [points, metric]);

  const plotW = 440;
  const plotH = 300;
  const pad = 12;
  const lonSpan = cell.east - cell.west || 1e-9;
  const latSpan = cell.north - cell.south || 1e-9;
  const toX = (lon: number) =>
    pad + ((lon - cell.west) / lonSpan) * (plotW - 2 * pad);
  const toY = (lat: number) =>
    pad + (1 - (lat - cell.south) / latSpan) * (plotH - 2 * pad);
  const dotR =
    displayPoints.length > 200 ? 2.5 : displayPoints.length > 80 ? 3.5 : 5;

  const metricLabel = metric === "rsrp" ? "RSRP" : "SINR";

  return (
    <div
      className="grid-cell-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="grid-cell-modal"
        role="dialog"
        aria-labelledby="grid-cell-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="grid-cell-modal-head">
          <div>
            <h3 id="grid-cell-modal-title">栅格 {cell.key}</h3>
            <p className="grid-cell-modal-sub">
              {variant === "before" ? "优化前" : "优化后"} · {gridSizeM} m 栅格 ·
              点击格内查看采样点位置与 {metricLabel}
            </p>
          </div>
          <button type="button" className="grid-cell-modal-close" onClick={onClose}>
            关闭
          </button>
        </header>

        {loading && <p className="grid-cell-modal-status">加载采样点…</p>}
        {error && <p className="tools-error">{error}</p>}

        {!loading && !error && points && (
          <>
            <div className="grid-cell-modal-stats">
              <span>主区 n={points.length}</span>
              {metric === "sinr" && (
                <span>SINR 有效 n={displayPoints.length}</span>
              )}
              <span>
                RSRP {cell.rsrpMin.toFixed(2)} ~ {cell.rsrpMax.toFixed(2)} dBm
              </span>
              {cell.sinrSpread !== null && cell.sinrMin !== null && (
                <span>
                  SINR {cell.sinrMin.toFixed(2)} ~ {cell.sinrMax!.toFixed(2)} dB
                </span>
              )}
            </div>

            <div className="grid-cell-modal-plot-wrap">
              <svg
                viewBox={`0 0 ${plotW} ${plotH}`}
                className="grid-cell-modal-plot"
                role="img"
                aria-label={`栅格内 ${metricLabel} 采样点分布`}
              >
                <rect
                  x={pad}
                  y={pad}
                  width={plotW - 2 * pad}
                  height={plotH - 2 * pad}
                  fill="#1a1d23"
                  stroke="#5a6270"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                {displayPoints.map((p, i) => (
                  <circle
                    key={`${p.longitude},${p.latitude},${i}`}
                    cx={toX(p.longitude)}
                    cy={toY(p.latitude)}
                    r={dotR}
                    fill={metricHex(metric, p)}
                    stroke="#0d0f12"
                    strokeWidth={0.4}
                  />
                ))}
              </svg>
              <span className="grid-cell-modal-plot-hint">
                虚线框为栅格边界，圆点颜色按 {metricLabel} 着色
              </span>
            </div>

            <div className="grid-cell-modal-table-wrap">
              <table className="grid-cell-modal-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>经度</th>
                    <th>纬度</th>
                    <th>RSRP</th>
                    <th>SINR</th>
                    <th>PCI</th>
                  </tr>
                </thead>
                <tbody>
                  {displayPoints.map((p, i) => (
                    <tr key={`row-${i}`}>
                      <td>{i + 1}</td>
                      <td>{p.longitude.toFixed(6)}</td>
                      <td>{p.latitude.toFixed(6)}</td>
                      <td style={{ color: rsrpToHex(p.rsrp) }}>{p.rsrp.toFixed(2)}</td>
                      <td style={{ color: p.sinr !== null ? sinrToHex(p.sinr) : undefined }}>
                        {p.sinr === null ? "—" : p.sinr.toFixed(2)}
                      </td>
                      <td>{p.pci}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {displayPoints.length === 0 && (
                <p className="grid-cell-modal-status">
                  该栅格无有效 {metricLabel} 采样点
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
