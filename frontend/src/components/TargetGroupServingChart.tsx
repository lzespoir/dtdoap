import type { TargetGroupServingStats } from "../types/optimize";

const R = 42;
const STROKE = 14;
const C = 56;
const CIRC = 2 * Math.PI * R;

const COLOR_TARGET = "#43a047";
const COLOR_OTHER = "#4a5568";

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function DonutPie({
  ratio,
  label,
}: {
  ratio: number;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const targetLen = clamped * CIRC;
  const otherLen = CIRC - targetLen;

  return (
    <figure className="opt-target-group-pie">
      <figcaption>{label}</figcaption>
      <svg
        viewBox="0 0 112 112"
        className="opt-target-group-pie-svg"
        aria-hidden
      >
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={COLOR_OTHER}
          strokeWidth={STROKE}
        />
        {clamped > 0.0001 && (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={COLOR_TARGET}
            strokeWidth={STROKE}
            strokeDasharray={`${targetLen} ${otherLen}`}
            strokeLinecap="butt"
            transform={`rotate(-90 ${C} ${C})`}
          />
        )}
        <text
          x={C}
          y={C - 4}
          textAnchor="middle"
          className="opt-target-group-pie-value"
        >
          {fmtPct(clamped)}
        </text>
        <text
          x={C}
          y={C + 14}
          textAnchor="middle"
          className="opt-target-group-pie-sub"
        >
          目标组
        </text>
      </svg>
    </figure>
  );
}

function deltaClass(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "opt-delta-neutral";
  return v > 0 ? "opt-delta-good" : "opt-delta-bad";
}

function fmtDeltaPp(v: number): string {
  const scaled = v * 100;
  const sign = scaled > 0 ? "+" : "";
  return `${sign}${scaled.toFixed(1)} pp`;
}

interface TargetGroupServingChartProps {
  groupName: string;
  before: TargetGroupServingStats;
  after: TargetGroupServingStats;
  deltaRatio: number | null;
}

export default function TargetGroupServingChart({
  groupName,
  before,
  after,
  deltaRatio,
}: TargetGroupServingChartProps) {
  const delta =
    deltaRatio ??
    (Number.isFinite(after.ratio - before.ratio)
      ? after.ratio - before.ratio
      : null);

  return (
    <section className="opt-section opt-target-group-section">
      <div className="opt-section-head opt-target-group-head">
        <div>
          <h3>{groupName}主服务占比</h3>
        </div>
        {delta != null && Number.isFinite(delta) && (
          <span className={`opt-target-group-delta-badge ${deltaClass(delta)}`}>
            {fmtDeltaPp(delta)}
          </span>
        )}
      </div>

      <div className="opt-target-group-pies">
        <DonutPie label="优化前" ratio={before.ratio} />
        <DonutPie label="优化后" ratio={after.ratio} />
      </div>

      <ul className="opt-target-group-legend">
        <li>
          <i style={{ background: COLOR_TARGET }} />
          {groupName}主服务
        </li>
        <li>
          <i style={{ background: COLOR_OTHER }} />
          其他 PCI
        </li>
      </ul>
    </section>
  );
}
