import type { StadiumGroundTune } from "../types/stadiumGround";
import { STADIUM_GROUND } from "../constants";
import {
  clearStadiumGroundLayoutTune,
  formatStadiumGroundConstants,
} from "../types/stadiumGround";

const NUDGE_M = 2;

interface Props {
  tune: StadiumGroundTune;
  onChange: (next: StadiumGroundTune) => void;
  /** 浮层模式下的关闭回调；嵌入设置抽屉时可省略 */
  onClose?: () => void;
  embedded?: boolean;
}

export default function StadiumGroundPanel({
  tune,
  onChange,
  onClose,
  embedded = false,
}: Props) {
  const patch = (partial: Partial<StadiumGroundTune>) => {
    onChange({ ...tune, ...partial });
  };

  const reset = () => {
    const next = clearStadiumGroundLayoutTune({
      ...tune,
      opacity: STADIUM_GROUND.opacity,
    });
    onChange(next);
  };

  const copyConstants = async () => {
    const text = formatStadiumGroundConstants(tune);
    const cleared = clearStadiumGroundLayoutTune(tune);
    onChange(cleared);
    try {
      await navigator.clipboard.writeText(text);
      window.alert(
        "参数已复制，并已清零浏览器内额外偏移/缩放。\n请将内容粘贴到 constants.ts 的 STADIUM_GROUND，并把 layoutRevision 加 1。"
      );
    } catch {
      window.prompt(
        "已清零微调。复制以下参数到 constants.ts 的 STADIUM_GROUND，并把 layoutRevision 加 1：",
        text
      );
    }
  };

  return (
    <div
      className={
        embedded
          ? "stadium-ground-panel stadium-ground-panel--embedded"
          : "stadium-ground-panel"
      }
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : "体育场衬底对齐"}
    >
      <header className="stadium-ground-panel-head">
        <h3>体育场衬底对齐</h3>
        {!embedded && onClose && (
          <button type="button" className="ghost-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </header>

      <label className="stadium-ground-field">
        <span>半透明 {(tune.opacity * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={tune.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
        />
      </label>

      <label className="stadium-ground-field">
        <span>缩放 ×{tune.scale.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.02}
          value={tune.scale}
          onChange={(e) => patch({ scale: Number(e.target.value) })}
        />
      </label>

      <div className="stadium-ground-offset-inputs">
        <label className="stadium-ground-field">
          <span>左右偏移 (m)，正=右</span>
          <input
            type="number"
            step={0.5}
            value={tune.offsetEastMeters}
            onChange={(e) =>
              patch({ offsetEastMeters: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label className="stadium-ground-field">
          <span>上下偏移 (m)，正=上</span>
          <input
            type="number"
            step={0.5}
            value={tune.offsetNorthMeters}
            onChange={(e) =>
              patch({ offsetNorthMeters: Number(e.target.value) || 0 })
            }
          />
        </label>
        <p className="stadium-ground-offset-hint">
          写入 constants 的基准：东 {STADIUM_GROUND.offsetEastMeters} m，北{" "}
          {STADIUM_GROUND.offsetNorthMeters} m；上方为在此基础上额外微调。
        </p>
      </div>

      <div className="stadium-ground-nudge">
        <span className="stadium-ground-nudge-label">方向键（每次 {NUDGE_M} m）</span>
        <div className="stadium-ground-nudge-grid">
          <span />
          <button
            type="button"
            title="向北"
            onClick={() =>
              patch({ offsetNorthMeters: tune.offsetNorthMeters + NUDGE_M })
            }
          >
            ↑
          </button>
          <span />
          <button
            type="button"
            title="向西"
            onClick={() =>
              patch({ offsetEastMeters: tune.offsetEastMeters - NUDGE_M })
            }
          >
            ←
          </button>
          <button
            type="button"
            className="stadium-ground-nudge-center"
            title="回中心"
            onClick={() =>
              patch({ offsetEastMeters: 0, offsetNorthMeters: 0 })
            }
          >
            ·
          </button>
          <button
            type="button"
            title="向东"
            onClick={() =>
              patch({ offsetEastMeters: tune.offsetEastMeters + NUDGE_M })
            }
          >
            →
          </button>
          <span />
          <button
            type="button"
            title="向南"
            onClick={() =>
              patch({ offsetNorthMeters: tune.offsetNorthMeters - NUDGE_M })
            }
          >
            ↓
          </button>
          <span />
        </div>
        <p className="stadium-ground-offset-hint">
          东 {tune.offsetEastMeters >= 0 ? "+" : ""}
          {tune.offsetEastMeters.toFixed(0)} m，北{" "}
          {tune.offsetNorthMeters >= 0 ? "+" : ""}
          {tune.offsetNorthMeters.toFixed(0)} m
        </p>
      </div>

      <div className="stadium-ground-actions">
        <button type="button" className="ghost-btn" onClick={reset} title="清除浏览器内额外偏移/缩放，使用 constants.ts 中的值">
          与默认对齐
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void copyConstants()}
          title="复制合并后的参数，并清零浏览器微调"
        >
          复制参数
        </button>
      </div>
      {(tune.offsetEastMeters !== 0 ||
        tune.offsetNorthMeters !== 0 ||
        tune.scale !== 1) && (
        <p className="stadium-ground-offset-hint stadium-ground-tune-warn">
          当前有浏览器微调（东 {tune.offsetEastMeters} m / 北 {tune.offsetNorthMeters} m / 缩放 ×
          {tune.scale.toFixed(2)}），会叠加在 constants 上。已写入 constants 后请点「与默认对齐」。
        </p>
      )}
    </div>
  );
}
