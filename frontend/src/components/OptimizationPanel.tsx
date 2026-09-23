import { useState } from "react";
import TargetGroupServingChart from "./TargetGroupServingChart";
import type {
  CoverageStats,
  GridMatchMode,
  OptimizationCompare,
} from "../types/optimize";

interface Props {
  compare: OptimizationCompare | null;
  loading: boolean;
  error: string | null;
  gridMatchMode: GridMatchMode;
  onGridMatchChange: (mode: GridMatchMode) => void;
  onClose: () => void;
  onRecompute?: () => void;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtDelta(
  v: number | null | undefined,
  unit: "dB" | "pp" = "dB",
  digits = 2
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const scaled = unit === "pp" ? v * 100 : v;
  const sign = scaled > 0 ? "+" : "";
  return `${sign}${scaled.toFixed(digits)} ${unit === "pp" ? "pp" : "dB"}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function deltaClass(
  v: number | null | undefined,
  goodPositive: boolean
): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) {
    return "opt-delta-neutral";
  }
  const positive = v > 0;
  const good = goodPositive ? positive : !positive;
  return good ? "opt-delta-good" : "opt-delta-bad";
}

function CoverageRow({
  label,
  before,
  after,
  delta,
  unit,
  goodPositive,
  pp,
}: {
  label: string;
  before: number | null | undefined;
  after: number | null | undefined;
  delta: number | null;
  unit: string;
  goodPositive: boolean;
  pp?: boolean;
}) {
  return (
    <tr>
      <th>{label}</th>
      <td>{pp ? fmtPct(before) : `${fmt(before)} ${unit}`}</td>
      <td>{pp ? fmtPct(after) : `${fmt(after)} ${unit}`}</td>
      <td className={deltaClass(delta, goodPositive)}>
        {fmtDelta(delta, pp ? "pp" : "dB")}
      </td>
    </tr>
  );
}

function CoverageTable({
  before,
  after,
  cmp,
  analysisMode,
}: {
  before: CoverageStats | null;
  after: CoverageStats | null;
  cmp: OptimizationCompare;
  analysisMode: "rsrp" | "sinr";
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <table className="opt-coverage-table">
      <thead>
        <tr>
          <th>指标</th>
          <th>优化前</th>
          <th>优化后</th>
          <th>变化</th>
        </tr>
      </thead>
      <tbody>
        {analysisMode === "rsrp" && (
          <>
            <CoverageRow
              label="平均 RSRP"
              before={before?.avgRsrp}
              after={after?.avgRsrp}
              delta={cmp.deltaAvg}
              unit="dBm"
              goodPositive
            />
            <CoverageRow
              label="≥ -95 dBm 覆盖率"
              before={before?.cover95}
              after={after?.cover95}
              delta={cmp.deltaCover95}
              unit=""
              goodPositive
              pp
            />
          </>
        )}
        {analysisMode === "sinr" && (
          <>
            <CoverageRow
              label="平均 SINR"
              before={before?.avgSinr}
              after={after?.avgSinr}
              delta={cmp.deltaSinr}
              unit="dB"
              goodPositive
            />
            <CoverageRow
              label="≥ 0 dB 覆盖率"
              before={before?.sinrCover0}
              after={after?.sinrCover0}
              delta={cmp.deltaSinrCover0}
              unit=""
              goodPositive
              pp
            />
          </>
        )}
        <tr className="opt-detail-toggle">
          <td colSpan={4}>
            <button
              type="button"
              className="opt-detail-btn"
              onClick={() => setDetailOpen((v) => !v)}
            >
              {detailOpen ? "▲ 收起详细指标" : "▼ 展开详细指标"}
            </button>
          </td>
        </tr>
        {detailOpen && (
          <>
            {analysisMode === "rsrp" && (
              <>
                <CoverageRow
                  label="中位 RSRP"
                  before={before?.p50}
                  after={after?.p50}
                  delta={
                    before?.p50 != null && after?.p50 != null
                      ? Number((after.p50 - before.p50).toFixed(2))
                      : null
                  }
                  unit="dBm"
                  goodPositive
                />
                <CoverageRow
                  label="平均 SINR"
                  before={before?.avgSinr}
                  after={after?.avgSinr}
                  delta={cmp.deltaSinr}
                  unit="dB"
                  goodPositive
                />
                <CoverageRow
                  label="中位 SINR"
                  before={before?.p50Sinr}
                  after={after?.p50Sinr}
                  delta={
                    before?.p50Sinr != null && after?.p50Sinr != null
                      ? Number((after.p50Sinr - before.p50Sinr).toFixed(2))
                      : null
                  }
                  unit="dB"
                  goodPositive
                />
                <CoverageRow
                  label="≥ -90 dBm 覆盖率"
                  before={before?.cover90}
                  after={after?.cover90}
                  delta={cmp.deltaCover90}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="≥ -100 dBm 覆盖率"
                  before={before?.cover100}
                  after={after?.cover100}
                  delta={cmp.deltaCover100}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="≥ -105 dBm 覆盖率"
                  before={before?.cover105}
                  after={after?.cover105}
                  delta={cmp.deltaCover105}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="≥ -110 dBm 覆盖率"
                  before={before?.cover110}
                  after={after?.cover110}
                  delta={cmp.deltaCover110}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="弱覆盖 (< -110)"
                  before={before?.weak}
                  after={after?.weak}
                  delta={cmp.deltaWeak}
                  unit=""
                  goodPositive={false}
                  pp
                />
              </>
            )}
            {analysisMode === "sinr" && (
              <>
                <CoverageRow
                  label="中位 SINR"
                  before={before?.p50Sinr}
                  after={after?.p50Sinr}
                  delta={
                    before?.p50Sinr != null && after?.p50Sinr != null
                      ? Number((after.p50Sinr - before.p50Sinr).toFixed(2))
                      : null
                  }
                  unit="dB"
                  goodPositive
                />
                <CoverageRow
                  label="≥ 10 dB 覆盖率"
                  before={before?.sinrCover10}
                  after={after?.sinrCover10}
                  delta={cmp.deltaSinrCover10}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="≥ 5 dB 覆盖率"
                  before={before?.sinrCover5}
                  after={after?.sinrCover5}
                  delta={cmp.deltaSinrCover5}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="≥ -5 dB 覆盖率"
                  before={before?.sinrCoverNeg5}
                  after={after?.sinrCoverNeg5}
                  delta={cmp.deltaSinrCoverNeg5}
                  unit=""
                  goodPositive
                  pp
                />
                <CoverageRow
                  label="极弱 (< -5)"
                  before={before?.sinrWeak}
                  after={after?.sinrWeak}
                  delta={cmp.deltaSinrWeak}
                  unit=""
                  goodPositive={false}
                  pp
                />
              </>
            )}
          </>
        )}
        <tr className="opt-coverage-sep">
          <th colSpan={4}>覆盖区间分布</th>
        </tr>
        {analysisMode === "rsrp" ? (
          <>
            <CoverageRow
              label="优质 (≥ -80)"
              before={before?.rangeExcellent}
              after={after?.rangeExcellent}
              delta={cmp.deltaRangeExcellent}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="良好 (-80 ~ -90)"
              before={before?.rangeGood}
              after={after?.rangeGood}
              delta={cmp.deltaRangeGood}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="中等 (-90 ~ -100)"
              before={before?.rangeMedium}
              after={after?.rangeMedium}
              delta={cmp.deltaRangeMedium}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="弱覆盖 (-100 ~ -110)"
              before={before?.rangeWeak}
              after={after?.rangeWeak}
              delta={cmp.deltaRangeWeak}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="极弱 (< -110)"
              before={before?.weak}
              after={after?.weak}
              delta={cmp.deltaWeak}
              unit=""
              goodPositive={false}
              pp
            />
          </>
        ) : (
          <>
            <CoverageRow
              label="优质 (≥ 10 dB)"
              before={before?.sinrRangeExcellent}
              after={after?.sinrRangeExcellent}
              delta={cmp.deltaSinrRangeExcellent}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="良好 (5 ~ 10 dB)"
              before={before?.sinrRangeGood}
              after={after?.sinrRangeGood}
              delta={cmp.deltaSinrRangeGood}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="中等 (0 ~ 5 dB)"
              before={before?.sinrRangeMedium}
              after={after?.sinrRangeMedium}
              delta={cmp.deltaSinrRangeMedium}
              unit=""
              goodPositive
              pp
            />
            <CoverageRow
              label="弱覆盖 (-5 ~ 0 dB)"
              before={before?.sinrRangeWeak}
              after={after?.sinrRangeWeak}
              delta={cmp.deltaSinrRangeWeak}
              unit=""
              goodPositive={false}
              pp
            />
            <CoverageRow
              label="极弱 (< -5 dB)"
              before={before?.sinrWeak}
              after={after?.sinrWeak}
              delta={cmp.deltaSinrWeak}
              unit=""
              goodPositive={false}
              pp
            />
          </>
        )}
        <tr className="opt-coverage-foot">
          <th>采样数</th>
          <td>{before?.count?.toLocaleString() ?? 0}</td>
          <td>{after?.count?.toLocaleString() ?? 0}</td>
          <td>—</td>
        </tr>
        {cmp.gridDelta && (
          <>
            <tr className="opt-coverage-sep">
              <th colSpan={4}>网格变化（共同覆盖 {cmp.gridDelta.commonGrids} 格）</th>
            </tr>
            <tr>
              <th>改善网格数</th>
              <td colSpan={2} className="opt-delta-good">
                {cmp.gridDelta.improvedGrids}
              </td>
              <td className="opt-delta-good">
                {fmtPct(cmp.gridDelta.improvedRatio)}
              </td>
            </tr>
            <tr>
              <th>变差网格数</th>
              <td colSpan={2} className="opt-delta-bad">
                {cmp.gridDelta.degradedGrids}
              </td>
              <td className="opt-delta-bad">
                {fmtPct(cmp.gridDelta.degradedRatio)}
              </td>
            </tr>
            <tr>
              <th>持平网格数</th>
              <td colSpan={2}>{cmp.gridDelta.unchangedGrids}</td>
              <td>
                {fmtPct(
                  cmp.gridDelta.commonGrids > 0
                    ? cmp.gridDelta.unchangedGrids /
                        cmp.gridDelta.commonGrids
                    : 0
                )}
              </td>
            </tr>
          </>
        )}
        {(cmp.targetGroupServingBefore || cmp.targetGroupServingAfter) && (
          <>
            <tr className="opt-coverage-sep">
              <th colSpan={4}>{cmp.targetGroupName}主服务占比</th>
            </tr>
            <tr>
              <th>目标组服务占比</th>
              <td>{fmtPct(cmp.targetGroupServingBefore?.ratio)}</td>
              <td>{fmtPct(cmp.targetGroupServingAfter?.ratio)}</td>
              <td
                className={deltaClass(
                  cmp.targetGroupServingBefore && cmp.targetGroupServingAfter
                    ? cmp.targetGroupServingAfter.ratio -
                        cmp.targetGroupServingBefore.ratio
                    : null,
                  true
                )}
              >
                {cmp.targetGroupServingBefore && cmp.targetGroupServingAfter
                  ? fmtDelta(
                      cmp.targetGroupServingAfter.ratio -
                        cmp.targetGroupServingBefore.ratio,
                      "pp"
                    )
                  : "—"}
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

const GRID_MATCH_OPTIONS: { value: GridMatchMode; label: string }[] = [
  { value: "intersection", label: "优化前后均包含的网格" },
  { value: "default", label: "默认" },
  { value: "before", label: "优化前网格为准" },
  { value: "after", label: "优化后网格为准" },
];

export default function OptimizationPanel({
  compare,
  loading,
  error,
  gridMatchMode,
  onGridMatchChange,
  onClose,
  onRecompute,
}: Props) {
  const [analysisMode, setAnalysisMode] = useState<"rsrp" | "sinr">("rsrp");
  const [compareOpen, setCompareOpen] = useState(false);

  const visualBefore = compare?.before ?? null;
  const visualAfter = compare?.after ?? null;
  const onIntersection = compare?.gridMatchMode === "intersection";
  const rsrpDeltaForLeader = onIntersection ? compare?.deltaAvg ?? null : null;
  const sinrDeltaForLeader = onIntersection ? compare?.deltaSinr ?? null : null;
  const rsrpQualityDeltaForLeader = onIntersection
    ? compare?.deltaQualityRsrp ?? null
    : null;
  const sinrQualityDeltaForLeader = onIntersection
    ? compare?.deltaQualitySinr ?? null
    : null;
  const qualityRsrpThreshold = compare?.qualityRsrpThresholdDb ?? -85;
  const qualitySinrThreshold = compare?.qualitySinrThresholdDb ?? 0;

  const showTargetGroupServing =
    compare?.targetGroupServingBefore != null &&
    compare?.targetGroupServingAfter != null;

  return (
    <aside className="opt-panel">
      <header className="opt-panel-header">
        <div>
          <h2>优化效果对比</h2>
        </div>
        <div className="opt-panel-actions">
          {onRecompute && (
            <button
              type="button"
              className="ghost-btn"
              onClick={onRecompute}
              disabled={loading}
            >
              重新计算
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>

      {loading && <div className="opt-state">计算中…</div>}
      {error && <div className="opt-state opt-error">{error}</div>}

      {compare && showTargetGroupServing && (
        <TargetGroupServingChart
          groupName={compare.targetGroupName}
          before={compare.targetGroupServingBefore!}
          after={compare.targetGroupServingAfter!}
          deltaRatio={compare.deltaTargetGroupServingRatio ?? null}
        />
      )}

      {compare && (
        <section className="opt-section opt-viz-section">
          <div className="opt-section-head">
            <h3>性能指标变化</h3>
            <div className="opt-viz-actions">
              {!onIntersection && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onGridMatchChange("intersection")}
                >
                  切到共同网格口径
                </button>
              )}
            </div>
          </div>
          <div className="opt-viz-grid">
            <article className="opt-viz-card">
              <h4 title="按优化前后均包含的网格口径统计">平均 RSRP 提升</h4>
              <div className={`opt-viz-kpi ${deltaClass(rsrpDeltaForLeader, true)}`}>
                {rsrpDeltaForLeader == null ? "—" : fmtDelta(rsrpDeltaForLeader, "dB")}
              </div>
              <p>
                {onIntersection
                  ? `优化前 ${fmt(visualBefore?.avgRsrp)} dBm → 优化后 ${fmt(visualAfter?.avgRsrp)} dBm`
                  : "请将网格口径切到「优化前后均包含的网格」"}
              </p>
            </article>

            <article className="opt-viz-card">
              <h4 title="按优化前后均包含的网格口径统计">平均 SINR 提升</h4>
              <div className={`opt-viz-kpi ${deltaClass(sinrDeltaForLeader, true)}`}>
                {sinrDeltaForLeader == null ? "—" : fmtDelta(sinrDeltaForLeader, "dB")}
              </div>
              <p>
                {onIntersection
                  ? `优化前 ${fmt(visualBefore?.avgSinr)} dB → 优化后 ${fmt(visualAfter?.avgSinr)} dB`
                  : "请将网格口径切到「优化前后均包含的网格」"}
              </p>
            </article>

            <article className="opt-viz-card">
              <h4 title="优质栅格：RSRP 超过阈值的栅格占比（共同网格口径）">
                RSRP ≥ {qualityRsrpThreshold} dBm 优质栅格比例
              </h4>
              <div className={`opt-viz-kpi ${deltaClass(rsrpQualityDeltaForLeader, true)}`}>
                {rsrpQualityDeltaForLeader == null
                  ? "—"
                  : fmtDelta(rsrpQualityDeltaForLeader, "pp")}
              </div>
              <p>
                {onIntersection
                  ? `优化前 ${fmtPct(compare.beforeQualityRsrp)} → 优化后 ${fmtPct(
                      compare.afterQualityRsrp
                    )}`
                  : "请将网格口径切到「优化前后均包含的网格」"}
              </p>
            </article>

            <article className="opt-viz-card">
              <h4 title="优质栅格：SINR 超过阈值的栅格占比（共同网格口径）">
                SINR ≥ {qualitySinrThreshold} dB 优质栅格比例
              </h4>
              <div className={`opt-viz-kpi ${deltaClass(sinrQualityDeltaForLeader, true)}`}>
                {sinrQualityDeltaForLeader == null
                  ? "—"
                  : fmtDelta(sinrQualityDeltaForLeader, "pp")}
              </div>
              <p>
                {onIntersection
                  ? `优化前 ${fmtPct(compare.beforeQualitySinr)} → 优化后 ${fmtPct(
                      compare.afterQualitySinr
                    )}`
                  : "请将网格口径切到「优化前后均包含的网格」"}
              </p>
            </article>
          </div>
        </section>
      )}

      {compare && (
        <section className="opt-section">
          <div className="opt-section-head">
            <h3>优化效果对比（详细）</h3>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setCompareOpen((v) => !v)}
            >
              {compareOpen ? "收起" : "展开"}
            </button>
          </div>
          {compareOpen && (
            <>
              <div className="opt-section-head">
                <h3>整体覆盖对比</h3>
            <select
              className="opt-grid-match-select"
              value={gridMatchMode}
              disabled={loading}
              onChange={(e) =>
                onGridMatchChange(e.target.value as GridMatchMode)
              }
            >
              {GRID_MATCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost-btn"
              disabled={loading}
              onClick={() =>
                setAnalysisMode((m) => (m === "rsrp" ? "sinr" : "rsrp"))
              }
            >
              {analysisMode === "rsrp" ? "切换 SINR 分析" : "切换 RSRP 分析"}
            </button>
              </div>
              {compare.gridMatchInfo && gridMatchMode !== "default" && (
                <p className="opt-grid-match-info">
                  优化前 {compare.gridMatchInfo.beforeGridCount} 格 / 优化后{" "}
                  {compare.gridMatchInfo.afterGridCount} 格 → 参与对比{" "}
                  {compare.gridMatchInfo.matchedGridCount} 格
                </p>
              )}
              <CoverageTable
                before={compare.before}
                after={compare.after}
                cmp={compare}
                analysisMode={analysisMode}
              />
            </>
          )}
        </section>
      )}

      {compareOpen && compare && compare.pciStats.length > 0 && (
        <section className="opt-section">
          <h3>{compare.targetGroupName} · 按 PCI 拆分</h3>
          <table className="opt-pci-table">
            <thead>
              <tr>
                <th>PCI</th>
                <th>前 平均</th>
                <th>后 平均</th>
                <th>ΔRSRP</th>
                <th>前 ≥-95</th>
                <th>后 ≥-95</th>
                <th>Δ覆盖</th>
                <th>前 N</th>
                <th>后 N</th>
              </tr>
            </thead>
            <tbody>
              {compare.pciStats.map((p) => (
                <tr key={p.pci}>
                  <td>{p.pci}</td>
                  <td>{fmt(p.before?.avgRsrp)}</td>
                  <td>{fmt(p.after?.avgRsrp)}</td>
                  <td className={deltaClass(p.deltaAvg, true)}>
                    {fmtDelta(p.deltaAvg, "dB")}
                  </td>
                  <td>{fmtPct(p.before?.cover95)}</td>
                  <td>{fmtPct(p.after?.cover95)}</td>
                  <td className={deltaClass(p.deltaCover95, true)}>
                    {fmtDelta(p.deltaCover95, "pp")}
                  </td>
                  <td>{p.before?.count?.toLocaleString() ?? 0}</td>
                  <td>{p.after?.count?.toLocaleString() ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && !error && !compare && (
        <div className="opt-state">尚无优化数据</div>
      )}
    </aside>
  );
}
