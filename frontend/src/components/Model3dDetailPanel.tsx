import type { Model3dLayer } from "../types/mapLayers";

const NUDGE_M = 2;

interface Props {
  layer: Model3dLayer;
  onChange: (next: Model3dLayer) => void;
}

export default function Model3dDetailPanel({ layer, onChange }: Props) {
  const patch = (partial: Partial<Model3dLayer>) => {
    onChange({ ...layer, ...partial });
  };

  return (
    <div className="layer-detail-panel">
      <label>
        图层名称
        <input
          type="text"
          value={layer.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label>
        模型 URL
        <input
          type="text"
          value={layer.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="/models/dayuntest2.glb"
        />
      </label>
      <label>
        中心经度 / 纬度
        <span className="settings-inline-inputs">
          <input
            type="number"
            step={0.000001}
            value={layer.longitude}
            onChange={(e) => patch({ longitude: Number(e.target.value) })}
          />
          <input
            type="number"
            step={0.000001}
            value={layer.latitude}
            onChange={(e) => patch({ latitude: Number(e.target.value) })}
          />
        </span>
      </label>
      <label>
        相对地表高度 (m)
        <input
          type="number"
          step={0.5}
          value={layer.heightMeters}
          onChange={(e) => patch({ heightMeters: Number(e.target.value) })}
        />
      </label>
      <label className="stadium-ground-field">
        <span>整体缩放 {layer.scale}</span>
        <input
          type="range"
          min={0.0001}
          max={0.01}
          step={0.00001}
          value={layer.scale}
          onChange={(e) => patch({ scale: Number(e.target.value) })}
        />
      </label>
      <label className="stadium-ground-field">
        <span>南北缩放 ×{layer.northSouthScale.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.02}
          value={layer.northSouthScale}
          onChange={(e) =>
            patch({ northSouthScale: Number(e.target.value) })
          }
        />
      </label>
      <label>
        航向 / 俯仰 / 翻滚 (°)
        <span className="settings-inline-inputs">
          <input
            type="number"
            step={1}
            value={layer.headingDegrees}
            onChange={(e) => patch({ headingDegrees: Number(e.target.value) })}
          />
          <input
            type="number"
            step={1}
            value={layer.pitchDegrees}
            onChange={(e) => patch({ pitchDegrees: Number(e.target.value) })}
          />
          <input
            type="number"
            step={1}
            value={layer.rollDegrees}
            onChange={(e) => patch({ rollDegrees: Number(e.target.value) })}
          />
        </span>
      </label>
      <div className="stadium-ground-offset-inputs">
        <label className="stadium-ground-field">
          <span>左右偏移 (m)，正=右</span>
          <input
            type="number"
            step={0.5}
            value={layer.offsetEastMeters}
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
            value={layer.offsetNorthMeters}
            onChange={(e) =>
              patch({ offsetNorthMeters: Number(e.target.value) || 0 })
            }
          />
        </label>
      </div>
      <div className="stadium-ground-nudge">
        <span className="stadium-ground-nudge-label">方向键（每次 {NUDGE_M} m）</span>
        <div className="stadium-ground-nudge-grid">
          <span />
          <button
            type="button"
            title="向北"
            onClick={() =>
              patch({ offsetNorthMeters: layer.offsetNorthMeters + NUDGE_M })
            }
          >
            ↑
          </button>
          <span />
          <button
            type="button"
            title="向西"
            onClick={() =>
              patch({ offsetEastMeters: layer.offsetEastMeters - NUDGE_M })
            }
          >
            ←
          </button>
          <button
            type="button"
            className="stadium-ground-nudge-center"
            title="回中心"
            onClick={() => patch({ offsetEastMeters: 0, offsetNorthMeters: 0 })}
          >
            ·
          </button>
          <button
            type="button"
            title="向东"
            onClick={() =>
              patch({ offsetEastMeters: layer.offsetEastMeters + NUDGE_M })
            }
          >
            →
          </button>
          <span />
          <button
            type="button"
            title="向南"
            onClick={() =>
              patch({ offsetNorthMeters: layer.offsetNorthMeters - NUDGE_M })
            }
          >
            ↓
          </button>
          <span />
        </div>
      </div>
    </div>
  );
}
