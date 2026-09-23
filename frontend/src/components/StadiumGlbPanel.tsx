import { STADIUM_GLB } from "../constants";
import type { StadiumGlbTune } from "../types/stadiumGlbTune";
import {
  defaultStadiumGlbTune,
  formatStadiumGlbConstants,
} from "../types/stadiumGlbTune";

interface Props {
  tune: StadiumGlbTune;
  onChange: (next: StadiumGlbTune) => void;
  embedded?: boolean;
}

export default function StadiumGlbPanel({
  tune,
  onChange,
  embedded = false,
}: Props) {
  const patch = (partial: Partial<StadiumGlbTune>) => {
    onChange({ ...tune, ...partial });
  };

  return (
    <div
      className={
        embedded
          ? "stadium-ground-panel stadium-ground-panel--embedded"
          : "stadium-ground-panel"
      }
    >
      {!embedded && (
        <header className="stadium-ground-panel-head">
          <h3>3D 模型对齐</h3>
        </header>
      )}

      <label className="stadium-ground-field">
        <span>南北缩放 ×{tune.northSouthScale.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.02}
          value={tune.northSouthScale}
          onChange={(e) =>
            patch({ northSouthScale: Number(e.target.value) })
          }
        />
      </label>
      <p className="settings-hint">
        1.00 时使用原有模型渲染；在此基础上 &gt;1 南北拉长、&lt;1 南北压短。满意后复制写入
        STADIUM_GLB.northSouthScale（当前默认 {STADIUM_GLB.northSouthScale}）。
      </p>
      <div className="stadium-ground-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => onChange(defaultStadiumGlbTune())}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            void navigator.clipboard.writeText(formatStadiumGlbConstants(tune));
          }}
        >
          复制参数
        </button>
      </div>
    </div>
  );
}
