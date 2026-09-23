import { useCallback, useEffect, useRef, useState } from "react";
import { spreadLegendGradientCss } from "../lib/rsrpHex";
import type { SpreadMetric } from "../lib/toolsApi";

interface Props {
  metric: SpreadMetric;
  colorCap: number;
  onRangeChange: (min: number, max: number) => void;
  visibleCount: number;
  totalCount: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const METRIC_LABEL: Record<SpreadMetric, string> = {
  rsrp: "RSRP",
  sinr: "SINR",
};

export default function SpreadLegendFilter({
  metric,
  colorCap,
  onRangeChange,
  visibleCount,
  totalCount,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"min" | "max" | null>(null);
  const [minV, setMinV] = useState(0);
  const [maxV, setMaxV] = useState(colorCap);

  useEffect(() => {
    setMinV(0);
    setMaxV(colorCap);
    onRangeChange(0, colorCap);
  }, [colorCap, metric, onRangeChange]);

  const emit = useCallback(
    (lo: number, hi: number) => {
      setMinV(lo);
      setMaxV(hi);
      onRangeChange(lo, hi);
    },
    [onRangeChange]
  );

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      return Math.round(pct * colorCap * 100) / 100;
    },
    [colorCap]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const v = valueFromClientX(e.clientX);
      const minGap = 0.05;
      if (dragRef.current === "min") {
        emit(clamp(v, 0, maxV - minGap), maxV);
      } else {
        emit(minV, clamp(v, minV + minGap, colorCap));
      }
    },
    [colorCap, emit, maxV, minV, valueFromClientX]
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  }, []);

  const minPct = colorCap > 0 ? (minV / colorCap) * 100 : 0;
  const maxPct = colorCap > 0 ? (maxV / colorCap) * 100 : 100;
  const label = METRIC_LABEL[metric];

  return (
    <div className="spread-legend-filter">
      <div className="spread-legend-filter-head">
        <span>
          格内 {label} 极差 0 ~ {colorCap.toFixed(1)} dB · 拖动图例两端筛选
        </span>
        <span className="spread-legend-filter-range">
          显示 {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} 格
          （{minV.toFixed(2)} ~ {maxV.toFixed(2)} dB）
        </span>
      </div>
      <div
        ref={trackRef}
        className="spread-legend-track"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="spread-legend-gradient"
          style={{ background: spreadLegendGradientCss(colorCap) }}
        />
        <div
          className="spread-legend-dim spread-legend-dim--left"
          style={{ width: `${minPct}%` }}
        />
        <div
          className="spread-legend-dim spread-legend-dim--right"
          style={{ width: `${100 - maxPct}%` }}
        />
        <div
          className="spread-legend-active"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
        />
        <button
          type="button"
          className="spread-legend-thumb spread-legend-thumb--min"
          style={{ left: `${minPct}%` }}
          aria-label={`最小 ${label} 极差 ${minV.toFixed(2)} dB`}
          onPointerDown={(e) => {
            dragRef.current = "min";
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
        />
        <button
          type="button"
          className="spread-legend-thumb spread-legend-thumb--max"
          style={{ left: `${maxPct}%` }}
          aria-label={`最大 ${label} 极差 ${maxV.toFixed(2)} dB`}
          onPointerDown={(e) => {
            dragRef.current = "max";
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
        />
      </div>
      <div className="spread-legend-filter-labels">
        <span className="legend-low">一致</span>
        <button
          type="button"
          className="spread-legend-reset"
          onClick={() => emit(0, colorCap)}
        >
          重置范围
        </button>
        <span className="legend-high">落差大</span>
      </div>
    </div>
  );
}
