import type { GroundOverlayLayer } from "../types/mapLayers";

const NUDGE_M = 2;

interface Props {
  layer: GroundOverlayLayer;
  onChange: (next: GroundOverlayLayer) => void;
}

export default function GroundOverlayDetailPanel({ layer, onChange }: Props) {
  const patch = (partial: Partial<GroundOverlayLayer>) => {
    onChange({ ...layer, ...partial });
  };

  const halfW = layer.halfWidthMeters * layer.scale;
  const halfL = layer.halfLengthMeters * layer.scale;

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
        图片 URL
        <input
          type="text"
          value={layer.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="/images/stadium-ground.png"
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
      <label className="stadium-ground-field">
        <span>半透明 {(layer.opacity * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
        />
      </label>
      <label className="stadium-ground-field">
        <span>缩放 ×{layer.scale.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.02}
          value={layer.scale}
          onChange={(e) => patch({ scale: Number(e.target.value) })}
        />
      </label>
      <label>
        东西半宽 (m)
        <input
          type="number"
          min={5}
          step={1}
          value={layer.halfWidthMeters}
          onChange={(e) =>
            patch({ halfWidthMeters: Number(e.target.value) || 70 })
          }
        />
      </label>
      <label>
        南北半长 (m)
        <input
          type="number"
          min={5}
          step={1}
          value={layer.halfLengthMeters}
          onChange={(e) =>
            patch({ halfLengthMeters: Number(e.target.value) || 100 })
          }
        />
      </label>
      <p className="settings-hint">
        当前贴图范围：东西 {halfW.toFixed(1)} m × 南北 {halfL.toFixed(1)} m
      </p>
      <label>
        旋转 (°)
        <input
          type="number"
          step={1}
          value={layer.headingDegrees}
          onChange={(e) => patch({ headingDegrees: Number(e.target.value) })}
        />
      </label>
      <label>
        相对地表高度 (m)
        <input
          type="number"
          step={0.1}
          value={layer.heightMeters}
          onChange={(e) => patch({ heightMeters: Number(e.target.value) })}
        />
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
