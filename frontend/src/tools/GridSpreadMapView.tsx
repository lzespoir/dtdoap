import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cellHasMetric,
  cellSpread,
  spreadColorCapFromSummary,
  summaryForMetric,
  type GridSpreadMapCell,
  type GridSpreadMapResult,
  type SpreadMetric,
} from "../lib/toolsApi";
import { spreadToHex } from "../lib/rsrpHex";
import GridCellDetailPanel from "./GridCellDetailPanel";
import SpreadLegendFilter from "./SpreadLegendFilter";

interface Props {
  title: string;
  data: GridSpreadMapResult;
  batchId: string;
}

function projectBounds(cells: GridSpreadMapCell[]) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const c of cells) {
    if (c.west < west) west = c.west;
    if (c.east > east) east = c.east;
    if (c.south < south) south = c.south;
    if (c.north > north) north = c.north;
  }
  if (!Number.isFinite(west)) {
    return { west: 0, east: 1, south: 0, north: 1 };
  }
  const padLon = (east - west) * 0.02 || 1e-6;
  const padLat = (north - south) * 0.02 || 1e-6;
  return {
    west: west - padLon,
    east: east + padLon,
    south: south - padLat,
    north: north + padLat,
  };
}

export default function GridSpreadMapView({ title, data, batchId }: Props) {
  const [metric, setMetric] = useState<SpreadMetric>("rsrp");
  const [hover, setHover] = useState<GridSpreadMapCell | null>(null);
  const [selectedCell, setSelectedCell] = useState<GridSpreadMapCell | null>(null);
  const [filterMin, setFilterMin] = useState(0);
  const [filterMax, setFilterMax] = useState(10);

  const summary = useMemo(
    () => summaryForMetric(data, metric),
    [data, metric]
  );
  const colorCap = useMemo(
    () => spreadColorCapFromSummary(summary, metric),
    [summary, metric]
  );

  const metricCells = useMemo(
    () => data.gridCells.filter((c) => cellHasMetric(c, metric)),
    [data.gridCells, metric]
  );

  useEffect(() => {
    setFilterMin(0);
    setFilterMax(colorCap);
  }, [metric, colorCap]);

  const onRangeChange = useCallback((min: number, max: number) => {
    setFilterMin(min);
    setFilterMax(max);
  }, []);

  const visibleCells = useMemo(() => {
    return metricCells.filter((c) => {
      const spread = cellSpread(c, metric);
      if (spread === null) return false;
      return spread >= filterMin && spread <= filterMax;
    });
  }, [metricCells, metric, filterMin, filterMax]);

  const { west, east, south, north } = useMemo(
    () => projectBounds(visibleCells),
    [visibleCells]
  );

  const viewW = 900;
  const viewH = 520;
  const lonSpan = east - west || 1;
  const latSpan = north - south || 1;

  const toX = (lon: number) => ((lon - west) / lonSpan) * viewW;
  const toY = (lat: number) => (1 - (lat - south) / latSpan) * viewH;

  const sinrDisabled = data.sinrSampleCount === 0;

  return (
    <section className="tools-card">
      <h2>{title}</h2>

      <div className="tools-metric-tabs">
        <button
          type="button"
          className={metric === "rsrp" ? "active" : ""}
          onClick={() => setMetric("rsrp")}
        >
          RSRP
        </button>
        <button
          type="button"
          className={metric === "sinr" ? "active" : ""}
          disabled={sinrDisabled}
          title={sinrDisabled ? "当前数据无有效 SINR" : undefined}
          onClick={() => setMetric("sinr")}
        >
          SINR
        </button>
      </div>

      <div className="tools-stats">
        <div className="tools-stat">
          <span>{metric === "rsrp" ? "主区有效点" : "有效 SINR 点"}</span>
          <strong>
            {(metric === "rsrp"
              ? data.sampleCount
              : data.sinrSampleCount
            ).toLocaleString()}
          </strong>
        </div>
        <div className="tools-stat">
          <span>{metric === "rsrp" ? "RSRP" : "SINR"} 栅格数</span>
          <strong>
            {(metric === "rsrp"
              ? data.gridCellCount
              : data.sinrGridCellCount
            ).toLocaleString()}
          </strong>
        </div>
        <div className="tools-stat">
          <span>栅格边长</span>
          <strong>{data.gridSizeMeters} m</strong>
        </div>
        <div className="tools-stat">
          <span>{metric === "rsrp" ? "RSRP" : "SINR"} 极差 均/P90/最大</span>
          <strong>
            {summary.meanSpread.toFixed(2)} / {summary.p90Spread.toFixed(2)} /{" "}
            {summary.maxSpread.toFixed(2)} dB
          </strong>
        </div>
      </div>
      <p className="tools-note">
        每格单色表示格内 {metric === "rsrp" ? "RSRP" : "SINR"} 极差（max−min）。
        在图例条上左右拖动滑块筛选；点击栅格查看格内采样点；切换 RSRP/SINR 不重新请求栅格图。
      </p>

      <SpreadLegendFilter
        metric={metric}
        colorCap={colorCap}
        onRangeChange={onRangeChange}
        visibleCount={visibleCells.length}
        totalCount={metricCells.length}
      />

      <div className="grid-spread-map-wrap">
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="grid-spread-map-svg"
          role="img"
          aria-label={`栅格 ${metric} 极差分布`}
        >
          {visibleCells.map((c) => {
            const spread = cellSpread(c, metric)!;
            const x = toX(c.west);
            const y = toY(c.north);
            const w = Math.max(toX(c.east) - x, 0.5);
            const h = Math.max(toY(c.south) - y, 0.5);
            return (
              <rect
                key={c.key}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={spreadToHex(spread, colorCap)}
                stroke="#1a1d23"
                strokeWidth={0.35}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelectedCell(c)}
              />
            );
          })}
        </svg>
        {hover && (
          <div className="grid-spread-tooltip">
            栅格 {hover.key} · 主区 n={hover.count}
            {hover.sinrCount > 0 && (
              <>
                <br />
                SINR 有效 n={hover.sinrCount}
              </>
            )}
            <br />
            RSRP {hover.rsrpMin.toFixed(2)} ~ {hover.rsrpMax.toFixed(2)} dBm（极差{" "}
            {hover.rsrpSpread.toFixed(2)}）
            {hover.sinrMin !== null && hover.sinrMax !== null && (
              <>
                <br />
                SINR {hover.sinrMin.toFixed(2)} ~ {hover.sinrMax.toFixed(2)} dB（极差{" "}
                {hover.sinrSpread!.toFixed(2)}）
              </>
            )}
          </div>
        )}
        {visibleCells.length === 0 && (
          <div className="grid-spread-empty">
            当前 {metric === "rsrp" ? "RSRP" : "SINR"} 极差范围内无栅格，请放宽图例筛选
          </div>
        )}
      </div>

      {selectedCell && (
        <GridCellDetailPanel
          batchId={batchId}
          variant={data.variant}
          cell={selectedCell}
          metric={metric}
          gridSizeM={data.gridSizeMeters}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </section>
  );
}
